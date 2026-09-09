import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, catchError, map, throwError } from 'rxjs';

import type {
  Board,
  Dependency,
  DependencyInput,
  Project,
  ProjectInput,
  ProjectModule,
  ModuleInput,
  Team,
  TeamInput,
  User,
  UserInput,
  WorkloadReport,
} from './models';

/** Base URL of the REST API, overridable in `app.config.ts`. */
export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:3001/api',
});

/** The API wraps every success in `{ data }`. */
interface Envelope<T> {
  data: T;
}

/** A module update also reports whatever the cascade dragged along with it. */
interface ModuleUpdateEnvelope {
  data: ProjectModule;
  moved: ProjectModule[];
}

/** A failed call, flattened into something a template can render. */
export class ApiFailure extends Error {
  constructor(
    override readonly message: string,
    readonly status: number,
    readonly details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

function describe(error: HttpErrorResponse): ApiFailure {
  if (error.status === 0) {
    return new ApiFailure(
      'ارتباط با سرور برقرار نشد. آیا سرور روی پورت ۳۰۰۱ در حال اجراست؟',
      0,
    );
  }

  const body = error.error as
    | { error?: { message?: string; details?: { field: string; message: string }[] } }
    | undefined;

  return new ApiFailure(
    body?.error?.message ?? `درخواست ناموفق بود (${error.status}).`,
    error.status,
    body?.error?.details,
  );
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE_URL);

  /* ------------------------------------------------------------ projects -- */

  listProjects(search?: string): Observable<Project[]> {
    const params = search ? new HttpParams().set('q', search) : undefined;
    return this.unwrap(this.http.get<Envelope<Project[]>>(`${this.base}/projects`, { params }));
  }

  getProject(projectId: string): Observable<Project> {
    return this.unwrap(this.http.get<Envelope<Project>>(`${this.base}/projects/${projectId}`));
  }

  /** Project, rows, bars, arrows and violations in a single round trip. */
  getBoard(projectId: string): Observable<Board> {
    return this.unwrap(
      this.http.get<Envelope<Board>>(`${this.base}/projects/${projectId}/board`),
    );
  }

  createProject(input: ProjectInput): Observable<Project> {
    return this.unwrap(this.http.post<Envelope<Project>>(`${this.base}/projects`, input));
  }

  updateProject(projectId: string, input: Partial<ProjectInput>): Observable<Project> {
    return this.unwrap(
      this.http.patch<Envelope<Project>>(`${this.base}/projects/${projectId}`, input),
    );
  }

  deleteProject(projectId: string): Observable<void> {
    return this.handle(this.http.delete<void>(`${this.base}/projects/${projectId}`));
  }

  /* --------------------------------------------------------------- teams -- */

  /** Teams are global; every project's chart shows all of them. */
  listTeams(search?: string): Observable<Team[]> {
    const params = search ? new HttpParams().set('q', search) : undefined;
    return this.unwrap(this.http.get<Envelope<Team[]>>(`${this.base}/teams`, { params }));
  }

  createTeam(input: TeamInput): Observable<Team> {
    return this.unwrap(this.http.post<Envelope<Team>>(`${this.base}/teams`, input));
  }

  updateTeam(teamId: string, input: Partial<TeamInput>): Observable<Team> {
    return this.unwrap(this.http.patch<Envelope<Team>>(`${this.base}/teams/${teamId}`, input));
  }

  /**
   * `force` also deletes the team's modules — in *every* project, not just the
   * one on screen. Without it a non-empty team is refused.
   */
  deleteTeam(
    teamId: string,
    force = false,
  ): Observable<{ id: string; deletedModules: number; unassignedMembers: number }> {
    const params = force ? new HttpParams().set('force', 'true') : undefined;
    return this.unwrap(
      this.http.delete<Envelope<{ id: string; deletedModules: number; unassignedMembers: number }>>(
        `${this.base}/teams/${teamId}`,
        { params },
      ),
    );
  }

  /** Default order for newly linked rows; each project can then reorder its own. */
  reorderTeams(ids: string[]): Observable<Team[]> {
    return this.unwrap(
      this.http.post<Envelope<Team[]>>(`${this.base}/teams/reorder`, { ids }),
    );
  }

  /* ----------------------------------------------- project ↔ team links -- */

  /** The teams this project involves, in its own row order. */
  listProjectTeams(projectId: string): Observable<Team[]> {
    return this.unwrap(
      this.http.get<Envelope<Team[]>>(`${this.base}/projects/${projectId}/teams`),
    );
  }

  /**
   * Connects the project to exactly `teamIds` from the registry — this never
   * creates a team. `force` allows dropping a team that still holds modules,
   * deleting them.
   */
  setProjectTeams(projectId: string, teamIds: string[], force = false): Observable<Team[]> {
    const params = force ? new HttpParams().set('force', 'true') : undefined;
    return this.unwrap(
      this.http.put<Envelope<Team[]>>(
        `${this.base}/projects/${projectId}/teams`,
        { teamIds },
        { params },
      ),
    );
  }

  /** Removes one row from this project. The team itself is untouched. */
  unlinkProjectTeam(
    projectId: string,
    teamId: string,
    force = false,
  ): Observable<{ teamId: string; removedModules: number }> {
    const params = force ? new HttpParams().set('force', 'true') : undefined;
    return this.unwrap(
      this.http.delete<Envelope<{ teamId: string; removedModules: number }>>(
        `${this.base}/projects/${projectId}/teams/${teamId}`,
        { params },
      ),
    );
  }

  /** Row order for this project only. */
  reorderProjectTeams(projectId: string, ids: string[]): Observable<Team[]> {
    return this.unwrap(
      this.http.post<Envelope<Team[]>>(`${this.base}/projects/${projectId}/teams/reorder`, {
        ids,
      }),
    );
  }

  /* --------------------------------------------------------------- users -- */

  listUsers(search?: string): Observable<User[]> {
    const params = search ? new HttpParams().set('q', search) : undefined;
    return this.unwrap(this.http.get<Envelope<User[]>>(`${this.base}/users`, { params }));
  }

  createUser(input: UserInput): Observable<User> {
    return this.unwrap(this.http.post<Envelope<User>>(`${this.base}/users`, input));
  }

  updateUser(userId: string, input: Partial<UserInput>): Observable<User> {
    return this.unwrap(this.http.patch<Envelope<User>>(`${this.base}/users/${userId}`, input));
  }

  /** Their modules are not deleted — they become unassigned. */
  deleteUser(userId: string): Observable<{ id: string; unassignedModules: number }> {
    return this.unwrap(
      this.http.delete<Envelope<{ id: string; unassignedModules: number }>>(
        `${this.base}/users/${userId}`,
      ),
    );
  }

  /* ------------------------------------------------------------- modules -- */

  /**
   * One module in full.
   *
   * The report's flattened assignments omit `description`, `color` and
   * `sortOrder`; editing from those alone would blank the notes on save, so
   * the editor is opened on a freshly fetched record.
   */
  getModule(moduleId: string): Observable<ProjectModule> {
    return this.unwrap(
      this.http.get<Envelope<ProjectModule>>(`${this.base}/modules/${moduleId}`),
    );
  }

  createModule(projectId: string, input: ModuleInput): Observable<ProjectModule> {
    return this.unwrap(
      this.http.post<Envelope<ProjectModule>>(
        `${this.base}/projects/${projectId}/modules`,
        input,
      ),
    );
  }

  /**
   * With `cascade`, dependent modules are pushed forward to keep the plan
   * consistent; the response says which ones moved.
   */
  updateModule(
    moduleId: string,
    input: Partial<ModuleInput>,
    cascade = false,
  ): Observable<{ module: ProjectModule; moved: ProjectModule[] }> {
    const params = cascade ? new HttpParams().set('cascade', 'true') : undefined;
    return this.http
      .patch<ModuleUpdateEnvelope>(`${this.base}/modules/${moduleId}`, input, { params })
      .pipe(
        map((response) => ({ module: response.data, moved: response.moved ?? [] })),
        catchError((error: HttpErrorResponse) => throwError(() => describe(error))),
      );
  }

  deleteModule(moduleId: string): Observable<void> {
    return this.handle(this.http.delete<void>(`${this.base}/modules/${moduleId}`));
  }

  /* -------------------------------------------------------- dependencies -- */

  createDependency(projectId: string, input: DependencyInput): Observable<Dependency> {
    return this.unwrap(
      this.http.post<Envelope<Dependency>>(
        `${this.base}/projects/${projectId}/dependencies`,
        input,
      ),
    );
  }

  updateDependency(
    dependencyId: string,
    input: Partial<Pick<DependencyInput, 'type' | 'lagDays'>>,
  ): Observable<Dependency> {
    return this.unwrap(
      this.http.patch<Envelope<Dependency>>(`${this.base}/dependencies/${dependencyId}`, input),
    );
  }

  deleteDependency(dependencyId: string): Observable<void> {
    return this.handle(this.http.delete<void>(`${this.base}/dependencies/${dependencyId}`));
  }

  /** Moves several modules by the same number of days, in one transaction. */
  shiftModules(
    projectId: string,
    moduleIds: string[],
    deltaDays: number,
    cascade: boolean,
  ): Observable<{ modules: ProjectModule[]; moved: ProjectModule[] }> {
    const params = cascade ? new HttpParams().set('cascade', 'true') : undefined;

    return this.unwrap(
      this.http.post<Envelope<{ modules: ProjectModule[]; moved: ProjectModule[] }>>(
        `${this.base}/projects/${projectId}/modules/shift`,
        { moduleIds, deltaDays },
        { params },
      ),
    );
  }

  /* ------------------------------------------------------------- reports -- */

  /** Every assignment in the workspace, for the cross-project people report. */
  getWorkload(range?: { from?: string; to?: string }): Observable<WorkloadReport> {
    let params = new HttpParams();
    if (range?.from) params = params.set('from', range.from);
    if (range?.to) params = params.set('to', range.to);

    return this.unwrap(
      this.http.get<Envelope<WorkloadReport>>(`${this.base}/reports/workload`, { params }),
    );
  }

  /* -------------------------------------------------------------- shared -- */

  private unwrap<T>(source: Observable<Envelope<T>>): Observable<T> {
    return source.pipe(
      map((response) => response.data),
      catchError((error: HttpErrorResponse) => throwError(() => describe(error))),
    );
  }

  private handle<T>(source: Observable<T>): Observable<T> {
    return source.pipe(
      catchError((error: HttpErrorResponse) => throwError(() => describe(error))),
    );
  }
}
