import { Router } from 'express';
import { query, queryOne } from '../db/pool.js';
import { ApiError, asyncHandler } from '../lib/http.js';
import { toUserDto, buildUpdate } from '../lib/serialize.js';
import { parse, parseId, userCreateSchema, userUpdateSchema } from '../lib/validation.js';

export const usersRouter = Router();

/**
 * A user's team lives in some project, so both names are joined in for
 * display. `assigned_module_count` tells the UI how much work would be
 * unassigned if this person were deleted.
 */
const USER_WITH_CONTEXT = `
  SELECT u.*,
         t.name AS team_name,
         (SELECT count(*) FROM modules m WHERE m.assignee_id = u.id) AS assigned_module_count
  FROM users u
  LEFT JOIN teams t ON t.id = u.team_id
`;

// GET /api/users[?q=&teamId=&unassigned=true]
usersRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const conditions = [];
    const values = [];

    if (req.query.q) {
      values.push(`%${req.query.q}%`);
      conditions.push(
        `(u.name ILIKE $${values.length} OR u.title ILIKE $${values.length} OR u.email ILIKE $${values.length})`,
      );
    }

    if (req.query.teamId) {
      values.push(parseId(req.query.teamId, 'team id'));
      conditions.push(`u.team_id = $${values.length}`);
    }

    if (req.query.unassigned === 'true') {
      conditions.push('u.team_id IS NULL');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await query(`${USER_WITH_CONTEXT} ${where} ORDER BY u.name`, values);

    res.json({ data: rows.map(toUserDto) });
  }),
);

// GET /api/users/:userId
usersRouter.get(
  '/:userId',
  asyncHandler(async (req, res) => {
    const userId = parseId(req.params.userId, 'user id');
    const row = await queryOne(`${USER_WITH_CONTEXT} WHERE u.id = $1`, [userId]);
    if (!row) throw ApiError.notFound('کاربر پیدا نشد.');
    res.json({ data: toUserDto(row) });
  }),
);

// POST /api/users
usersRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const payload = parse(userCreateSchema, req.body);

    if (payload.teamId) await assertTeamExists(payload.teamId);

    const inserted = await queryOne(
      `INSERT INTO users (name, email, title, team_id, avatar_url, avatar_color)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        payload.name,
        payload.email ?? null,
        payload.title,
        payload.teamId ?? null,
        payload.avatarUrl ?? null,
        payload.avatarColor,
      ],
    );

    const row = await queryOne(`${USER_WITH_CONTEXT} WHERE u.id = $1`, [inserted.id]);
    res.status(201).json({ data: toUserDto(row) });
  }),
);

// PATCH /api/users/:userId
usersRouter.patch(
  '/:userId',
  asyncHandler(async (req, res) => {
    const userId = parseId(req.params.userId, 'user id');
    const payload = parse(userUpdateSchema, req.body);

    if (payload.teamId) await assertTeamExists(payload.teamId);

    const update = buildUpdate(payload, {
      name: 'name',
      email: 'email',
      title: 'title',
      teamId: 'team_id',
      avatarUrl: 'avatar_url',
      avatarColor: 'avatar_color',
    });

    if (!update) throw ApiError.badRequest('هیچ فیلدی برای به‌روزرسانی داده نشده.');

    const updated = await queryOne(
      `UPDATE users SET ${update.assignments.join(', ')}
       WHERE id = $${update.nextIndex}
       RETURNING id`,
      [...update.values, userId],
    );

    if (!updated) throw ApiError.notFound('کاربر پیدا نشد.');

    const row = await queryOne(`${USER_WITH_CONTEXT} WHERE u.id = $1`, [userId]);
    res.json({ data: toUserDto(row) });
  }),
);

/**
 * DELETE /api/users/:userId
 *
 * Their modules are not deleted — the FK is ON DELETE SET NULL, so the work
 * simply becomes unassigned. The response reports how many that was.
 */
usersRouter.delete(
  '/:userId',
  asyncHandler(async (req, res) => {
    const userId = parseId(req.params.userId, 'user id');

    const existing = await queryOne(
      'SELECT id, (SELECT count(*) FROM modules m WHERE m.assignee_id = users.id) AS assigned FROM users WHERE id = $1',
      [userId],
    );
    if (!existing) throw ApiError.notFound('کاربر پیدا نشد.');

    await query('DELETE FROM users WHERE id = $1', [userId]);

    res.json({ data: { id: userId, unassignedModules: existing.assigned } });
  }),
);

async function assertTeamExists(teamId) {
  const team = await queryOne('SELECT id FROM teams WHERE id = $1', [teamId]);
  if (!team) throw ApiError.badRequest('چنین ردیفی وجود ندارد.');
}
