import { Router } from 'express';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { toModuleDto } from '../lib/serialize.js';
import { cascadeSchedule } from '../lib/scheduling.js';
import {
  parse,
  parseId,
  moduleCreateSchema,
  moduleShiftSchema,
  moduleUpdateSchema,
} from '../lib/validation.js';
import { assertProjectExists } from './projects.js';

/** Mounted at /api/projects/:projectId/modules */
export const projectModulesRouter = Router({ mergeParams: true });

/** Mounted at /api/modules */
export const modulesRouter = Router();

const wantsCascade = (req) => req.query.cascade === 'true' || req.query.cascade === '1';

// GET /api/projects/:projectId/modules[?teamId=...]
projectModulesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    await assertProjectExists(projectId);

    const values = [projectId];
    let where = 'project_id = $1';

    if (req.query.teamId) {
      values.push(parseId(req.query.teamId, 'team id'));
      where += ` AND team_id = $${values.length}`;
    }

    const { rows } = await query(
      `SELECT * FROM modules WHERE ${where} ORDER BY sort_order, start_date, created_at`,
      values,
    );

    res.json({ data: rows.map(toModuleDto) });
  }),
);

// POST /api/projects/:projectId/modules
projectModulesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    await assertProjectExists(projectId);

    const payload = parse(moduleCreateSchema, req.body);

    // The team must be one this project is connected to. The composite FK on
    // (project_id, team_id) enforces it too, but a named error is far more
    // useful than a constraint violation.
    const team = await queryOne(
      `SELECT t.id FROM project_teams pt
       JOIN teams t ON t.id = pt.team_id
       WHERE pt.project_id = $1 AND pt.team_id = $2`,
      [projectId, payload.teamId],
    );
    if (!team) throw ApiError.badRequest('این تیم به این پروژه متصل نیست.');

    const sortOrder =
      payload.sortOrder ??
      (
        await queryOne(
          'SELECT COALESCE(max(sort_order) + 1, 0) AS next FROM modules WHERE team_id = $1',
          [payload.teamId],
        )
      ).next;

    const row = await queryOne(
      `INSERT INTO modules
         (project_id, team_id, name, description, start_date, end_date,
          progress, kind, status, assignee_id, color, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING *`,
      [
        projectId,
        payload.teamId,
        payload.name,
        payload.description,
        payload.startDate,
        payload.endDate,
        payload.progress,
        payload.kind,
        payload.status,
        payload.assigneeId ?? null,
        payload.color ?? null,
        sortOrder,
      ],
    );

    res.status(201).json({ data: toModuleDto(row) });
  }),
);

/**
 * POST /api/projects/:projectId/modules/shift[?cascade=true]
 * Body: { moduleIds: [...], deltaDays: number }
 *
 * Moves several modules by the same number of calendar days — what dragging a
 * multi-selection on the chart commits. One transaction rather than N separate
 * PATCHes, so a partial failure cannot leave half a selection moved.
 *
 * The shift is in calendar days, matching what the pointer did: the bars land
 * exactly where they were dropped. Durations are still counted in working
 * days, so a bar pushed across a Thursday simply reads as fewer of them.
 */
projectModulesRouter.post(
  '/shift',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    await assertProjectExists(projectId);

    const { moduleIds, deltaDays } = parse(moduleShiftSchema, req.body);
    const cascade = wantsCascade(req);

    const unique = [...new Set(moduleIds)];

    const result = await withTransaction(async (client) => {
      const { rows: targets } = await client.query(
        `SELECT * FROM modules
         WHERE id = ANY($1::uuid[]) AND project_id = $2
         FOR UPDATE`,
        [unique, projectId],
      );

      if (targets.length !== unique.length) {
        throw ApiError.badRequest('برخی از ماژول‌ها در این پروژه پیدا نشدند.');
      }

      const { rows: shifted } = await client.query(
        `UPDATE modules
         SET start_date = start_date + $2::int, end_date = end_date + $2::int
         WHERE id = ANY($1::uuid[])
         RETURNING *`,
        [unique, deltaDays],
      );

      if (!cascade) return { modules: shifted, moved: [] };

      const [{ rows: allModules }, { rows: allDeps }] = await Promise.all([
        client.query('SELECT * FROM modules WHERE project_id = $1 FOR UPDATE', [projectId]),
        client.query('SELECT * FROM dependencies WHERE project_id = $1', [projectId]),
      ]);

      // Every shifted module anchors the cascade, so dependents settle behind
      // the whole selection rather than behind one arbitrary member.
      const pushed = cascadeSchedule(
        allModules.map((m) => ({ id: m.id, startDate: m.start_date, endDate: m.end_date })),
        allDeps.map((d) => ({
          id: d.id,
          fromModuleId: d.from_module_id,
          toModuleId: d.to_module_id,
          type: d.type,
          lagDays: d.lag_days,
        })),
        unique,
      );

      if (pushed.size === 0) return { modules: shifted, moved: [] };

      const ids = [...pushed.keys()];
      const { rows: movedRows } = await client.query(
        `UPDATE modules AS m
         SET start_date = v.start_date, end_date = v.end_date
         FROM (SELECT * FROM unnest($1::uuid[], $2::date[], $3::date[])
               AS t(id, start_date, end_date)) AS v
         WHERE m.id = v.id
         RETURNING m.*`,
        [
          ids,
          ids.map((id) => pushed.get(id).startDate),
          ids.map((id) => pushed.get(id).endDate),
        ],
      );

      return { modules: shifted, moved: movedRows };
    });

    res.json({
      data: {
        modules: result.modules.map(toModuleDto),
        moved: result.moved.map(toModuleDto),
      },
    });
  }),
);

// GET /api/modules/:moduleId
modulesRouter.get(
  '/:moduleId',
  asyncHandler(async (req, res) => {
    const moduleId = parseId(req.params.moduleId, 'module id');
    const row = await queryOne('SELECT * FROM modules WHERE id = $1', [moduleId]);
    if (!row) throw ApiError.notFound('ماژول پیدا نشد.');
    res.json({ data: toModuleDto(row) });
  }),
);

/**
 * PATCH /api/modules/:moduleId[?cascade=true]
 *
 * The endpoint the Gantt calls on every drag and resize. With `cascade=true`
 * dependent modules are pushed forward so the plan stays consistent; the
 * response lists whatever else moved so the client can repaint those bars.
 */
modulesRouter.patch(
  '/:moduleId',
  asyncHandler(async (req, res) => {
    const moduleId = parseId(req.params.moduleId, 'module id');
    const payload = parse(moduleUpdateSchema, req.body);
    const cascade = wantsCascade(req);

    const result = await withTransaction(async (client) => {
      const { rows: existingRows } = await client.query(
        'SELECT * FROM modules WHERE id = $1 FOR UPDATE',
        [moduleId],
      );
      const existing = existingRows[0];
      if (!existing) throw ApiError.notFound('ماژول پیدا نشد.');

      if (payload.teamId) {
        const { rows: teamRows } = await client.query(
          'SELECT team_id FROM project_teams WHERE project_id = $1 AND team_id = $2',
          [existing.project_id, payload.teamId],
        );
        if (!teamRows[0]) {
          throw ApiError.badRequest('این تیم به این پروژه متصل نیست.');
        }
      }

      const next = {
        teamId: payload.teamId ?? existing.team_id,
        name: payload.name ?? existing.name,
        description: payload.description ?? existing.description,
        startDate: payload.startDate ?? existing.start_date,
        endDate: payload.endDate ?? existing.end_date,
        progress: payload.progress ?? existing.progress,
        kind: payload.kind ?? existing.kind,
        status: payload.status ?? existing.status,
        // `?? existing` would be wrong here: an explicit null means "unassign",
        // and must be distinguished from the field being absent.
        assigneeId:
          payload.assigneeId === undefined ? existing.assignee_id : payload.assigneeId,
        color: payload.color === undefined ? existing.color : payload.color,
        sortOrder: payload.sortOrder ?? existing.sort_order,
      };

      // Dragging a milestone only sends one date; collapse the other onto it so
      // the single-day constraint is never violated by a partial update.
      if (next.kind === 'milestone') {
        if (payload.startDate && !payload.endDate) next.endDate = next.startDate;
        else if (payload.endDate && !payload.startDate) next.startDate = next.endDate;
      }

      if (next.endDate < next.startDate) {
        throw ApiError.badRequest('تاریخ پایان نباید پیش از تاریخ شروع باشد.');
      }

      const { rows: updatedRows } = await client.query(
        `UPDATE modules SET
           team_id = $1, name = $2, description = $3, start_date = $4, end_date = $5,
           progress = $6, kind = $7, status = $8, assignee_id = $9, color = $10, sort_order = $11
         WHERE id = $12
         RETURNING *`,
        [
          next.teamId,
          next.name,
          next.description,
          next.startDate,
          next.endDate,
          next.progress,
          next.kind,
          next.status,
          next.assigneeId,
          next.color,
          next.sortOrder,
          moduleId,
        ],
      );

      const updated = updatedRows[0];
      const datesChanged =
        updated.start_date !== existing.start_date || updated.end_date !== existing.end_date;

      if (!cascade || !datesChanged) {
        return { module: updated, moved: [] };
      }

      const [{ rows: allModules }, { rows: allDeps }] = await Promise.all([
        client.query('SELECT * FROM modules WHERE project_id = $1 FOR UPDATE', [
          existing.project_id,
        ]),
        client.query('SELECT * FROM dependencies WHERE project_id = $1', [existing.project_id]),
      ]);

      const shifted = cascadeSchedule(
        allModules.map((m) => ({ id: m.id, startDate: m.start_date, endDate: m.end_date })),
        allDeps.map((d) => ({
          id: d.id,
          fromModuleId: d.from_module_id,
          toModuleId: d.to_module_id,
          type: d.type,
          lagDays: d.lag_days,
        })),
        [moduleId],
      );

      if (shifted.size === 0) return { module: updated, moved: [] };

      // One statement for the whole cascade rather than a write per module.
      const ids = [...shifted.keys()];
      const { rows: movedRows } = await client.query(
        `UPDATE modules AS m
         SET start_date = v.start_date, end_date = v.end_date
         FROM (SELECT * FROM unnest($1::uuid[], $2::date[], $3::date[])
                 AS t(id, start_date, end_date)) AS v
         WHERE m.id = v.id
         RETURNING m.*`,
        [
          ids,
          ids.map((id) => shifted.get(id).startDate),
          ids.map((id) => shifted.get(id).endDate),
        ],
      );

      return { module: updated, moved: movedRows };
    });

    res.json({
      data: toModuleDto(result.module),
      moved: result.moved.map(toModuleDto),
    });
  }),
);

// DELETE /api/modules/:moduleId — its dependency arrows go with it.
modulesRouter.delete(
  '/:moduleId',
  asyncHandler(async (req, res) => {
    const moduleId = parseId(req.params.moduleId, 'module id');
    const row = await queryOne('DELETE FROM modules WHERE id = $1 RETURNING id', [moduleId]);
    if (!row) throw ApiError.notFound('ماژول پیدا نشد.');
    res.status(204).end();
  }),
);
