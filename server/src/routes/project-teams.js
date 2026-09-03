import { Router } from 'express';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { toTeamDto } from '../lib/serialize.js';
import { parse, parseId, reorderSchema, teamLinkSchema } from '../lib/validation.js';
import { assertProjectExists } from './projects.js';

/**
 * Mounted at /api/projects/:projectId/teams.
 *
 * These endpoints *connect* a project to teams that already exist in the
 * registry — they never create one. Creating a team is a workspace-level act
 * that belongs on /api/teams, so that planning a project cannot quietly mint
 * duplicate team records.
 */
export const projectTeamsRouter = Router({ mergeParams: true });

/** A project's rows: linked teams, in this project's own order. */
const LINKED_TEAMS = `
  SELECT t.*,
         pt.sort_order AS sort_order,
         (SELECT count(*) FROM modules m
           WHERE m.team_id = t.id AND m.project_id = pt.project_id) AS module_count,
         (SELECT count(*) FROM users u WHERE u.team_id = t.id)      AS member_count
  FROM project_teams pt
  JOIN teams t ON t.id = pt.team_id
  WHERE pt.project_id = $1
  ORDER BY pt.sort_order, t.created_at
`;

async function listLinked(projectId) {
  const { rows } = await query(LINKED_TEAMS, [projectId]);
  return rows.map(toTeamDto);
}

/** Modules of `teamId` inside `projectId` — what unlinking would destroy. */
async function moduleCountIn(client, projectId, teamId) {
  const { rows } = await client.query(
    'SELECT count(*)::int AS count FROM modules WHERE project_id = $1 AND team_id = $2',
    [projectId, teamId],
  );
  return rows[0].count;
}

// GET /api/projects/:projectId/teams
projectTeamsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    await assertProjectExists(projectId);
    res.json({ data: await listLinked(projectId) });
  }),
);

/**
 * PUT /api/projects/:projectId/teams
 * Body: { teamIds: [...] } — the complete set of teams this project involves.
 *
 * Teams already linked keep their position; new ones are appended. Dropping a
 * team that still holds modules is refused unless `?force=true`.
 */
projectTeamsRouter.put(
  '/',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    await assertProjectExists(projectId);

    const { teamIds } = parse(teamLinkSchema, req.body);
    const force = req.query.force === 'true' || req.query.force === '1';

    if (new Set(teamIds).size !== teamIds.length) {
      throw ApiError.badRequest('فهرست شناسه‌ها مقدار تکراری دارد.');
    }

    await withTransaction(async (client) => {
      const { rows: known } = await client.query(
        'SELECT id FROM teams WHERE id = ANY($1::uuid[])',
        [teamIds],
      );
      if (known.length !== teamIds.length) {
        throw ApiError.badRequest('برخی از تیم‌های انتخاب‌شده وجود ندارند.');
      }

      const { rows: current } = await client.query(
        'SELECT team_id, sort_order FROM project_teams WHERE project_id = $1 FOR UPDATE',
        [projectId],
      );
      const linked = new Set(current.map((r) => r.team_id));
      const wanted = new Set(teamIds);

      // Removals first, so the caller learns about blocking work before
      // anything has changed.
      const removing = [...linked].filter((id) => !wanted.has(id));
      const blocked = [];

      for (const teamId of removing) {
        const count = await moduleCountIn(client, projectId, teamId);
        if (count > 0) blocked.push({ teamId, moduleCount: count });
      }

      if (blocked.length && !force) {
        const total = blocked.reduce((sum, b) => sum + b.moduleCount, 0);
        throw ApiError.conflict(
          `حذف این تیم‌ها از پروژه ${total} ماژول را از بین می‌برد. برای ادامه درخواست را با ?force=true بفرستید.`,
          { blocked },
        );
      }

      if (removing.length) {
        // The composite FK is ON DELETE RESTRICT, so modules go first.
        await client.query(
          'DELETE FROM modules WHERE project_id = $1 AND team_id = ANY($2::uuid[])',
          [projectId, removing],
        );
        await client.query(
          'DELETE FROM project_teams WHERE project_id = $1 AND team_id = ANY($2::uuid[])',
          [projectId, removing],
        );
      }

      const adding = teamIds.filter((id) => !linked.has(id));
      if (adding.length) {
        const nextOrder = current.length
          ? Math.max(...current.map((r) => r.sort_order)) + 1
          : 0;

        await client.query(
          `INSERT INTO project_teams (project_id, team_id, sort_order)
           SELECT $1, id, $3 + (ordinality - 1)
           FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, ordinality)`,
          [projectId, adding, nextOrder],
        );
      }
    });

    res.json({ data: await listLinked(projectId) });
  }),
);

/**
 * POST /api/projects/:projectId/teams/reorder
 * Body: { ids: [...] } — row order for this project only.
 */
projectTeamsRouter.post(
  '/reorder',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    await assertProjectExists(projectId);

    const { ids } = parse(reorderSchema, req.body);

    if (new Set(ids).size !== ids.length) {
      throw ApiError.badRequest('فهرست شناسه‌ها مقدار تکراری دارد.');
    }

    await withTransaction(async (client) => {
      const { rows: current } = await client.query(
        'SELECT team_id FROM project_teams WHERE project_id = $1 FOR UPDATE',
        [projectId],
      );
      const linked = new Set(current.map((r) => r.team_id));

      const strays = ids.filter((id) => !linked.has(id));
      if (strays.length) {
        throw ApiError.badRequest('برخی از تیم‌ها به این پروژه متصل نیستند.', { ids: strays });
      }
      if (ids.length !== linked.size) {
        throw ApiError.badRequest(
          `باید هر ${linked.size} شناسهٔ تیم ارسال شود، اما ${ids.length} شناسه دریافت شد.`,
        );
      }

      await client.query(
        `UPDATE project_teams AS pt
         SET sort_order = ordered.position
         FROM (SELECT id, ordinality - 1 AS position
               FROM unnest($2::uuid[]) WITH ORDINALITY AS u(id, ordinality)) AS ordered
         WHERE pt.team_id = ordered.id AND pt.project_id = $1`,
        [projectId, ids],
      );
    });

    res.json({ data: await listLinked(projectId) });
  }),
);

/**
 * DELETE /api/projects/:projectId/teams/:teamId[?force=true]
 *
 * Removes the row from this project only. The team itself, and its work in
 * other projects, are untouched.
 */
projectTeamsRouter.delete(
  '/:teamId',
  asyncHandler(async (req, res) => {
    const projectId = parseId(req.params.projectId, 'project id');
    const teamId = parseId(req.params.teamId, 'team id');
    const force = req.query.force === 'true' || req.query.force === '1';

    await assertProjectExists(projectId);

    const link = await queryOne(
      'SELECT team_id FROM project_teams WHERE project_id = $1 AND team_id = $2',
      [projectId, teamId],
    );
    if (!link) throw ApiError.notFound('این تیم به این پروژه متصل نیست.');

    const removed = await withTransaction(async (client) => {
      const count = await moduleCountIn(client, projectId, teamId);

      if (count > 0 && !force) {
        throw ApiError.conflict(
          `این تیم در این پروژه ${count} ماژول دارد. برای حذف آن‌ها هم درخواست را با ?force=true بفرستید.`,
          { moduleCount: count },
        );
      }

      if (count > 0) {
        await client.query('DELETE FROM modules WHERE project_id = $1 AND team_id = $2', [
          projectId,
          teamId,
        ]);
      }

      await client.query(
        'DELETE FROM project_teams WHERE project_id = $1 AND team_id = $2',
        [projectId, teamId],
      );

      return count;
    });

    res.json({ data: { teamId, removedModules: removed } });
  }),
);
