/** Wire types shared with the REST API. Dates are Gregorian `YYYY-MM-DD`. */

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'done' | 'archived';
export type TeamKind = 'team' | 'external';
export type ModuleKind = 'task' | 'milestone';
export type ModuleStatus = 'planned' | 'in_progress' | 'blocked' | 'done';
export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface Project {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: ProjectStatus;
  color: string;
  createdAt: string;
  updatedAt: string;
  teamCount?: number;
  moduleCount?: number;
  dependencyCount?: number;
  /** Earliest module start / latest module end, which may exceed the planned window. */
  actualStart?: string | null;
  actualEnd?: string | null;
}

/**
 * An organisation-wide team, and one row of every project's chart.
 *
 * Teams are not owned by a project: the same team appears on every board, with
 * whatever modules it has there. A row with no modules in the project you are
 * looking at still shows, as somewhere to plan work for that team.
 *
 * Collapsed state is deliberately not here — it is a per-project view
 * preference held on the client, since a global flag would collapse the row on
 * every other project's chart too.
 */
export interface Team {
  id: string;
  name: string;
  /** `external` marks the cross-cutting rows: finance, procurement, vendors. */
  kind: TeamKind;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  /** Reach across the whole workspace; present on the roster endpoint. */
  moduleCount?: number;
  projectCount?: number;
  memberCount?: number;
}

/**
 * A person in the directory. Users are global — the same person appears across
 * projects — and `teamId` is their home team, a row that lives in one project.
 */
export interface User {
  id: string;
  name: string;
  email: string | null;
  /** Job title, e.g. "Backend Engineer". */
  title: string;
  teamId: string | null;
  /** Optional picture; when absent the UI draws initials on `avatarColor`. */
  avatarUrl: string | null;
  avatarColor: string;
  createdAt: string;
  updatedAt: string;
  /** Joined in by the API for display. */
  teamName?: string | null;
  assignedModuleCount?: number;
}

/** One bar on the chart. Named `ProjectModule` because `Module` is taken by Angular. */
export interface ProjectModule {
  id: string;
  projectId: string;
  teamId: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  progress: number;
  kind: ModuleKind;
  status: ModuleStatus;
  /** The person doing the work; null when nobody is assigned yet. */
  assigneeId: string | null;
  color: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** An arrow: `fromModuleId` must be satisfied before `toModuleId` can proceed. */
export interface Dependency {
  id: string;
  projectId: string;
  fromModuleId: string;
  toModuleId: string;
  type: DependencyType;
  lagDays: number;
  createdAt: string;
}

/** A link whose current dates break its own constraint. */
export interface Violation {
  dependencyId: string;
  fromModuleId: string;
  toModuleId: string;
  type: DependencyType;
  earliestStart: string;
  actualStart: string;
  slipDays: number;
}

export interface Board {
  project: Project;
  teams: Team[];
  modules: ProjectModule[];
  dependencies: Dependency[];
  /** The whole directory — any user can be assigned to a module here. */
  users: User[];
  violations: Violation[];
}

/* -------------------------------------------------------------- reports -- */

/**
 * A module seen from outside any one project — the unit the people report
 * works in. Carries its project and team denormalised, since a report row
 * mixes work from several boards.
 */
export interface Assignment {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  projectColor: string;
  teamId: string;
  teamName: string;
  teamColor: string;
  teamKind: TeamKind;
  /** `null` for work nobody owns yet. */
  assigneeId: string | null;
  startDate: string;
  endDate: string;
  progress: number;
  kind: ModuleKind;
  status: ModuleStatus;
}

export interface WorkloadReport {
  /** Span of all scheduled work, for defaulting the report window. */
  bounds: { start: string | null; end: string | null };
  range: { from: string | null; to: string | null };
  assignments: Assignment[];
  users: User[];
  teams: Team[];
  projects: Project[];
}

/* ------------------------------------------------------------- payloads -- */

export interface ProjectInput {
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  status?: ProjectStatus;
  color?: string;
}

export interface TeamInput {
  name: string;
  kind?: TeamKind;
  color?: string;
  sortOrder?: number;
}

export interface ModuleInput {
  teamId: string;
  name: string;
  description?: string;
  startDate: string;
  endDate: string;
  progress?: number;
  kind?: ModuleKind;
  status?: ModuleStatus;
  /** `null` clears the assignment; omitting the field leaves it unchanged. */
  assigneeId?: string | null;
  color?: string | null;
  sortOrder?: number;
}

export interface UserInput {
  name: string;
  email?: string | null;
  title?: string;
  teamId?: string | null;
  avatarUrl?: string | null;
  avatarColor?: string;
}


export interface DependencyInput {
  fromModuleId: string;
  toModuleId: string;
  type?: DependencyType;
  lagDays?: number;
}

/* --------------------------------------------------------- display meta -- */

export const MODULE_STATUS_LABELS: Record<ModuleStatus, string> = {
  planned: 'برنامه‌ریزی‌شده',
  in_progress: 'در حال انجام',
  blocked: 'متوقف',
  done: 'انجام‌شده',
};

export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  planning: 'برنامه‌ریزی',
  active: 'فعال',
  on_hold: 'متوقف',
  done: 'انجام‌شده',
  archived: 'بایگانی',
};

export const DEPENDENCY_TYPE_LABELS: Record<DependencyType, string> = {
  FS: 'پایان ← شروع',
  SS: 'شروع ← شروع',
  FF: 'پایان ← پایان',
  SF: 'شروع ← پایان',
};

/** Row palette offered when creating a team. */
export const TEAM_COLORS = [
  '#93c5fd', '#86efac', '#f9a8d4', '#fde047', '#d8b4fe',
  '#fdba74', '#a5b4fc', '#5eead4', '#fca5a5', '#bef264',
];

/**
 * Avatar palette. Deeper than the row colours because initials are drawn in
 * white on top and need the contrast.
 */
export const USER_COLORS = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444',
  '#a855f7', '#ec4899', '#14b8a6', '#f97316', '#64748b',
];
