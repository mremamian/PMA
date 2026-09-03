import { Router } from 'express';
import { query } from '../db/pool.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { isIsoDate } from '../lib/dates.js';
import { toProjectDto, toTeamDto, toUserDto } from '../lib/serialize.js';

export const reportsRouter = Router();

/**
 * Every assignment in the workspace, flattened across projects.
 *
 * Reporting is inherently cross-project — "is Maryam free in Mehr?" cannot be
 * answered from one board — so this is the one place that reads modules
 * without a project scope. Unassigned modules come back too: a gap in
 * ownership is exactly the kind of thing the report exists to surface.
 */
const ASSIGNMENTS = `
  SELECT m.id,
         m.project_id,
         m.team_id,
         m.assignee_id,
         m.name,
         m.start_date,
         m.end_date,
         m.progress,
         m.kind,
         m.status,
         p.name  AS project_name,
         p.color AS project_color,
         t.name  AS team_name,
         t.color AS team_color,
         t.kind  AS team_kind
  FROM modules m
  JOIN projects p ON p.id = m.project_id
  JOIN teams t    ON t.id = m.team_id
`;

function toAssignmentDto(row) {
  return {
    id: row.id,
    name: row.name,
    projectId: row.project_id,
    projectName: row.project_name,
    projectColor: row.project_color,
    teamId: row.team_id,
    teamName: row.team_name,
    teamColor: row.team_color,
    teamKind: row.team_kind,
    assigneeId: row.assignee_id,
    startDate: row.start_date,
    endDate: row.end_date,
    progress: row.progress,
    kind: row.kind,
    status: row.status,
  };
}

/** Optional `from`/`to` bound the payload; anything overlapping is included. */
function parseRange(req) {
  const { from, to } = req.query;

  for (const [label, value] of [['from', from], ['to', to]]) {
    if (value !== undefined && !isIsoDate(String(value))) {
      throw ApiError.badRequest(`پارامتر ${label} باید تاریخ میلادی معتبر به شکل YYYY-MM-DD باشد.`);
    }
  }

  if (from && to && String(to) < String(from)) {
    throw ApiError.badRequest('پارامتر to نباید پیش از from باشد.');
  }

  return { from: from ? String(from) : null, to: to ? String(to) : null };
}

/**
 * GET /api/reports/workload[?from=&to=]
 *
 * Returns the raw material for the people report: every person, team and
 * project, plus every assignment. The timeline maths — gaps, overlaps,
 * utilisation — is done in the browser so filtering stays instant, and so the
 * same numbers drive both the chart and the summary without a round trip.
 */
reportsRouter.get(
  '/workload',
  asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req);

    // An assignment counts when it overlaps the window at all, not only when
    // it sits entirely inside it — work spanning the boundary still occupies
    // the person during it.
    const conditions = [];
    const values = [];

    if (from) {
      values.push(from);
      conditions.push(`m.end_date >= $${values.length}`);
    }
    if (to) {
      values.push(to);
      conditions.push(`m.start_date <= $${values.length}`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [assignments, users, teams, projects, bounds] = await Promise.all([
      query(`${ASSIGNMENTS} ${where} ORDER BY m.start_date, m.end_date`, values),
      query(
        `SELECT u.*, t.name AS team_name
         FROM users u
         LEFT JOIN teams t ON t.id = u.team_id
         ORDER BY u.name`,
      ),
      query('SELECT * FROM teams ORDER BY sort_order, created_at'),
      query('SELECT * FROM projects ORDER BY created_at DESC'),
      query('SELECT min(start_date) AS min_start, max(end_date) AS max_end FROM modules'),
    ]);

    res.json({
      data: {
        // The span of all work, so the client can default its window to
        // something that actually contains something.
        bounds: {
          start: bounds.rows[0].min_start,
          end: bounds.rows[0].max_end,
        },
        range: { from, to },
        assignments: assignments.rows.map(toAssignmentDto),
        users: users.rows.map(toUserDto),
        teams: teams.rows.map(toTeamDto),
        projects: projects.rows.map(toProjectDto),
      },
    });
  }),
);
