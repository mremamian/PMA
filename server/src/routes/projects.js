import { Router } from 'express';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import {
  toProjectDto,
  toTeamDto,
  toModuleDto,
  toDependencyDto,
  toUserDto,
  buildUpdate,
} from '../lib/serialize.js';
import { findViolations } from '../lib/scheduling.js';
import { parse, parseId, projectCreateSchema, projectUpdateSchema } from '../lib/validation.js';

export const projectsRouter = Router();

/** Shared by list and detail so both expose the same roll-up numbers. */
const PROJECT_WITH_STATS = `
  SELECT p.*,
         -- Rows this project involves, i.e. teams connected to it.
         (SELECT count(*) FROM project_teams pt WHERE pt.project_id = p.id)    AS team_count,
         (SELECT count(*) FROM modules m WHERE m.project_id = p.id)            AS module_count,
         (SELECT count(*) FROM dependencies d WHERE d.project_id = p.id)       AS dependency_count,
         (SELECT min(m.start_date) FROM modules m WHERE m.project_id = p.id)   AS actual_start,
         (SELECT max(m.end_date) FROM modules m WHERE m.project_id = p.id)     AS actual_end
  FROM projects p
`;

/** Throws 404 unless the project exists. Returns its id. */
export async function assertProjectExists(projectId) {
  const row = await queryOne('SELECT id FROM projects WHERE id = $1', [projectId]);
  if (!row) throw ApiError.notFound('پروژه پیدا نشد.');
  return row.id;
}

// GET /api/projects
projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, q } = req.query;

    const conditions = [];
    const values = [];

    if (status) {
      values.push(status);
      conditions.push(`p.status = $${values.length}`);
    }
    if (q) {
      values.push(`%${q}%`);
      conditions.push(`(p.name ILIKE $${values.length} OR p.description ILIKE $${values.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(
      `${PROJECT_WITH_STATS} ${where} ORDER BY p.created_at DESC`,
      values,
    );

    res.json({ data: rows.map(toProjectDto) });
  }),
);

// POST /api/projects
projectsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = parse(projectCreateSchema, req.body);

    const created = await withTransaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO projects (name, description, start_date, end_date, status, color)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
        [
          payload.name,
          payload.description,
          payload.startDate,
          payload.endDate,
          payload.status,
          payload.color,
        ],
      );
      const project = rows[0];

      // A new project starts connected to every team in the registry, in the
      // registry's order. Starting empty would mean a blank chart and a
      // mandatory setup step; removing the rows you don't need is easier than
      // remembering to add the ones you do.
      await client.query(
        `INSERT INTO project_teams (project_id, team_id, sort_order)
         SELECT $1, id, sort_order FROM teams`,
        [project.id],
      );

      return project;
    });

    const row = await queryOne(`${PROJECT_WITH_STATS} WHERE p.id = $1`, [created.id]);
    res.status(201).json({ data: toProjectDto(row) });
  }),
);

// GET /api/projects/:projectId
projectsRouter.get(
  '/:projectId',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    const row = await queryOne(`${PROJECT_WITH_STATS} WHERE p.id = $1`, [projectId]);
    if (!row) throw ApiError.notFound('پروژه پیدا نشد.');
    res.json({ data: toProjectDto(row) });
  }),
);

/**
 * GET /api/projects/:projectId/board
 *
 * Everything the Gantt view needs in one round trip: the project, its rows
 * (teams), every bar (module) and every arrow (dependency).
 */
projectsRouter.get(
  '/:projectId/board',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');

    const project = await queryOne(`${PROJECT_WITH_STATS} WHERE p.id = $1`, [projectId]);
    if (!project) throw ApiError.notFound('پروژه پیدا نشد.');

    const [teams, modules, dependencies, users] = await Promise.all([
      // The project's rows: teams connected to it through project_teams, in
      // this project's own order. Teams themselves live in the shared
      // registry; a project picks from it rather than owning any.
      //
      // `module_count` is scoped to this project (what unlinking would
      // destroy); `project_count` spans the workspace (what deleting the team
      // itself would).
      query(
        `SELECT t.*,
                pt.sort_order AS sort_order,
                (SELECT count(*) FROM modules m
                  WHERE m.team_id = t.id AND m.project_id = pt.project_id)                  AS module_count,
                (SELECT count(DISTINCT m.project_id) FROM modules m WHERE m.team_id = t.id) AS project_count,
                (SELECT count(*) FROM users u WHERE u.team_id = t.id)                       AS member_count
         FROM project_teams pt
         JOIN teams t ON t.id = pt.team_id
         WHERE pt.project_id = $1
         ORDER BY pt.sort_order, t.created_at`,
        [projectId],
      ),
      query(
        `SELECT * FROM modules WHERE project_id = $1 ORDER BY sort_order, start_date, created_at`,
        [projectId],
      ),
      query(`SELECT * FROM dependencies WHERE project_id = $1 ORDER BY created_at`, [projectId]),
      // The whole directory: users are global, and any of them can be assigned
      // to a module here. It is a short list, and shipping it with the board
      // keeps the assignee picker instant.
      query(
        `SELECT u.*, t.name AS team_name
         FROM users u
         LEFT JOIN teams t ON t.id = u.team_id
         ORDER BY u.name`,
      ),
    ]);

    const moduleDtos = modules.rows.map(toModuleDto);
    const dependencyDtos = dependencies.rows.map(toDependencyDto);

    res.json({
      data: {
        project: toProjectDto(project),
        teams: teams.rows.map(toTeamDto),
        modules: moduleDtos,
        dependencies: dependencyDtos,
        users: users.rows.map(toUserDto),
        // Links whose dates no longer line up — drawn in red on the chart.
        violations: findViolations(moduleDtos, dependencyDtos),
      },
    });
  }),
);

// PATCH /api/projects/:projectId
projectsRouter.patch(
  '/:projectId',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    const payload = parse(projectUpdateSchema, req.body);

    const update = buildUpdate(payload, {
      name: 'name',
      description: 'description',
      startDate: 'start_date',
      endDate: 'end_date',
      status: 'status',
      color: 'color',
    });

    if (!update) throw ApiError.badRequest('هیچ فیلدی برای به‌روزرسانی داده نشده.');

    const row = await queryOne(
      `UPDATE projects SET ${update.assignments.join(', ')}
       WHERE id = $${update.nextIndex}
       RETURNING *`,
      [...update.values, projectId],
    );

    if (!row) throw ApiError.notFound('پروژه پیدا نشد.');
    res.json({ data: toProjectDto(row) });
  }),
);

// DELETE /api/projects/:projectId — cascades to teams, modules and dependencies.
projectsRouter.delete(
  '/:projectId',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    const row = await queryOne('DELETE FROM projects WHERE id = $1 RETURNING id', [projectId]);
    if (!row) throw ApiError.notFound('پروژه پیدا نشد.');
    res.status(204).end();
  }),
);
