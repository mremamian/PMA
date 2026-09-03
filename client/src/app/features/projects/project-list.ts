import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';

import { ApiService, type ApiFailure } from '../../core/api.service';
import { SettingsStore } from '../../core/settings.store';
import { formatLong, minIso, todayIso, workingDaysBetween } from '../../core/jalali';
import {
  PROJECT_STATUS_LABELS,
  type Project,
  type ProjectInput,
  type ProjectStatus,
} from '../../core/models';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog';
import { DigitsPipe } from '../../shared/digits.pipe';
import { ProjectEditorComponent } from './project-editor';

@Component({
  selector: 'pma-project-list',
  imports: [RouterLink, ProjectEditorComponent, ConfirmDialogComponent, DigitsPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-list.html',
  styleUrl: './project-list.scss',
})
export class ProjectListComponent {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  protected readonly settings = inject(SettingsStore);

  protected readonly projects = signal<Project[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly search = signal('');

  /** `null` = closed, `'new'` = create, otherwise the project being edited. */
  protected readonly editing = signal<Project | 'new' | null>(null);
  protected readonly deleting = signal<Project | null>(null);

  protected readonly statusLabels = PROJECT_STATUS_LABELS;

  protected readonly visibleProjects = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.projects();

    return this.projects().filter(
      (project) =>
        project.name.toLowerCase().includes(term) ||
        project.description.toLowerCase().includes(term),
    );
  });

  protected readonly editingProject = computed(() => {
    const value = this.editing();
    return value === 'new' || value === null ? null : value;
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.listProjects().subscribe({
      next: (projects) => {
        this.projects.set(projects);
        this.loading.set(false);
      },
      error: (failure: ApiFailure) => {
        this.error.set(failure.message);
        this.loading.set(false);
      },
    });
  }

  protected save(input: ProjectInput): void {
    const target = this.editing();

    if (target === 'new') {
      this.api.createProject(input).subscribe({
        next: (project) => {
          this.projects.update((list) => [project, ...list]);
          this.editing.set(null);
          // Straight into the chart — a new project's whole point is its plan.
          void this.router.navigate(['/projects', project.id]);
        },
        error: (failure: ApiFailure) => this.error.set(failure.message),
      });
      return;
    }

    if (target) {
      this.api.updateProject(target.id, input).subscribe({
        next: (project) => {
          this.projects.update((list) =>
            list.map((p) => (p.id === project.id ? { ...p, ...project } : p)),
          );
          this.editing.set(null);
        },
        error: (failure: ApiFailure) => this.error.set(failure.message),
      });
    }
  }

  protected confirmDelete(): void {
    const project = this.deleting();
    if (!project) return;

    const snapshot = this.projects();
    this.projects.update((list) => list.filter((p) => p.id !== project.id));
    this.deleting.set(null);

    this.api.deleteProject(project.id).subscribe({
      error: (failure: ApiFailure) => {
        this.projects.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  /* ------------------------------------------------------------ display -- */

  protected formatDate(iso: string): string {
    return formatLong(iso, this.settings.dateFormat());
  }

  /** Working days in the planned window — Thu/Fri are not scheduled work. */
  protected durationDays(project: Project): number {
    return workingDaysBetween(project.startDate, project.endDate);
  }

  /** How far through the planned working days we are, clamped to 0-100. */
  protected elapsedPercent(project: Project): number {
    const total = workingDaysBetween(project.startDate, project.endDate);
    if (total === 0) return 0;

    const today = todayIso();
    if (today < project.startDate) return 0;

    const elapsed = workingDaysBetween(project.startDate, minIso(today, project.endDate));
    return Math.max(0, Math.min(100, Math.round((elapsed / total) * 100)));
  }

  protected isOverdue(project: Project): boolean {
    return project.endDate < todayIso() && project.status !== 'done';
  }

  protected statusClass(status: ProjectStatus): string {
    switch (status) {
      case 'active':
        return 'chip--accent';
      case 'done':
        return 'chip--success';
      case 'on_hold':
        return 'chip--warning';
      default:
        return '';
    }
  }

  protected deleteDetail(project: Project): string | null {
    const modules = project.moduleCount ?? 0;
    const teams = project.teamCount ?? 0;
    if (!modules && !teams) return null;

    // Persian has no plural -s, so counts read the same either way.
    return `با این کار ${teams} ردیف و ${modules} ماژول، و همهٔ وابستگی‌های میان آن‌ها هم حذف می‌شود.`;
  }
}
