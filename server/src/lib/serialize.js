/** Row (snake_case, DB shape) → DTO (camelCase, wire shape). */

export function toProjectDto(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.team_count !== undefined ? { teamCount: row.team_count } : {}),
    ...(row.module_count !== undefined ? { moduleCount: row.module_count } : {}),
    ...(row.dependency_count !== undefined ? { dependencyCount: row.dependency_count } : {}),
    ...(row.actual_start !== undefined ? { actualStart: row.actual_start } : {}),
    ...(row.actual_end !== undefined ? { actualEnd: row.actual_end } : {}),
  };
}

/**
 * Teams are global: they belong to the organisation, not to a project, and
 * every chart shows all of them.
 */
export function toTeamDto(row) {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Present on the roster endpoint, which reports reach across projects.
    ...(row.module_count !== undefined ? { moduleCount: row.module_count } : {}),
    ...(row.project_count !== undefined ? { projectCount: row.project_count } : {}),
    ...(row.member_count !== undefined ? { memberCount: row.member_count } : {}),
  };
}

export function toModuleDto(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    teamId: row.team_id,
    name: row.name,
    description: row.description,
    startDate: row.start_date,
    endDate: row.end_date,
    progress: row.progress,
    kind: row.kind,
    status: row.status,
    assigneeId: row.assignee_id ?? null,
    color: row.color,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toUserDto(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    title: row.title,
    teamId: row.team_id,
    avatarUrl: row.avatar_url,
    avatarColor: row.avatar_color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Joined in by the list/detail queries so the client need not resolve a
    // team that may belong to a different project.
    ...(row.team_name !== undefined ? { teamName: row.team_name } : {}),
    ...(row.assigned_module_count !== undefined
      ? { assignedModuleCount: row.assigned_module_count }
      : {}),
  };
}

export function toDependencyDto(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    fromModuleId: row.from_module_id,
    toModuleId: row.to_module_id,
    type: row.type,
    lagDays: row.lag_days,
    createdAt: row.created_at,
  };
}

/**
 * Turns a validated payload into `SET` fragments for a partial update.
 * Returns `null` when nothing maps, so callers can short-circuit.
 */
export function buildUpdate(payload, columnMap, startIndex = 1) {
  const assignments = [];
  const values = [];
  let index = startIndex;

  for (const [key, column] of Object.entries(columnMap)) {
    if (!(key in payload)) continue;
    assignments.push(`${column} = $${index++}`);
    values.push(payload[key]);
  }

  return assignments.length ? { assignments, values, nextIndex: index } : null;
}
