import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';

import { BoardStore } from '../../core/board.store';
import { SettingsStore } from '../../core/settings.store';
import { Timeline, paddedRange, type TimelineTick } from '../../core/timeline';
import { wouldCreateCycle } from '../../core/scheduling';
import {
  addDays,
  diffDays,
  formatLong,
  formatShort,
  toPersianDigits,
  workingDaysBetween,
} from '../../core/jalali';
import { AvatarComponent } from '../../shared/avatar';
import { DigitsPipe } from '../../shared/digits.pipe';
import type { Dependency, ProjectModule, Team, User } from '../../core/models';

/** Vertical space one stacked bar occupies inside a row. */
const LANE_HEIGHT = 38;
const BAR_HEIGHT = 24;
const ROW_PADDING = 10;
const MILESTONE_SIZE = 17;
/** Horizontal clearance for dependency elbows. */
const ARROW_GAP = 11;

export type DragMode = 'move' | 'resize-start' | 'resize-end';

interface DragState {
  moduleId: string;
  mode: DragMode;
  startClientX: number;
  originalStart: string;
  originalEnd: string;
  deltaDays: number;
}

interface LinkState {
  fromModuleId: string;
  originX: number;
  originY: number;
  cursorX: number;
  cursorY: number;
  targetModuleId: string | null;
  invalidReason: string | null;
}

export interface BarLayout {
  module: ProjectModule;
  x: number;
  width: number;
  /** Top of the bar in canvas coordinates. */
  y: number;
  centerY: number;
  isMilestone: boolean;
  color: string;
  label: string;
  tooltip: string;
  progressWidth: number;
  isOverdue: boolean;
  isSelected: boolean;
  /** The person doing the work, resolved from the directory. */
  assignee: User | null;
  /** Whether the bar is wide enough to show their avatar without crowding. */
  showAvatar: boolean;
}

export interface RowLayout {
  team: Team;
  top: number;
  height: number;
  bars: BarLayout[];
  /** Modules in the row, counted even while it is collapsed and drawing none. */
  moduleCount: number;
  collapsed: boolean;
}

interface ArrowLayout {
  dependency: Dependency;
  path: string;
  conflicted: boolean;
}

/**
 * The chart surface: a sticky Shamsi header, one row per team, bars that can
 * be dragged and resized, and SVG dependency arrows drawn over the top.
 *
 * It reads and writes `BoardStore` directly rather than taking a dozen inputs —
 * this is the board's one view, not a reusable widget, and the indirection
 * would only obscure where edits go.
 */
@Component({
  selector: 'pma-gantt-chart',
  imports: [AvatarComponent, DigitsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gantt-chart.html',
  styleUrl: './gantt-chart.scss',
})
export class GanttChartComponent {
  protected readonly store = inject(BoardStore);
  protected readonly settings = inject(SettingsStore);

  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly canvas = viewChild<ElementRef<HTMLElement>>('canvas');

  /** Raised when a bar is double-clicked or its edit affordance is used. */
  readonly editModule = output<ProjectModule>();
  readonly editTeam = output<Team>();
  readonly deleteTeam = output<Team>();
  readonly addModule = output<Team>();
  readonly inspectDependency = output<Dependency>();

  protected readonly sidebarWidth = 236;
  protected readonly laneHeight = LANE_HEIGHT;
  protected readonly barHeight = BAR_HEIGHT;
  protected readonly milestoneSize = MILESTONE_SIZE;

  private readonly drag = signal<DragState | null>(null);
  protected readonly link = signal<LinkState | null>(null);
  protected readonly hoveredModuleId = signal<string | null>(null);

  /**
   * Hover card for a bar's avatar. It is rendered at chart level rather than
   * inside the bar because a bar clips its overflow, which would cut the card
   * in half.
   */
  protected readonly hoverCard = signal<{ user: User; x: number; y: number } | null>(null);

  /** Cleans up the window listeners attached for the current gesture. */
  private gesture: AbortController | null = null;

  /** Guards the one-time centring so it does not fight the user's scrolling. */
  private centredProjectId: string | null = null;

  constructor() {
    // Open every board on today rather than at the project's start date —
    // "what is happening now" is what a PM wants first, and a long plan would
    // otherwise open on months of finished work.
    effect(() => {
      const project = this.store.project();
      const ready = this.rows().length > 0;
      if (!project || !ready || this.centredProjectId === project.id) return;

      this.centredProjectId = project.id;
      // A tick later, so the canvas has been laid out at its full width.
      setTimeout(() => this.scrollToToday(false));
    });
  }

  /* ------------------------------------------------------------ timeline -- */

  protected readonly timeline = computed(() => {
    const span = this.store.span();
    const { start, end } = paddedRange(span.start, span.end);
    const preset = this.settings.zoomPreset();

    return new Timeline(
      start,
      end,
      preset.dayWidth,
      this.settings.locale(),
      this.settings.persianDigits(),
    );
  });

  protected readonly monthTicks = computed(() => this.timeline().monthTicks());
  protected readonly yearTicks = computed(() => this.timeline().yearTicks());

  protected readonly minorTicks = computed<TimelineTick[]>(() =>
    this.timeline().minorTicks(this.settings.zoomPreset().minorUnit, this.store.today()),
  );

  protected readonly weekendBands = computed(() => this.timeline().weekendBands());
  protected readonly todayX = computed(() => this.timeline().todayX(this.store.today()));

  /* -------------------------------------------------------------- layout -- */

  /**
   * Rows, with each team's bars packed into as few stacked lanes as their date
   * ranges allow, so parallel work in one team stays readable instead of
   * overlapping into an unreadable pile.
   */
  protected readonly rows = computed<RowLayout[]>(() => {
    const timeline = this.timeline();
    const selectedId = this.store.selectedModuleId();
    const today = this.store.today();
    const fmt = this.settings.dateFormat();
    const users = this.store.userById();

    // Collapsed state is per project, so a team folded away on this chart is
    // still open on every other one.
    const projectId = this.store.project()?.id ?? '';
    const hideEmpty = this.settings.hideEmptyRows();

    let top = 0;

    return this.store
      .rows()
      // Every team gets a row, including teams with no work in this project.
      // The toolbar can hide those once a plan has taken shape.
      .filter(({ modules }) => !hideEmpty || modules.length > 0)
      .map(({ team, modules }) => {
      const collapsed = this.settings.isRowCollapsed(projectId, team.id);
      const visible = collapsed ? [] : modules;

      // Greedy interval packing: reuse the first lane whose last bar ends
      // before this one starts.
      const laneEnds: number[] = [];
      const bars: BarLayout[] = [];

      for (const module of visible) {
        const draft = this.draftDates(module);
        const isMilestone = module.kind === 'milestone';

        const x = isMilestone
          ? timeline.xForCenter(draft.startDate) - MILESTONE_SIZE / 2
          : timeline.xFor(draft.startDate);
        // 1px shy of the true span so back-to-back bars read as two bars
        // rather than one continuous block.
        const width = isMilestone
          ? MILESTONE_SIZE
          : Math.max(timeline.widthFor(draft.startDate, draft.endDate) - 1, 3);

        // A milestone's name is drawn beside its diamond, so the space that
        // text needs counts as part of the bar when packing lanes.
        const extent =
          x + width + (isMilestone ? this.estimateLabelWidth(module.name) : 0);

        // `<= x` (not `< x`) keeps back-to-back work on one line: a bar ending
        // on the 20th and one starting on the 21st do not overlap.
        let lane = laneEnds.findIndex((end) => end <= x + 0.5);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(0);
        }
        laneEnds[lane] = extent;

        const y = top + ROW_PADDING / 2 + lane * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2;

        const assignee = module.assigneeId ? (users.get(module.assigneeId) ?? null) : null;

        bars.push({
          module,
          x,
          width,
          y,
          centerY: y + BAR_HEIGHT / 2,
          isMilestone,
          color: module.color ?? team.color,
          label: module.name,
          tooltip: this.tooltipFor(module, draft, fmt, assignee),
          progressWidth: isMilestone ? 0 : (width * module.progress) / 100,
          isOverdue: module.status !== 'done' && draft.endDate < today,
          isSelected: module.id === selectedId,
          assignee,
          // Below this the avatar would cover the whole bar and swallow its label.
          showAvatar: !isMilestone && !!assignee && width >= 64,
        });
      }

      const lanes = Math.max(1, laneEnds.length);
      const height = collapsed ? LANE_HEIGHT : lanes * LANE_HEIGHT + ROW_PADDING;
      const row: RowLayout = {
        team,
        top,
        height,
        bars,
        moduleCount: modules.length,
        collapsed,
      };
      top += height;

      return row;
    });
  });

  /** Rows hidden by the "only rows with work" filter. */
  protected readonly hiddenRowCount = computed(() =>
    this.settings.hideEmptyRows()
      ? this.store.rows().filter((row) => row.modules.length === 0).length
      : 0,
  );

  protected toggleRowCollapsed(teamId: string): void {
    const projectId = this.store.project()?.id;
    if (projectId) this.settings.toggleRowCollapsed(projectId, teamId);
  }

  protected readonly canvasHeight = computed(() => {
    const rows = this.rows();
    const last = rows.at(-1);
    return Math.max(last ? last.top + last.height : 0, 160);
  });

  private readonly barsById = computed(() => {
    const map = new Map<string, BarLayout>();
    for (const row of this.rows()) {
      for (const bar of row.bars) map.set(bar.module.id, bar);
    }
    return map;
  });

  /* -------------------------------------------------------------- arrows -- */

  protected readonly arrows = computed<ArrowLayout[]>(() => {
    if (!this.settings.showDependencies()) return [];

    const bars = this.barsById();
    const conflicts = this.store.violatingDependencyIds();

    return this.store
      .dependencies()
      .map((dependency) => {
        const from = bars.get(dependency.fromModuleId);
        const to = bars.get(dependency.toModuleId);
        // A collapsed row hides its bars, and with them their arrows.
        if (!from || !to) return null;

        return {
          dependency,
          path: this.elbow(
            from.x + from.width,
            from.centerY,
            to.x,
            to.centerY,
          ),
          conflicted: conflicts.has(dependency.id),
        } satisfies ArrowLayout;
      })
      .filter((arrow): arrow is ArrowLayout => arrow !== null);
  });

  /**
   * Orthogonal route from a predecessor's right edge to a successor's left
   * edge. When the successor starts before the predecessor ends there is no
   * room to go straight, so the path steps out, tracks vertically between the
   * two rows, and comes back in.
   */
  private elbow(sx: number, sy: number, ex: number, ey: number): string {
    if (ex - sx >= ARROW_GAP * 2) {
      const turn = ex - ARROW_GAP;
      return `M ${sx} ${sy} H ${turn} V ${ey} H ${ex}`;
    }

    const sameRow = Math.abs(ey - sy) < 1;
    const detourY = sameRow
      ? sy + LANE_HEIGHT * 0.62
      : (sy + ey) / 2;

    return `M ${sx} ${sy} H ${sx + ARROW_GAP} V ${detourY} H ${ex - ARROW_GAP} V ${ey} H ${ex}`;
  }

  /** Rubber-band line shown while dragging out a new dependency. */
  protected readonly linkPath = computed(() => {
    const state = this.link();
    if (!state) return null;
    return this.elbow(state.originX, state.originY, state.cursorX, state.cursorY);
  });

  /* --------------------------------------------------------- drag & drop -- */

  /** Dates to render for a module: the live drag preview, or its stored dates. */
  private draftDates(module: ProjectModule): { startDate: string; endDate: string } {
    const drag = this.drag();
    if (!drag || drag.moduleId !== module.id || drag.deltaDays === 0) {
      return { startDate: module.startDate, endDate: module.endDate };
    }

    return this.applyDrag(drag);
  }

  private applyDrag(drag: DragState): { startDate: string; endDate: string } {
    const { mode, deltaDays, originalStart, originalEnd } = drag;

    if (mode === 'move') {
      return {
        startDate: addDays(originalStart, deltaDays),
        endDate: addDays(originalEnd, deltaDays),
      };
    }

    if (mode === 'resize-start') {
      // Never let the start cross the end; a bar has a minimum of one day.
      const proposed = addDays(originalStart, deltaDays);
      return {
        startDate: proposed > originalEnd ? originalEnd : proposed,
        endDate: originalEnd,
      };
    }

    const proposed = addDays(originalEnd, deltaDays);
    return {
      startDate: originalStart,
      endDate: proposed < originalStart ? originalStart : proposed,
    };
  }

  protected onBarPointerDown(event: PointerEvent, module: ProjectModule, mode: DragMode): void {
    // Left button only; ignore the context menu and middle-click autoscroll.
    if (event.button !== 0) return;
    event.preventDefault();
    // Also stops the press reaching the canvas, whose own handler clears the
    // selection for clicks on empty background.
    event.stopPropagation();

    // Note: the selection is set on release, not here — see commitDrag().

    // A milestone has no length, so its edges cannot be resized.
    const effectiveMode = module.kind === 'milestone' ? 'move' : mode;

    this.drag.set({
      moduleId: module.id,
      mode: effectiveMode,
      startClientX: event.clientX,
      originalStart: module.startDate,
      originalEnd: module.endDate,
      deltaDays: 0,
    });

    this.beginGesture(
      (moveEvent) => {
        const dayWidth = this.timeline().dayWidth;
        const deltaDays = Math.round((moveEvent.clientX - event.clientX) / dayWidth);
        this.drag.update((state) => (state ? { ...state, deltaDays } : state));
      },
      (cancelled) => this.commitDrag(cancelled),
    );
  }

  private commitDrag(cancelled: boolean): void {
    const drag = this.drag();
    this.drag.set(null);
    if (!drag) return;

    // The OS taking the pointer away (a window switch, a touch turning into a
    // scroll) must abandon the drag, not silently save a half-finished one.
    if (cancelled) return;

    /*
     * Select on release rather than on press.
     *
     * Opening the details panel widens the sidebar by its own width, which
     * reflows the chart and slides the bar ~288px out from under the pointer.
     * Selecting on `pointerdown` meant that by the time a human released the
     * button, the press point was over empty background — so the click landed
     * on the canvas and cleared the selection again. The details only stayed
     * visible while the button was held down.
     */
    this.store.selectedModuleId.set(drag.moduleId);

    if (drag.deltaDays === 0) return;

    const { startDate, endDate } = this.applyDrag(drag);
    this.store.moveModule(drag.moduleId, startDate, endDate, this.settings.cascade());
  }

  /* ------------------------------------------------------------- linking -- */

  protected onLinkPointerDown(event: PointerEvent, bar: BarLayout): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const originX = bar.x + bar.width;
    const originY = bar.centerY;

    this.link.set({
      fromModuleId: bar.module.id,
      originX,
      originY,
      cursorX: originX,
      cursorY: originY,
      targetModuleId: null,
      invalidReason: null,
    });

    this.beginGesture(
      (moveEvent) => {
        const point = this.toCanvasPoint(moveEvent);
        const targetId = this.moduleAtPoint(moveEvent);

        this.link.update((state) =>
          state
            ? {
                ...state,
                cursorX: point.x,
                cursorY: point.y,
                targetModuleId: targetId,
                invalidReason: targetId ? this.linkProblem(state.fromModuleId, targetId) : null,
              }
            : state,
        );
      },
      (cancelled) => this.commitLink(cancelled),
    );
  }

  private commitLink(cancelled: boolean): void {
    const state = this.link();
    this.link.set(null);

    if (cancelled || !state?.targetModuleId || state.invalidReason) return;

    this.store.createDependency({
      fromModuleId: state.fromModuleId,
      toModuleId: state.targetModuleId,
      type: 'FS',
      lagDays: 0,
    });
  }

  /** Why this link cannot be made, or null when it is fine. */
  private linkProblem(fromId: string, toId: string): string | null {
    if (fromId === toId) return 'یک ماژول نمی‌تواند به خودش وابسته باشد';

    const existing = this.store
      .dependencies()
      .some((d) => d.fromModuleId === fromId && d.toModuleId === toId);
    if (existing) return 'این وابستگی از قبل وجود دارد';

    if (wouldCreateCycle(this.store.dependencies(), fromId, toId)) {
      return 'این پیوند یک وابستگی حلقوی می‌سازد';
    }

    return null;
  }

  /** Hit-test the pointer against rendered bars via their data attribute. */
  private moduleAtPoint(event: PointerEvent): string | null {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    const bar = element?.closest<HTMLElement>('[data-module-id]');
    return bar?.dataset['moduleId'] ?? null;
  }

  private toCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const element = this.canvas()?.nativeElement;
    if (!element) return { x: 0, y: 0 };

    const rect = element.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  /**
   * Attaches move/up listeners for one pointer gesture. `pointercancel` is
   * handled too — without it, a gesture interrupted by the OS (an alt-tab, a
   * touch turning into a scroll) would leave the drag state stuck on.
   */
  private beginGesture(
    onMove: (event: PointerEvent) => void,
    onEnd: (cancelled: boolean) => void,
  ): void {
    this.gesture?.abort();
    const controller = new AbortController();
    this.gesture = controller;

    const finish = (cancelled: boolean) => () => {
      controller.abort();
      this.gesture = null;
      onEnd(cancelled);
    };

    const options = { signal: controller.signal };
    window.addEventListener('pointermove', onMove, options);
    window.addEventListener('pointerup', finish(false), options);
    window.addEventListener('pointercancel', finish(true), options);
  }

  /* ---------------------------------------------------------- keyboard -- */

  /**
   * Arrow keys nudge a focused bar by a day; with Shift they stretch its end.
   * Dragging with a mouse cannot be the only way to reschedule work.
   */
  protected onBarKeydown(event: KeyboardEvent, module: ProjectModule): void {
    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;

    if (step === 0) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.editModule.emit(module);
      }
      return;
    }

    event.preventDefault();
    const cascade = this.settings.cascade();

    if (event.shiftKey && module.kind !== 'milestone') {
      const endDate = addDays(module.endDate, step);
      if (endDate < module.startDate) return;
      this.store.moveModule(module.id, module.startDate, endDate, cascade);
      return;
    }

    this.store.moveModule(
      module.id,
      addDays(module.startDate, step),
      addDays(module.endDate, step),
      cascade,
    );
  }

  /* ------------------------------------------------------------ display -- */

  /**
   * Rough pixel width of a milestone's label. Measuring text properly would
   * mean a canvas context and a layout pass per frame; ~6px per character at
   * 11px is close enough to stop labels colliding.
   */
  private estimateLabelWidth(name: string): number {
    return name.length * 6 + 10;
  }

  private tooltipFor(
    module: ProjectModule,
    draft: { startDate: string; endDate: string },
    fmt: { locale: 'fa' | 'en'; persianDigits: boolean },
    assignee: User | null,
  ): string {
    const days = workingDaysBetween(draft.startDate, draft.endDate);
    const count = fmt.persianDigits ? toPersianDigits(days) : String(days);
    const who = assignee
      ? `${assignee.name}${assignee.title ? ` — ${assignee.title}` : ''}`
      : 'بدون مسئول';

    if (module.kind === 'milestone') {
      return `${module.name}\n${formatLong(draft.startDate, fmt)}\n${who}`;
    }

    return [
      module.name,
      `${formatShort(draft.startDate, fmt)} ← ${formatShort(draft.endDate, fmt)}`,
      `${count} روز · ${module.progress}٪`,
      who,
    ].join('\n');
  }

  /** Live date readout shown while a bar is being dragged. */
  protected readonly dragHint = computed(() => {
    const drag = this.drag();
    if (!drag) return null;

    const module = this.store.moduleById().get(drag.moduleId);
    if (!module) return null;

    const { startDate, endDate } = this.applyDrag(drag);
    const fmt = this.settings.dateFormat();
    const days = workingDaysBetween(startDate, endDate);

    return {
      name: module.name,
      range:
        module.kind === 'milestone'
          ? formatLong(startDate, fmt)
          : `${formatShort(startDate, fmt)} ← ${formatShort(endDate, fmt)}`,
      days: fmt.persianDigits ? toPersianDigits(days) : String(days),
      shifted: drag.deltaDays,
    };
  });

  protected readonly isDragging = computed(() => this.drag() !== null);

  protected scrollToToday(smooth = true): void {
    const x = this.todayX();
    const element = this.scroller()?.nativeElement;
    if (x === null || !element) return;

    const target = Math.max(0, x - element.clientWidth / 2 + this.sidebarWidth);

    if (!smooth || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.scrollLeft = target;
      return;
    }

    const before = element.scrollLeft;
    element.scrollTo({ left: target, behavior: 'smooth' });

    // Some embedded browsers accept `behavior: 'smooth'` and then do nothing at
    // all, leaving the button silently broken. If nothing has moved shortly
    // after, jump straight there — landing on the marker beats the animation.
    setTimeout(() => {
      if (element.scrollLeft === before) element.scrollLeft = target;
    }, 150);
  }

  /**
   * Selecting is deliberately not a toggle. `pointerdown` already selects the
   * bar so the details appear the instant you press, and toggling on the
   * following `click` would immediately close them again — details would only
   * stay visible while the mouse was held down.
   */
  protected onSelectModule(module: ProjectModule): void {
    this.store.selectedModuleId.set(module.id);
  }

  /**
   * Pressing empty chart background clears the selection.
   *
   * Bound to `pointerdown`, not `click`: bars stop propagation on their own
   * pointerdown, so anything arriving here is genuinely the background. A
   * click handler could not tell the difference, because opening the panel
   * reflows the chart between press and release and the click ends up
   * targeting whatever slid under the cursor.
   */
  protected onCanvasPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.store.selectedModuleId.set(null);
  }

  protected showAssignee(bar: BarLayout): void {
    if (!bar.assignee || this.isDragging()) return;
    this.hoverCard.set({ user: bar.assignee, x: bar.x, y: bar.y });
  }

  protected hideAssignee(): void {
    this.hoverCard.set(null);
  }

  protected trackTick(index: number, tick: TimelineTick): string {
    return tick.iso;
  }
}
