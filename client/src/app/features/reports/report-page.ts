import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';

import { ApiService, type ApiFailure } from '../../core/api.service';
import { SettingsStore } from '../../core/settings.store';
import { addDays, formatLong, formatShort, maxIso, minIso, todayIso } from '../../core/jalali';
import { Timeline, paddedRange, ZOOM_PRESETS, type ZoomLevel } from '../../core/timeline';
import {
  assignmentDays,
  buildWorkload,
  packLanes,
  type PersonWorkload,
} from '../../core/workload';
import {
  MODULE_STATUS_LABELS,
  type Assignment,
  type ModuleInput,
  type ProjectModule,
  type Team,
  type User,
  type WorkloadReport,
} from '../../core/models';
import { AvatarComponent } from '../../shared/avatar';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog';
import { DigitsPipe } from '../../shared/digits.pipe';
import { MultiSelectComponent, type MultiSelectOption } from '../../shared/multi-select';
import { ModuleEditorComponent } from '../gantt/module-editor';

const LANE_HEIGHT = 40;
const BAR_HEIGHT = 26;
const ROW_PADDING = 14;

interface ReportBar {
  assignment: Assignment;
  x: number;
  width: number;
  y: number;
  color: string;
  assignee: User | null;
  /** Only when the bar is wide enough that an avatar will not swamp it. */
  showAvatar: boolean;
  tooltip: string;
}

interface Band {
  x: number;
  width: number;
  label: string;
}

interface ReportRow {
  key: string;
  title: string;
  subtitle: string;
  /** Person rows show an avatar; project rows show a colour swatch. */
  user: User | null;
  color: string | null;
  /** Link target for project rows. */
  projectId: string | null;
  top: number;
  height: number;
  bars: ReportBar[];
  /** Capacity shading — meaningful for people only. */
  gaps: Band[];
  overloads: Band[];
  workload: PersonWorkload | null;
  moduleCount: number;
}

type SortKey = 'load' | 'free' | 'name';
type GroupMode = 'person' | 'project';

/**
 * Cross-project capacity report.
 *
 * Two ways to read the same assignments. Grouped by person it answers "what is
 * this person's life like" — something no single board can show, since someone
 * can look comfortable on one project while triple-booked across three.
 * Grouped by project it answers the mirror question: who is actually on each
 * piece of work, across the whole portfolio.
 */
@Component({
  selector: 'pma-report-page',
  imports: [
    RouterLink,
    AvatarComponent,
    DigitsPipe,
    MultiSelectComponent,
    ModuleEditorComponent,
    ConfirmDialogComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './report-page.html',
  styleUrl: './report-page.scss',
})
export class ReportPageComponent {
  private readonly api = inject(ApiService);
  protected readonly settings = inject(SettingsStore);

  protected readonly statusLabels = MODULE_STATUS_LABELS;
  protected readonly zoomPresets = ZOOM_PRESETS;
  protected readonly zoomLabels: Record<ZoomLevel, string> = {
    day: 'روز',
    week: 'هفته',
    month: 'ماه',
    quarter: 'فصل',
  };

  protected readonly laneHeight = LANE_HEIGHT;
  protected readonly barHeight = BAR_HEIGHT;
  protected readonly sidebarWidth = 248;
  protected readonly today = todayIso();

  protected readonly report = signal<WorkloadReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /* --------------------------------------------------------------- filters */

  /** Empty set means "no filter", which reads better than listing everything. */
  protected readonly projectFilter = signal<ReadonlySet<string>>(new Set());
  protected readonly teamFilter = signal<ReadonlySet<string>>(new Set());
  protected readonly userFilter = signal<ReadonlySet<string>>(new Set());

  protected readonly groupBy = signal<GroupMode>('person');
  protected readonly onlyWithWork = signal(true);
  protected readonly sortBy = signal<SortKey>('load');
  protected readonly zoom = signal<ZoomLevel>('week');

  /** `null` until the user overrides it; defaults to the span of all work. */
  protected readonly windowFrom = signal<string | null>(null);
  protected readonly windowTo = signal<string | null>(null);

  /* ---------------------------------------------------------- module edit */

  /**
   * The module being edited, with the teams its own project offers.
   *
   * Teams are per-project connections, so the row picker must show that
   * project's rows — not the whole registry the report happens to hold.
   */
  protected readonly editing = signal<{ module: ProjectModule; teams: Team[] } | null>(null);
  protected readonly opening = signal<string | null>(null);
  protected readonly deletingModule = signal<ProjectModule | null>(null);

  /** Opens the editor on a freshly fetched module. */
  protected openEditor(assignment: Assignment): void {
    if (this.opening()) return;
    this.opening.set(assignment.id);

    forkJoin({
      module: this.api.getModule(assignment.id),
      teams: this.api.listProjectTeams(assignment.projectId),
    }).subscribe({
      next: (loaded) => {
        this.editing.set(loaded);
        this.opening.set(null);
      },
      error: (failure: ApiFailure) => {
        this.error.set(failure.message);
        this.opening.set(null);
      },
    });
  }

  protected saveModule(input: ModuleInput): void {
    const target = this.editing();
    if (!target) return;

    // Cascade off: a report is a read-across of many projects, and quietly
    // reshuffling a project's dependents from here would be a surprise.
    this.api.updateModule(target.module.id, input, false).subscribe({
      next: () => {
        this.editing.set(null);
        this.load();
      },
      error: (failure: ApiFailure) => this.error.set(failure.message),
    });
  }

  protected requestDeleteModule(): void {
    const target = this.editing();
    if (!target) return;
    this.editing.set(null);
    this.deletingModule.set(target.module);
  }

  protected confirmDeleteModule(): void {
    const module = this.deletingModule();
    if (!module) return;
    this.deletingModule.set(null);

    this.api.deleteModule(module.id).subscribe({
      next: () => this.load(),
      error: (failure: ApiFailure) => this.error.set(failure.message),
    });
  }

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.getWorkload().subscribe({
      next: (report) => {
        this.report.set(report);
        this.loading.set(false);
      },
      error: (failure: ApiFailure) => {
        this.error.set(failure.message);
        this.loading.set(false);
      },
    });
  }

  /* ------------------------------------------------------- filter options */

  protected readonly projectOptions = computed<MultiSelectOption[]>(() =>
    (this.report()?.projects ?? []).map((p) => ({
      id: p.id,
      label: p.name,
      color: p.color,
      hint: `${p.moduleCount ?? 0}`,
    })),
  );

  protected readonly teamOptions = computed<MultiSelectOption[]>(() =>
    (this.report()?.teams ?? []).map((t) => ({ id: t.id, label: t.name, color: t.color })),
  );

  protected readonly userOptions = computed<MultiSelectOption[]>(() =>
    (this.report()?.users ?? []).map((u) => ({
      id: u.id,
      label: u.name,
      color: u.avatarColor,
      hint: u.teamName ?? undefined,
    })),
  );

  protected clearFilters(): void {
    this.projectFilter.set(new Set());
    this.teamFilter.set(new Set());
    this.userFilter.set(new Set());
    this.windowFrom.set(null);
    this.windowTo.set(null);
  }

  protected readonly hasFilters = computed(
    () =>
      this.projectFilter().size > 0 ||
      this.teamFilter().size > 0 ||
      this.userFilter().size > 0 ||
      this.windowFrom() !== null,
  );

  /* ---------------------------------------------------------------- window */

  protected readonly window = computed(() => {
    const report = this.report();
    const from = this.windowFrom();
    const to = this.windowTo();

    if (from && to) return { from, to };

    const start = report?.bounds.start ?? this.today;
    const end = report?.bounds.end ?? addDays(this.today, 60);

    return { from: from ?? start, to: to ?? maxIso(end, addDays(start, 13)) };
  });

  protected setWindowPreset(days: number | null): void {
    if (days === null) {
      this.windowFrom.set(null);
      this.windowTo.set(null);
      return;
    }
    this.windowFrom.set(this.today);
    this.windowTo.set(addDays(this.today, days));
  }

  /* -------------------------------------------------------------- filtered */

  protected readonly filteredAssignments = computed<Assignment[]>(() => {
    const report = this.report();
    if (!report) return [];

    const projects = this.projectFilter();
    const teams = this.teamFilter();
    const users = this.userFilter();
    const { from, to } = this.window();

    return report.assignments.filter(
      (a) =>
        (projects.size === 0 || projects.has(a.projectId)) &&
        (teams.size === 0 || teams.has(a.teamId)) &&
        // Unassigned work survives a person filter: it belongs to nobody, and
        // hiding it would defeat the panel that exists to surface it.
        (users.size === 0 || a.assigneeId === null || users.has(a.assigneeId)) &&
        // Overlapping the window is enough; work spanning the boundary still
        // occupies the person during it.
        a.endDate >= from &&
        a.startDate <= to,
    );
  });

  private readonly candidateUsers = computed(() => {
    const report = this.report();
    if (!report) return [];

    const teams = this.teamFilter();
    const users = this.userFilter();

    return report.users.filter(
      (user) =>
        (users.size === 0 || users.has(user.id)) &&
        (teams.size === 0 || (user.teamId !== null && teams.has(user.teamId))),
    );
  });

  protected readonly workloads = computed<PersonWorkload[]>(() => {
    const built = buildWorkload(
      this.candidateUsers(),
      // Unassigned work belongs to nobody, so it must not inflate anyone's load.
      this.filteredAssignments().filter((a) => a.assigneeId !== null),
      this.window(),
      this.today,
    );

    const visible = this.onlyWithWork()
      ? built.filter((w) => w.assignments.length > 0)
      : built;

    const sort = this.sortBy();
    return [...visible].sort((a, b) => {
      if (sort === 'name') return a.user.name.localeCompare(b.user.name, 'fa');
      if (sort === 'free') return b.freeDays - a.freeDays;
      return b.loadFactor - a.loadFactor || b.peakConcurrency - a.peakConcurrency;
    });
  });

  /* ---------------------------------------------------------------- layout */

  protected readonly timeline = computed(() => {
    const { from, to } = this.window();
    const padded = paddedRange(from, to, 3);
    const preset = ZOOM_PRESETS.find((p) => p.id === this.zoom()) ?? ZOOM_PRESETS[1];

    return new Timeline(
      padded.start,
      padded.end,
      preset.dayWidth,
      this.settings.locale(),
      this.settings.persianDigits(),
    );
  });

  protected readonly monthTicks = computed(() => this.timeline().monthTicks());
  protected readonly yearTicks = computed(() => this.timeline().yearTicks());
  protected readonly weekendBands = computed(() => this.timeline().weekendBands());
  protected readonly todayX = computed(() => this.timeline().todayX(this.today));

  private userById(id: string | null): User | null {
    if (!id) return null;
    return this.report()?.users.find((u) => u.id === id) ?? null;
  }

  /** Shared bar geometry for both grouping modes. */
  private barsFor(lanes: Assignment[][], top: number, colorOf: (a: Assignment) => string) {
    const timeline = this.timeline();
    const fmt = this.settings.dateFormat();
    const bars: ReportBar[] = [];

    lanes.forEach((lane, laneIndex) => {
      for (const assignment of lane) {
        const x = timeline.xFor(assignment.startDate);
        const width = Math.max(
          timeline.widthFor(assignment.startDate, assignment.endDate) - 1,
          3,
        );
        const assignee = this.userById(assignment.assigneeId);

        bars.push({
          assignment,
          x,
          width,
          y: top + ROW_PADDING / 2 + laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
          color: colorOf(assignment),
          assignee,
          showAvatar: width >= 52,
          tooltip: [
            assignment.name,
            `${assignment.projectName} · ${assignment.teamName}`,
            assignee ? assignee.name : 'بدون مسئول',
            `${formatShort(assignment.startDate, fmt)} ← ${formatShort(assignment.endDate, fmt)}`,
            `${assignmentDays(assignment)} روز کاری · ${MODULE_STATUS_LABELS[assignment.status]}`,
          ].join('\n'),
        });
      }
    });

    return bars;
  }

  protected readonly rows = computed<ReportRow[]>(() =>
    this.groupBy() === 'project' ? this.projectRows() : this.personRows(),
  );

  /** Rows are people; bars are coloured by project to expose split focus. */
  private personRows(): ReportRow[] {
    const timeline = this.timeline();
    let top = 0;

    return this.workloads().map((workload) => {
      const bars = this.barsFor(workload.lanes, top, (a) => a.projectColor);

      const band = (start: string, end: string, label: string): Band => ({
        x: timeline.xFor(start),
        width: timeline.widthFor(start, end),
        label,
      });

      const lanes = Math.max(1, workload.lanes.length);
      const height = lanes * LANE_HEIGHT + ROW_PADDING;

      const row: ReportRow = {
        key: workload.user.id,
        title: workload.user.name,
        subtitle: workload.user.teamName ?? 'بدون تیم',
        user: workload.user,
        color: null,
        projectId: null,
        top,
        height,
        bars,
        gaps: workload.gaps.map((g) => band(g.start, g.end, `${g.days} روز آزاد`)),
        overloads: workload.overloads.map((o) =>
          band(o.start, o.end, `${o.peak} کار هم‌زمان`),
        ),
        workload,
        moduleCount: workload.assignments.length,
      };

      top += height;
      return row;
    });
  }

  /**
   * Rows are projects; bars are coloured by team and carry the assignee's
   * face, so the question "who is on this work" is answered without leaving
   * the portfolio view.
   */
  private projectRows(): ReportRow[] {
    const report = this.report();
    if (!report) return [];

    const grouped = new Map<string, Assignment[]>();
    for (const assignment of this.filteredAssignments()) {
      const list = grouped.get(assignment.projectId);
      if (list) list.push(assignment);
      else grouped.set(assignment.projectId, [assignment]);
    }

    const projects = report.projects.filter(
      (p) =>
        (this.projectFilter().size === 0 || this.projectFilter().has(p.id)) &&
        (!this.onlyWithWork() || (grouped.get(p.id)?.length ?? 0) > 0),
    );

    let top = 0;

    return projects.map((project) => {
      const assignments = grouped.get(project.id) ?? [];
      const lanes = packLanes(assignments);
      const bars = this.barsFor(lanes, top, (a) => a.teamColor);

      const people = new Set(
        assignments.map((a) => a.assigneeId).filter((id): id is string => id !== null),
      );

      const laneCount = Math.max(1, lanes.length);
      const height = laneCount * LANE_HEIGHT + ROW_PADDING;

      const row: ReportRow = {
        key: project.id,
        title: project.name,
        subtitle: `${assignments.length} ماژول · ${people.size} نفر`,
        user: null,
        color: project.color,
        projectId: project.id,
        top,
        height,
        bars,
        // Free/overload shading is a person concept: two parallel modules in a
        // project is normal, whereas two on one person is a warning.
        gaps: [],
        overloads: [],
        workload: null,
        moduleCount: assignments.length,
      };

      top += height;
      return row;
    });
  }

  protected readonly canvasHeight = computed(() => {
    const last = this.rows().at(-1);
    return Math.max(last ? last.top + last.height : 0, 120);
  });

  /* -------------------------------------------------------------- summaries */

  protected readonly summary = computed(() => {
    const workloads = this.workloads();
    const withWork = workloads.filter((w) => w.assignments.length > 0);

    const utilisation = withWork.length
      ? withWork.reduce((sum, w) => sum + w.utilisation, 0) / withWork.length
      : 0;

    return {
      people: workloads.length,
      overloaded: workloads.filter((w) => w.overloadedDays > 0).length,
      idle: workloads.filter((w) => w.assignments.length === 0).length,
      unassigned: this.unassigned().length,
      averageUtilisation: Math.round(utilisation * 100),
    };
  });

  protected readonly unassigned = computed(() =>
    this.filteredAssignments().filter((a) => a.assigneeId === null),
  );

  protected readonly overloadedPeople = computed(() =>
    this.workloads()
      .filter((w) => w.overloadedDays > 0)
      .sort((a, b) => b.overloadedDays - a.overloadedDays),
  );

  protected readonly availablePeople = computed(() =>
    this.workloads()
      .filter((w) => w.freeDays > 0)
      .sort((a, b) => b.freeDays - a.freeDays)
      .slice(0, 8),
  );

  protected readonly overdue = computed(() =>
    this.filteredAssignments()
      .filter((a) => a.status !== 'done' && a.endDate < this.today)
      .sort((a, b) => a.endDate.localeCompare(b.endDate)),
  );

  /* ---------------------------------------------------------------- display */

  protected long(iso: string): string {
    return formatLong(iso, this.settings.dateFormat());
  }

  protected short(iso: string): string {
    return formatShort(iso, this.settings.dateFormat());
  }

  protected percent(value: number): number {
    return Math.round(value * 100);
  }

  protected assigneeName(assignment: Assignment): string {
    return this.userById(assignment.assigneeId)?.name ?? 'بدون مسئول';
  }

  protected assigneeOf(assignment: Assignment): User | null {
    return this.userById(assignment.assigneeId);
  }

  protected rowClass(row: ReportRow): string {
    if (!row.workload) return '';
    if (row.workload.overloadedDays > 0) return 'is-overloaded';
    if (row.workload.assignments.length === 0) return 'is-idle';
    return '';
  }

  protected clampedWindowLabel(): string {
    const { from, to } = this.window();
    return `${this.long(minIso(from, to))} — ${this.long(maxIso(from, to))}`;
  }
}
