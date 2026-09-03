import { Router } from 'express';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { toDependencyDto, buildUpdate } from '../lib/serialize.js';
import {
  parse,
  parseId,
  dependencyCreateSchema,
  dependencyUpdateSchema,
} from '../lib/validation.js';
import { assertProjectExists } from './projects.js';

/** Mounted at /api/projects/:projectId/dependencies */
export const projectDependenciesRouter = Router({ mergeParams: true });

/** Mounted at /api/dependencies */
export const dependenciesRouter = Router();

/**
 * Would adding `from -> to` close a loop? It would exactly when `to` can
 * already reach `from` by following existing edges. Postgres walks the graph
 * for us; `UNION` (not `UNION ALL`) also stops the recursion terminating on
 * any pre-existing cycle.
 */
async function wouldCreateCycle(client, fromModuleId, toModuleId) {
  const { rows } = await client.query(
    `WITH RECURSIVE reachable(node) AS (
       SELECT to_module_id FROM dependencies WHERE from_module_id = $1
       UNION
       SELECT d.to_module_id FROM dependencies d
       JOIN reachable r ON d.from_module_id = r.node
     )
     SELECT 1 FROM reachable WHERE node = $2 LIMIT 1`,
    [toModuleId, fromModuleId],
  );
  return rows.length > 0;
}

// GET /api/projects/:projectId/dependencies
projectDependenciesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    await assertProjectExists(projectId);

    const { rows } = await query(
      'SELECT * FROM dependencies WHERE project_id = $1 ORDER BY created_at',
      [projectId],
    );

    res.json({ data: rows.map(toDependencyDto) });
  }),
);

// POST /api/projects/:projectId/dependencies
projectDependenciesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    await assertProjectExists(projectId);

    const payload = parse(dependencyCreateSchema, req.body);

    const row = await withTransaction(async (client) => {
      const { rows: endpoints } = await client.query(
        'SELECT id, name FROM modules WHERE project_id = $1 AND id = ANY($2::uuid[])',
        [projectId, [payload.fromModuleId, payload.toModuleId]],
      );

      if (endpoints.length !== 2) {
        throw ApiError.badRequest('هر دو ماژول باید وجود داشته و متعلق به این پروژه باشند.');
      }

      if (await wouldCreateCycle(client, payload.fromModuleId, payload.toModuleId)) {
        throw ApiError.conflict(
          'این پیوند یک وابستگی حلقوی می‌سازد.',
          { fromModuleId: payload.fromModuleId, toModuleId: payload.toModuleId },
        );
      }

      const { rows } = await client.query(
        `INSERT INTO dependencies (project_id, from_module_id, to_module_id, type, lag_days)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [projectId, payload.fromModuleId, payload.toModuleId, payload.type, payload.lagDays],
      );

      return rows[0];
    });

    res.status(201).json({ data: toDependencyDto(row) });
  }),
);

// PATCH /api/dependencies/:dependencyId — change the link type or its lag.
dependenciesRouter.patch(
  '/:dependencyId',
  asyncHandler(async (req, res) => {
    const dependencyId = parseId(req.params.dependencyId, 'dependency id');
    const payload = parse(dependencyUpdateSchema, req.body);

    const update = buildUpdate(payload, { type: 'type', lagDays: 'lag_days' });
    if (!update) throw ApiError.badRequest('هیچ فیلدی برای به‌روزرسانی داده نشده.');

    const row = await queryOne(
      `UPDATE dependencies SET ${update.assignments.join(', ')}
       WHERE id = $${update.nextIndex}
       RETURNING *`,
      [...update.values, dependencyId],
    );

    if (!row) throw ApiError.notFound('وابستگی پیدا نشد.');
    res.json({ data: toDependencyDto(row) });
  }),
);

// DELETE /api/dependencies/:dependencyId
dependenciesRouter.delete(
  '/:dependencyId',
  asyncHandler(async (req, res) => {
    const dependencyId = parseId(req.params.dependencyId, 'dependency id');
    const row = await queryOne('DELETE FROM dependencies WHERE id = $1 RETURNING id', [
      dependencyId,
    ]);
    if (!row) throw ApiError.notFound('وابستگی پیدا نشد.');
    res.status(204).end();
  }),
);
