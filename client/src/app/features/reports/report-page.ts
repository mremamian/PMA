import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService, type ApiFailure } from '../../core/api.service';
import { SettingsStore } from '../../core/settings.store';
import {
  addDays,
  formatLong,
  formatShort,
  maxIso,
  minIso,
  todayIso,
} from '../../core/jalali';
import { Timeline, paddedRange, ZOOM_PRESETS, type ZoomLevel } from '../../core/timeline';
import {
  assignmentDays,
  buildWorkload,
  type PersonWorkload,
} from '../../core/workload';
import {
  MODULE_STATUS_LABELS,
  type Assignment,
  type WorkloadReport,
} from '../../core/models';
import { AvatarComponent } from '../../shared/avatar';
import { DigitsPipe } from '../../shared/digits.pipe';

const LANE_HEIGHT = 26;
const BAR_HEIGHT = 18;
const ROW_PADDING = 10;

interface ReportBar {
  assignment: Assignment;
  x: number;
  width: number;
  y: number;
  tooltip: string;
}

interface Band {
  x: number;
  width: number;
  label: string;
}

interface ReportRow {
  workload: PersonWorkload;
  top: number;
  height: number;
  bars: ReportBar[];
  /** Stretches with nothing scheduled. */
  gaps: Band[];
  /** Stretches carrying two or more things at once. */
  overloads: Band[];
}

type SortKey = 'load' | 'free' | 'name';

/**
 * Cross-project capacity report.
 *
 * The Gantt answers "what is the plan for this project"; this answers "what is
 * this person's life like", which no single board can show — someone can look
 * comfortable on one project while being triple-booked across three.
 */
@Component({
  selector: 'pma-report-page',
  imports: [RouterLink, AvatarComponent, DigitsPipe],
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
  protected readonly sidebarWidth = 236;
  protected readonly today = todayIso();

  protected readonly report = signal<WorkloadReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  /* --------------------------------------------------------------- filters */

  /** Empty set means "no filter", which reads better than listing everything. */
  protected readonly projectFilter = signal<ReadonlySet<string>>(new Set());
  protected readonly teamFilter = signal<ReadonlySet<string>>(new Set());
  protected readonly personSearch = signal('');
  protected readonly onlyWithWork = signal(true);
  protected readonly sortBy = signal<SortKey>('load');
  protected readonly zoom = signal<ZoomLevel>('week');

  /** `null` until the user overrides it; defaults to the span of all work. */
  protected readonly windowFrom = signal<string | null>(null);
  protected readonly windowTo = signal<string | null>(null);

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

  /* ------------------------------------------------------------- selection */

  private toggleIn(
    target: ReturnType<typeof signal<ReadonlySet<string>>>,
    id: string,
  ): void {
    target.update((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected toggleProject(id: string): void {
    this.toggleIn(this.projectFilter, id);
  }

  protected toggleTeam(id: string): void {
    this.toggleIn(this.teamFilter, id);
  }

  protected clearFilters(): void {
    this.projectFilter.set(new Set());
    this.teamFilter.set(new Set());
    this.personSearch.set('');
    this.windowFrom.set(null);
    this.windowTo.set(null);
  }

  protected readonly hasFilters = computed(
    () =>
      this.projectFilter().size > 0 ||
      this.teamFilter().size > 0 ||
      this.personSearch().trim().length > 0 ||
      this.windowFrom() !== null,
  );

  /* ---------------------------------------------------------------- window */

  /** Report window: the user's choice, else the span of all scheduled work. */
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

  /* --------------------------------------------------------------- filtered */

  protected readonly filteredAssignments = computed<Assignment[]>(() => {
    const report = this.report();
    if (!report) return [];

    const projects = this.projectFilter();
    const teams = this.teamFilter();
    const { from, to } = this.window();

    return report.assignments.filter(
      (a) =>
        (projects.size === 0 || projects.has(a.projectId)) &&
        (teams.size === 0 || teams.has(a.teamId)) &&
        // Overlapping the window is enough; work spanning the boundary still
        // occupies the person during it.
        a.endDate >= from &&
        a.startDate <= to,
    );
  });

  /** People matching the search and team filter, before the "has work" cut. */
  private readonly candidateUsers = computed(() => {
    const report = this.report();
    if (!report) return [];

    const term = this.personSearch().trim().toLowerCase();
    const teams = this.teamFilter();

    return report.users.filter(
      (user) =>
        (teams.size === 0 || (user.teamId !== null && teams.has(user.teamId))) &&
        (term === '' ||
          user.name.toLowerCase().includes(term) ||
          (user.title ?? '').toLowerCase().includes(term)),
    );
  });

  protected readonly workloads = computed<PersonWorkload[]>(() => {
    const built = buildWorkload(
      this.candidateUsers(),
      this.filteredAssignments(),
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
      // Busiest first, and among equals the one juggling more at once.
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

  protected readonly rows = computed<ReportRow[]>(() => {
    const timeline = this.timeline();
    const fmt = this.settings.dateFormat();
    let top = 0;

    return this.workloads().map((workload) => {
      const bars: ReportBar[] = [];

      workload.lanes.forEach((lane, laneIndex) => {
        for (const assignment of lane) {
          const x = timeline.xFor(assignment.startDate);
          const width = Math.max(timeline.widthFor(assignment.startDate, assignment.endDate) - 1, 3);

          bars.push({
            assignment,
            x,
            width,
            y: top + ROW_PADDING / 2 + laneIndex * LANE_HEIGHT + (LANE_HEIGHT - BAR_HEIGHT) / 2,
            tooltip: [
              assignment.name,
              `${assignment.projectName} · ${assignment.teamName}`,
              `${formatShort(assignment.startDate, fmt)} ← ${formatShort(assignment.endDate, fmt)}`,
              `${assignmentDays(assignment)} روز · ${MODULE_STATUS_LABELS[assignment.status]}`,
            ].join('\n'),
          });
        }
      });

      const band = (start: string, end: string, label: string): Band => ({
        x: timeline.xFor(start),
        width: timeline.widthFor(start, end),
        label,
      });

      const lanes = Math.max(1, workload.lanes.length);
      const height = lanes * LANE_HEIGHT + ROW_PADDING;

      const row: ReportRow = {
        workload,
        top,
        height,
        bars,
        gaps: workload.gaps.map((gap) => band(gap.start, gap.end, `${gap.days} روز آزاد`)),
        overloads: workload.overloads.map((overload) =>
          band(overload.start, overload.end, `${overload.peak} کار هم‌زمان`),
        ),
      };

      top += height;
      return row;
    });
  });

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

  /** Work nobody owns — the gap a capacity report exists to catch. */
  protected readonly unassigned = computed(() =>
    this.filteredAssignments().filter((a) => a.assigneeId === null),
  );

  /** People carrying two or more things at once, worst first. */
  protected readonly overloadedPeople = computed(() =>
    this.workloads()
      .filter((w) => w.overloadedDays > 0)
      .sort((a, b) => b.overloadedDays - a.overloadedDays),
  );

  /** Who has capacity, soonest and largest opening first. */
  protected readonly availablePeople = computed(() =>
    this.workloads()
      .filter((w) => w.freeDays > 0)
      .sort((a, b) => b.freeDays - a.freeDays)
      .slice(0, 8),
  );

  /** Assignments already past their end date and not finished. */
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

  protected days(assignment: Assignment): number {
    return assignmentDays(assignment);
  }

  protected percent(value: number): number {
    return Math.round(value * 100);
  }

  /** Assignee name for the unassigned/overdue tables. */
  protected assigneeName(assignment: Assignment): string {
    const report = this.report();
    const user = report?.users.find((u) => u.id === assignment.assigneeId);
    return user?.name ?? 'بدون مسئول';
  }

  protected userById(id: string | null) {
    return this.report()?.users.find((u) => u.id === id) ?? null;
  }

  /** How overloaded someone is, for the row's warning styling. */
  protected loadClass(workload: PersonWorkload): string {
    if (workload.overloadedDays > 0) return 'is-overloaded';
    if (workload.assignments.length === 0) return 'is-idle';
    return '';
  }

  protected daysBetween(from: string, to: string): number {
    return Math.max(0, Number(new Date(to).getTime() - new Date(from).getTime()) / 86_400_000) + 1;
  }

  protected clampedWindowLabel(): string {
    const { from, to } = this.window();
    return `${this.long(minIso(from, to))} — ${this.long(maxIso(from, to))}`;
  }
}
