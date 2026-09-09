import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize } from 'rxjs';

import { ApiService, ApiFailure } from './api.service';
import { addDays, diffDays, maxIso, minIso, todayIso, workingDaysBetween } from './jalali';
import { findViolations } from './scheduling';
import type {
  Board,
  Dependency,
  DependencyInput,
  Project,
  ProjectModule,
  ModuleInput,
  Team,
  TeamInput,
  User,
} from './models';

/** A team plus the bars that belong to it — one row of the chart. */
export interface BoardRow {
  team: Team;
  modules: ProjectModule[];
}

/**
 * Holds the board currently open in the Gantt view.
 *
 * Every mutation is applied to the signals first and sent to the API second.
 * Dragging a bar has to feel immediate, so the UI never waits for a round
 * trip; if the write fails the previous state is restored and the error is
 * surfaced. The server response is then merged back, which is what carries
 * cascaded dates for the modules the user did not touch.
 */
@Injectable({ providedIn: 'root' })
export class BoardStore {
  private readonly api = inject(ApiService);

  readonly project = signal<Project | null>(null);
  readonly teams = signal<Team[]>([]);
  readonly modules = signal<ProjectModule[]>([]);
  readonly dependencies = signal<Dependency[]>([]);
  /** The global people directory, shipped with the board. */
  readonly users = signal<User[]>([]);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Number of writes in flight; drives the "saving" indicator. */
  readonly pending = signal(0);

  /**
   * Selected modules, in click order — the last is the anchor.
   *
   * An array rather than a Set so "the one you just clicked" stays knowable,
   * which is what the details panel shows when exactly one is selected.
   */
  readonly selection = signal<readonly string[]>([]);

  readonly selectedModuleIds = computed(() => new Set(this.selection()));

  /** The single selected module, or null when zero or several are selected. */
  readonly selectedModuleId = computed(() =>
    this.selection().length === 1 ? this.selection()[0] : null,
  );

  /** Every selected module, skipping ids that no longer exist. */
  readonly selectedModules = computed(() => {
    const byId = this.moduleById();
    return this.selection()
      .map((id) => byId.get(id))
      .filter((m): m is ProjectModule => m !== undefined);
  });

  /**
   * `additive` (ctrl/cmd-click) toggles the module in the selection; without
   * it the click replaces the selection.
   */
  selectModule(moduleId: string, additive = false): void {
    this.selection.update((current) => {
      if (!additive) return [moduleId];
      return current.includes(moduleId)
        ? current.filter((id) => id !== moduleId)
        : [...current, moduleId];
    });
  }

  clearSelection(): void {
    this.selection.set([]);
  }
  readonly today = signal(todayIso());

  /* ------------------------------------------------------------- derived -- */

  readonly moduleById = computed(() => new Map(this.modules().map((m) => [m.id, m])));

  readonly userById = computed(() => new Map(this.users().map((u) => [u.id, u])));

  /** How many modules each person is carrying on this board. */
  readonly workloadByUser = computed(() => {
    const counts = new Map<string, number>();
    for (const module of this.modules()) {
      if (!module.assigneeId) continue;
      counts.set(module.assigneeId, (counts.get(module.assigneeId) ?? 0) + 1);
    }
    return counts;
  });

  readonly rows = computed<BoardRow[]>(() => {
    const grouped = new Map<string, ProjectModule[]>();
    for (const module of this.modules()) {
      const list = grouped.get(module.teamId);
      if (list) list.push(module);
      else grouped.set(module.teamId, [module]);
    }

    return [...this.teams()]
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      .map((team) => ({
        team,
        modules: (grouped.get(team.id) ?? []).sort(
          (a, b) => a.startDate.localeCompare(b.startDate) || a.sortOrder - b.sortOrder,
        ),
      }));
  });

  readonly violations = computed(() => findViolations(this.modules(), this.dependencies()));

  readonly violatingDependencyIds = computed(
    () => new Set(this.violations().map((v) => v.dependencyId)),
  );

  readonly selectedModule = computed(() => {
    const id = this.selectedModuleId();
    return id ? (this.moduleById().get(id) ?? null) : null;
  });

  /** Full span to draw: the planned window widened to cover every bar. */
  readonly span = computed(() => {
    const project = this.project();
    const modules = this.modules();

    if (!project) {
      const today = this.today();
      return { start: today, end: addDays(today, 90) };
    }

    let start = project.startDate;
    let end = project.endDate;

    for (const module of modules) {
      start = minIso(start, module.startDate);
      end = maxIso(end, module.endDate);
    }

    return { start, end };
  });

  readonly stats = computed(() => {
    const modules = this.modules();
    const today = this.today();

    const milestones = modules.filter((m) => m.kind === 'milestone').length;
    const done = modules.filter((m) => m.status === 'done').length;
    const overdue = modules.filter(
      (m) => m.status !== 'done' && m.endDate < today,
    ).length;

    return {
      teams: this.teams().length,
      externalRows: this.teams().filter((t) => t.kind === 'external').length,
      modules: modules.length,
      milestones,
      done,
      inProgress: modules.filter((m) => m.status === 'in_progress').length,
      blocked: modules.filter((m) => m.status === 'blocked').length,
      overdue,
      dependencies: this.dependencies().length,
      conflicts: this.violations().length,
      percentComplete: modules.length
        ? Math.round(modules.reduce((sum, m) => sum + m.progress, 0) / modules.length)
        : 0,
    };
  });

  /* --------------------------------------------------------------- load -- */

  load(projectId: string): void {
    this.loading.set(true);
    this.error.set(null);

    this.api.getBoard(projectId).subscribe({
      next: (board) => {
        this.apply(board);
        this.loading.set(false);
      },
      error: (failure: ApiFailure) => {
        this.error.set(failure.message);
        this.loading.set(false);
      },
    });
  }

  private apply(board: Board): void {
    this.project.set(board.project);
    this.teams.set(board.teams);
    this.modules.set(board.modules);
    this.dependencies.set(board.dependencies);
    this.users.set(board.users ?? []);
    this.today.set(todayIso());
  }

  /** Re-read the directory after it was edited on the Users page. */
  refreshUsers(): void {
    this.api.listUsers().subscribe({
      next: (users) => this.users.set(users),
      error: (failure: ApiFailure) => this.error.set(failure.message),
    });
  }

  clear(): void {
    this.project.set(null);
    this.teams.set([]);
    this.modules.set([]);
    this.dependencies.set([]);
    this.users.set([]);
    this.selection.set([]);
    this.error.set(null);
  }

  dismissError(): void {
    this.error.set(null);
  }

  /* ------------------------------------------------------------ modules -- */

  createModule(input: ModuleInput): void {
    const projectId = this.project()?.id;
    if (!projectId) return;

    this.track(this.api.createModule(projectId, input)).subscribe({
      next: (module) => this.modules.update((list) => [...list, module]),
      error: (failure: ApiFailure) => this.error.set(failure.message),
    });
  }

  /**
   * Commit a drag or resize. Applied locally at once; the response merges back
   * both the module itself and anything the cascade pushed along with it.
   */
  moveModule(
    moduleId: string,
    startDate: string,
    endDate: string,
    cascade: boolean,
  ): void {
    const snapshot = this.modules();
    const current = snapshot.find((m) => m.id === moduleId);
    if (!current || (current.startDate === startDate && current.endDate === endDate)) return;

    this.patchLocal(moduleId, { startDate, endDate });

    this.track(this.api.updateModule(moduleId, { startDate, endDate }, cascade)).subscribe({
      next: ({ module, moved }) => this.mergeModules([module, ...moved]),
      error: (failure: ApiFailure) => {
        this.modules.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  updateModule(moduleId: string, patch: Partial<ModuleInput>, cascade = false): void {
    const snapshot = this.modules();
    this.patchLocal(moduleId, patch as Partial<ProjectModule>);

    this.track(this.api.updateModule(moduleId, patch, cascade)).subscribe({
      next: ({ module, moved }) => this.mergeModules([module, ...moved]),
      error: (failure: ApiFailure) => {
        this.modules.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  deleteModule(moduleId: string): void {
    const moduleSnapshot = this.modules();
    const dependencySnapshot = this.dependencies();

    // Its arrows go with it on the server, so drop them locally too.
    this.modules.update((list) => list.filter((m) => m.id !== moduleId));
    this.dependencies.update((list) =>
      list.filter((d) => d.fromModuleId !== moduleId && d.toModuleId !== moduleId),
    );
    this.selection.update((current) => current.filter((id) => id !== moduleId));

    this.track(this.api.deleteModule(moduleId)).subscribe({
      error: (failure: ApiFailure) => {
        this.modules.set(moduleSnapshot);
        this.dependencies.set(dependencySnapshot);
        this.error.set(failure.message);
      },
    });
  }

  /* -------------------------------------------------------------- teams -- */

  /**
   * Connects this project to exactly `teamIds`, chosen from the registry.
   *
   * There is deliberately no "create team" here: a team is a workspace-level
   * record, and minting one from inside a project is how duplicate teams get
   * made. New teams are created on the Teams page.
   */
  setProjectTeams(teamIds: string[], force = false): void {
    const projectId = this.project()?.id;
    if (!projectId) return;

    this.track(this.api.setProjectTeams(projectId, teamIds, force)).subscribe({
      next: (teams) => this.teams.set(teams),
      error: (failure: ApiFailure) => this.error.set(failure.message),
    });
  }

  /** Removes one row from this project; the team itself survives. */
  unlinkTeam(teamId: string, force: boolean): void {
    const projectId = this.project()?.id;
    if (!projectId) return;

    const teamSnapshot = this.teams();
    const moduleSnapshot = this.modules();
    const dependencySnapshot = this.dependencies();

    const doomed = new Set(
      moduleSnapshot.filter((m) => m.teamId === teamId).map((m) => m.id),
    );

    this.teams.update((list) => list.filter((t) => t.id !== teamId));
    this.modules.update((list) => list.filter((m) => m.teamId !== teamId));
    this.dependencies.update((list) =>
      list.filter((d) => !doomed.has(d.fromModuleId) && !doomed.has(d.toModuleId)),
    );

    this.track(this.api.unlinkProjectTeam(projectId, teamId, force)).subscribe({
      error: (failure: ApiFailure) => {
        this.teams.set(teamSnapshot);
        this.modules.set(moduleSnapshot);
        this.dependencies.set(dependencySnapshot);
        this.error.set(failure.message);
      },
    });
  }

  updateTeam(teamId: string, patch: Partial<TeamInput>): void {
    const snapshot = this.teams();
    this.teams.update((list) =>
      list.map((team) => (team.id === teamId ? { ...team, ...patch } : team)),
    );

    this.track(this.api.updateTeam(teamId, patch)).subscribe({
      next: (team) =>
        this.teams.update((list) => list.map((t) => (t.id === team.id ? team : t))),
      error: (failure: ApiFailure) => {
        this.teams.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  /** `ids` is the full ordered list of row ids for *this* project. */
  reorderTeams(ids: string[]): void {
    const projectId = this.project()?.id;
    if (!projectId) return;

    const snapshot = this.teams();
    const position = new Map(ids.map((id, index) => [id, index]));
    this.teams.update((list) =>
      [...list].sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0)),
    );

    this.track(this.api.reorderProjectTeams(projectId, ids)).subscribe({
      next: (teams) => this.teams.set(teams),
      error: (failure: ApiFailure) => {
        this.teams.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  /** Move one row up or down by a single position. */
  moveTeam(teamId: string, direction: -1 | 1): void {
    const ordered = this.rows().map((row) => row.team.id);
    const index = ordered.indexOf(teamId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= ordered.length) return;

    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    this.reorderTeams(ordered);
  }

  /* ------------------------------------------------------- dependencies -- */

  createDependency(input: DependencyInput): void {
    const projectId = this.project()?.id;
    if (!projectId) return;

    this.track(this.api.createDependency(projectId, input)).subscribe({
      next: (dependency) => this.dependencies.update((list) => [...list, dependency]),
      error: (failure: ApiFailure) => this.error.set(failure.message),
    });
  }

  updateDependency(dependencyId: string, patch: Partial<DependencyInput>): void {
    const snapshot = this.dependencies();
    this.dependencies.update((list) =>
      list.map((d) => (d.id === dependencyId ? { ...d, ...patch } : d)),
    );

    this.track(this.api.updateDependency(dependencyId, patch)).subscribe({
      next: (dependency) =>
        this.dependencies.update((list) =>
          list.map((d) => (d.id === dependency.id ? dependency : d)),
        ),
      error: (failure: ApiFailure) => {
        this.dependencies.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  deleteDependency(dependencyId: string): void {
    const snapshot = this.dependencies();
    this.dependencies.update((list) => list.filter((d) => d.id !== dependencyId));

    this.track(this.api.deleteDependency(dependencyId)).subscribe({
      error: (failure: ApiFailure) => {
        this.dependencies.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  /* ------------------------------------------------------------ helpers -- */

  /** Predecessors and successors of a module, for the detail panel. */
  linksFor(moduleId: string): { incoming: Dependency[]; outgoing: Dependency[] } {
    const all = this.dependencies();
    return {
      incoming: all.filter((d) => d.toModuleId === moduleId),
      outgoing: all.filter((d) => d.fromModuleId === moduleId),
    };
  }

  /** Inclusive length of a module in *working* days — Thu/Fri excluded. */
  durationOf(module: ProjectModule): number {
    return workingDaysBetween(module.startDate, module.endDate);
  }

  /** The person a module is assigned to, or null. */
  assigneeOf(module: ProjectModule): User | null {
    return module.assigneeId ? (this.userById().get(module.assigneeId) ?? null) : null;
  }

  /** People whose home team is `teamId`. */
  membersOf(teamId: string | null): User[] {
    return teamId ? this.users().filter((user) => user.teamId === teamId) : [];
  }

  /**
   * Who a module can be assigned to: its team's members, falling back to
   * everyone when the team has none yet, and always including whoever is
   * already assigned so an existing assignment is never hidden.
   */
  assignableFor(module: ProjectModule): User[] {
    const members = this.membersOf(module.teamId);
    const base = members.length ? members : this.users();
    const current = this.assigneeOf(module);

    return current && !base.some((user) => user.id === current.id)
      ? [current, ...base]
      : base;
  }

  /**
   * Moves several modules by the same number of calendar days.
   *
   * Goes to the bulk endpoint rather than looping over `updateModule`: one
   * transaction means a failure cannot leave half the selection moved, and
   * dependents cascade behind the whole group instead of behind whichever
   * module happened to be saved last.
   */
  shiftModules(moduleIds: readonly string[], deltaDays: number, cascade: boolean): void {
    const projectId = this.project()?.id;
    if (!projectId || moduleIds.length === 0 || deltaDays === 0) return;

    const snapshot = this.modules();
    const targets = new Set(moduleIds);

    this.modules.update((list) =>
      list.map((module) =>
        targets.has(module.id)
          ? {
              ...module,
              startDate: addDays(module.startDate, deltaDays),
              endDate: addDays(module.endDate, deltaDays),
            }
          : module,
      ),
    );

    this.track(this.api.shiftModules(projectId, [...moduleIds], deltaDays, cascade)).subscribe({
      next: ({ modules, moved }) => {
        const updated = new Map([...modules, ...moved].map((m) => [m.id, m]));
        this.modules.update((list) => list.map((m) => updated.get(m.id) ?? m));
      },
      error: (failure: ApiFailure) => {
        this.modules.set(snapshot);
        this.error.set(failure.message);
      },
    });
  }

  /** Assign or (with `null`) unassign a module. */
  assignModule(moduleId: string, assigneeId: string | null): void {
    this.updateModule(moduleId, { assigneeId });
  }

  private patchLocal(moduleId: string, patch: Partial<ProjectModule>): void {
    this.modules.update((list) =>
      list.map((m) => (m.id === moduleId ? { ...m, ...patch } : m)),
    );
  }

  private mergeModules(updated: ProjectModule[]): void {
    if (!updated.length) return;
    const byId = new Map(updated.map((m) => [m.id, m]));
    this.modules.update((list) => list.map((m) => byId.get(m.id) ?? m));
  }

  /** Wraps a mutation so `pending` reflects in-flight writes. */
  private track<T>(source: Observable<T>): Observable<T> {
    this.pending.update((count) => count + 1);
    return source.pipe(finalize(() => this.pending.update((count) => Math.max(0, count - 1))));
  }
}
