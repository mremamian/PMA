import { Router } from 'express';
import { query, queryOne, withTransaction } from '../db/pool.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { toTeamDto, buildUpdate } from '../lib/serialize.js';
import { parse, parseId, reorderSchema, teamCreateSchema, teamUpdateSchema } from '../lib/validation.js';

/**
 * Mounted at /api/teams.
 *
 * Teams are organisation-wide, not per-project: "Squad A" is the same team
 * whichever chart you are looking at, and every project's board shows all of
 * them. That is why there is no project-scoped teams router any more.
 */
export const teamsRouter = Router();

/** Reach of each team, for the roster page. */
const TEAM_WITH_STATS = `
  SELECT t.*,
         (SELECT count(*) FROM modules m WHERE m.team_id = t.id)                    AS module_count,
         (SELECT count(DISTINCT m.project_id) FROM modules m WHERE m.team_id = t.id) AS project_count,
         (SELECT count(*) FROM users u WHERE u.team_id = t.id)                      AS member_count
  FROM teams t
`;

// GET /api/teams
teamsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const values = [];
    let where = '';

    if (req.query.q) {
      values.push(`%${req.query.q}%`);
      where = `WHERE t.name ILIKE $${values.length}`;
    }

    const { rows } = await query(
      `${TEAM_WITH_STATS} ${where} ORDER BY t.sort_order, t.created_at`,
      values,
    );

    res.json({ data: rows.map(toTeamDto) });
  }),
);

// GET /api/teams/:teamId
teamsRouter.get(
  '/:teamId',
  asyncHandler(async (req, res) => {
    const teamId = parseId(req.params.teamId, 'team id');
    const row = await queryOne(`${TEAM_WITH_STATS} WHERE t.id = $1`, [teamId]);
    if (!row) throw ApiError.notFound('ردیف پیدا نشد.');
    res.json({ data: toTeamDto(row) });
  }),
);

// POST /api/teams
teamsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = parse(teamCreateSchema, req.body);

    // New teams land at the bottom of the shared ordering.
    const sortOrder =
      payload.sortOrder ??
      (await queryOne('SELECT COALESCE(max(sort_order) + 1, 0) AS next FROM teams')).next;

    const inserted = await queryOne(
      `INSERT INTO teams (name, kind, color, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [payload.name, payload.kind, payload.color, sortOrder],
    );

    const row = await queryOne(`${TEAM_WITH_STATS} WHERE t.id = $1`, [inserted.id]);
    res.status(201).json({ data: toTeamDto(row) });
  }),
);

/**
 * POST /api/teams/reorder
 * Body: { ids: [...] } — the full ordered list, top to bottom. The order is
 * shared, so it changes the row order on every project's chart.
 */
teamsRouter.post(
  '/reorder',
  asyncHandler(async (req, res) => {
    const { ids } = parse(reorderSchema, req.body);

    if (new Set(ids).size !== ids.length) {
      throw ApiError.badRequest('فهرست شناسه‌ها مقدار تکراری دارد.');
    }

    const rows = await withTransaction(async (client) => {
      const { rows: existing } = await client.query('SELECT id FROM teams FOR UPDATE');
      const known = new Set(existing.map((r) => r.id));

      const strays = ids.filter((id) => !known.has(id));
      if (strays.length) {
        throw ApiError.badRequest('برخی از شناسه‌ها به هیچ ردیفی تعلق ندارند.', { ids: strays });
      }
      if (ids.length !== known.size) {
        throw ApiError.badRequest(
          `باید هر ${known.size} شناسهٔ ردیف ارسال شود، اما ${ids.length} شناسه دریافت شد.`,
        );
      }

      // One statement instead of N round trips: unnest the ordered array and
      // join it back onto the table by position.
      await client.query(
        `UPDATE teams AS t
         SET sort_order = ordered.position
         FROM (SELECT id, ordinality - 1 AS position
               FROM unnest($1::uuid[]) WITH ORDINALITY AS u(id, ordinality)) AS ordered
         WHERE t.id = ordered.id`,
        [ids],
      );

      const { rows: updated } = await client.query(
        `${TEAM_WITH_STATS} ORDER BY t.sort_order, t.created_at`,
      );
      return updated;
    });

    res.json({ data: rows.map(toTeamDto) });
  }),
);

// PATCH /api/teams/:teamId
teamsRouter.patch(
  '/:teamId',
  asyncHandler(async (req, res) => {
    const teamId = parseId(req.params.teamId, 'team id');
    const payload = parse(teamUpdateSchema, req.body);

    const update = buildUpdate(payload, {
      name: 'name',
      kind: 'kind',
      color: 'color',
      sortOrder: 'sort_order',
    });

    if (!update) throw ApiError.badRequest('هیچ فیلدی برای به‌روزرسانی داده نشده.');

    const updated = await queryOne(
      `UPDATE teams SET ${update.assignments.join(', ')}
       WHERE id = $${update.nextIndex}
       RETURNING id`,
      [...update.values, teamId],
    );

    if (!updated) throw ApiError.notFound('ردیف پیدا نشد.');

    const row = await queryOne(`${TEAM_WITH_STATS} WHERE t.id = $1`, [teamId]);
    res.json({ data: toTeamDto(row) });
  }),
);

/**
 * DELETE /api/teams/:teamId
 *
 * A team is shared, so deleting it removes its modules from *every* project,
 * not just the one the caller happens to be looking at. The call refuses
 * unless the team is empty; pass `?force=true` once that has been confirmed.
 * Members are not deleted — their team is set to null.
 */
teamsRouter.delete(
  '/:teamId',
  asyncHandler(async (req, res) => {
    const teamId = parseId(req.params.teamId, 'team id');
    const force = req.query.force === 'true' || req.query.force === '1';

    const team = await queryOne(`${TEAM_WITH_STATS} WHERE t.id = $1`, [teamId]);
    if (!team) throw ApiError.notFound('ردیف پیدا نشد.');

    if (team.module_count > 0 && !force) {
      throw ApiError.conflict(
        `این ردیف ${team.module_count} ماژول در ${team.project_count} پروژه دارد. برای حذف آن‌ها هم درخواست را با ?force=true بفرستید.`,
        { moduleCount: team.module_count, projectCount: team.project_count },
      );
    }

    await query('DELETE FROM teams WHERE id = $1', [teamId]);

    res.json({
      data: {
        id: teamId,
        deletedModules: team.module_count,
        unassignedMembers: team.member_count,
      },
    });
  }),
);
