import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

import { ApiService, type ApiFailure } from '../../core/api.service';
import { BoardStore } from '../../core/board.store';
import { SettingsStore } from '../../core/settings.store';
import { formatLong, formatShort } from '../../core/jalali';
import { ZOOM_PRESETS, type ZoomLevel } from '../../core/timeline';
import {
  MODULE_STATUS_LABELS,
  type Dependency,
  type DependencyType,
  type ModuleInput,
  type Project,
  type ProjectInput,
  type ProjectModule,
  type Team,
  type TeamInput,
} from '../../core/models';

import { GanttChartComponent } from './gantt-chart';
import { TeamEditorComponent } from './team-editor';
import { TeamPickerComponent } from './team-picker';
import { ModuleEditorComponent } from './module-editor';
import { DependencyEditorComponent } from './dependency-editor';
import { ProjectEditorComponent } from '../projects/project-editor';
import { AvatarComponent } from '../../shared/avatar';
import { ConfirmDialogComponent } from '../../shared/confirm-dialog';
import { DigitsPipe } from '../../shared/digits.pipe';

/** Which module dialog is open, and in what mode. */
type ModuleDialog =
  | { mode: 'edit'; module: ProjectModule }
  | { mode: 'create'; teamId: string | null }
  | null;

@Component({
  selector: 'pma-gantt-page',
  imports: [
    RouterLink,
    GanttChartComponent,
    TeamEditorComponent,
    TeamPickerComponent,
    ModuleEditorComponent,
    DependencyEditorComponent,
    ProjectEditorComponent,
    AvatarComponent,
    ConfirmDialogComponent,
    DigitsPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gantt-page.html',
  styleUrl: './gantt-page.scss',
})
export class GanttPageComponent {
  private readonly api = inject(ApiService);
  protected readonly store = inject(BoardStore);
  protected readonly settings = inject(SettingsStore);

  /** Bound from the `:projectId` route param. */
  readonly projectId = input.required<string>();

  protected readonly zoomPresets = ZOOM_PRESETS;
  protected readonly statusLabels = MODULE_STATUS_LABELS;

  protected readonly zoomLabels: Record<ZoomLevel, string> = {
    day: 'روز',
    week: 'هفته',
    month: 'ماه',
    quarter: 'فصل',
  };

  /** Editing an existing team's name/colour; creation happens on /teams. */
  protected readonly teamDialog = signal<Team | null>(null);
  /** Choosing which registry teams this project involves. */
  protected readonly teamPickerOpen = signal(false);
  /** The whole registry, loaded when the picker opens. */
  protected readonly allTeams = signal<Team[]>([]);
  protected readonly unlinkingTeam = signal<Team | null>(null);
  protected readonly moduleDialog = signal<ModuleDialog>(null);
  protected readonly dependencyDialog = signal<Dependency | null>(null);
  protected readonly projectDialogOpen = signal(false);
  protected readonly deletingModule = signal<ProjectModule | null>(null);

  /** Modules per team in *this* project, for the picker's removal warnings. */
  protected readonly moduleCountsByTeam = computed(() => {
    const counts = new Map<string, number>();
    for (const module of this.store.modules()) {
      counts.set(module.teamId, (counts.get(module.teamId) ?? 0) + 1);
    }
    return counts;
  });

  protected readonly linkedTeamIds = computed(() => this.store.teams().map((t) => t.id));

  protected readonly editingModule = computed(() => {
    const dialog = this.moduleDialog();
    return dialog?.mode === 'edit' ? dialog.module : null;
  });

  protected readonly defaultTeamId = computed(() => {
    const dialog = this.moduleDialog();
    return dialog?.mode === 'create' ? dialog.teamId : null;
  });

  /** Predecessor/successor names for the dependency dialog. */
  protected readonly dependencyEndpoints = computed(() => {
    const dependency = this.dependencyDialog();
    if (!dependency) return { from: null, to: null };

    const byId = this.store.moduleById();
    return {
      from: byId.get(dependency.fromModuleId) ?? null,
      to: byId.get(dependency.toModuleId) ?? null,
    };
  });

  /** The selected module's links, resolved to names for the detail panel. */
  protected readonly selectedLinks = computed(() => {
    const module = this.store.selectedModule();
    if (!module) return { incoming: [], outgoing: [] };

    const byId = this.store.moduleById();
    const { incoming, outgoing } = this.store.linksFor(module.id);

    return {
      incoming: incoming.map((d) => ({ dependency: d, other: byId.get(d.fromModuleId) })),
      outgoing: outgoing.map((d) => ({ dependency: d, other: byId.get(d.toModuleId) })),
    };
  });

  protected readonly selectedTeam = computed(() => {
    const module = this.store.selectedModule();
    return module ? (this.store.teams().find((t) => t.id === module.teamId) ?? null) : null;
  });

  constructor() {
    effect(() => {
      const id = this.projectId();
      if (id) this.store.load(id);
    });
  }

  /* ---------------------------------------------------------- formatting -- */

  protected long(iso: string): string {
    return formatLong(iso, this.settings.dateFormat());
  }

  protected short(iso: string): string {
    return formatShort(iso, this.settings.dateFormat());
  }

  /* -------------------------------------------------------------- project -- */

  protected saveProject(input: ProjectInput): void {
    const project = this.store.project();
    if (!project) return;

    this.api.updateProject(project.id, input).subscribe({
      next: (updated: Project) => {
        this.store.project.set({ ...project, ...updated });
        this.projectDialogOpen.set(false);
      },
      error: (failure: ApiFailure) => this.store.error.set(failure.message),
    });
  }

  /* ----------------------------------------------------------------- rows -- */

  protected saveTeam(input: TeamInput): void {
    const target = this.teamDialog();
    if (target) this.store.updateTeam(target.id, input);
    this.teamDialog.set(null);
  }

  /** Loads the registry, then opens the picker. */
  protected openTeamPicker(): void {
    this.teamPickerOpen.set(true);
    this.api.listTeams().subscribe({
      next: (teams) => this.allTeams.set(teams),
      error: (failure: ApiFailure) => this.store.error.set(failure.message),
    });
  }

  protected saveTeamSelection(teamIds: string[]): void {
    // Force: the picker already showed exactly how many modules would go.
    this.store.setProjectTeams(teamIds, true);
    this.teamPickerOpen.set(false);
  }

  protected confirmUnlinkTeam(): void {
    const team = this.unlinkingTeam();
    if (!team) return;

    this.store.unlinkTeam(team.id, true);
    this.unlinkingTeam.set(null);
  }

  /**
   * Removing a row detaches the team from *this* project only — its work
   * elsewhere, and the team record itself, are untouched.
   */
  protected unlinkDetail(team: Team): string | null {
    const count = this.moduleCountsByTeam().get(team.id) ?? 0;
    if (!count) return null;

    return `${count} ماژول این تیم در همین پروژه حذف می‌شود. خود تیم و کارهایش در پروژه‌های دیگر دست‌نخورده می‌مانند.`;
  }


  /* -------------------------------------------------------------- modules -- */

  protected saveModule(input: ModuleInput): void {
    const dialog = this.moduleDialog();
    if (!dialog) return;

    if (dialog.mode === 'edit') this.store.updateModule(dialog.module.id, input);
    else this.store.createModule(input);

    this.moduleDialog.set(null);
  }

  protected requestDeleteModule(): void {
    const module = this.editingModule();
    if (!module) return;
    this.moduleDialog.set(null);
    this.deletingModule.set(module);
  }

  protected confirmDeleteModule(): void {
    const module = this.deletingModule();
    if (!module) return;

    this.store.deleteModule(module.id);
    this.deletingModule.set(null);
  }

  protected moduleDeleteDetail(module: ProjectModule): string | null {
    const { incoming, outgoing } = this.store.linksFor(module.id);
    const total = incoming.length + outgoing.length;
    if (!total) return null;

    return `${total} پیوند وابستگی هم همراه آن حذف می‌شود.`;
  }

  /* --------------------------------------------------------- dependencies -- */

  protected saveDependency(patch: { type: DependencyType; lagDays: number }): void {
    const dependency = this.dependencyDialog();
    if (!dependency) return;

    this.store.updateDependency(dependency.id, patch);
    this.dependencyDialog.set(null);
  }

  protected removeDependency(): void {
    const dependency = this.dependencyDialog();
    if (!dependency) return;

    this.store.deleteDependency(dependency.id);
    this.dependencyDialog.set(null);
  }

  /* ----------------------------------------------------------------- misc -- */

  protected setZoom(value: string): void {
    this.settings.setZoom(value as ZoomLevel);
  }

  protected openModuleEditor(module: ProjectModule): void {
    this.moduleDialog.set({ mode: 'edit', module });
  }

  protected openNewModule(team?: Team): void {
    this.moduleDialog.set({ mode: 'create', teamId: team?.id ?? null });
  }
}
