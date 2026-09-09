import { z } from 'zod';
import { isIsoDate } from './dates.js';
import { ApiError } from './http.js';

const isoDate = z
  .string()
  .refine(isIsoDate, { message: 'تاریخ باید یک روز معتبر تقویمی به شکل YYYY-MM-DD باشد' });

const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'رنگ باید به شکل هگز مانند ‎#6366f1 باشد');

const name = z.string().trim().min(1, 'وارد کردن نام الزامی است').max(160);
const uuid = z.uuid('شناسه باید یک UUID معتبر باشد');

export const uuidParam = uuid;

/* ------------------------------------------------------------- projects -- */

export const projectCreateSchema = z
  .object({
    name,
    description: z.string().max(4000).default(''),
    startDate: isoDate,
    endDate: isoDate,
    status: z.enum(['planning', 'active', 'on_hold', 'done', 'archived']).default('active'),
    color: hexColor.default('#6366f1'),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'تاریخ پایان نباید پیش از تاریخ شروع باشد',
    path: ['endDate'],
  });

export const projectUpdateSchema = z
  .object({
    name: name.optional(),
    description: z.string().max(4000).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    status: z.enum(['planning', 'active', 'on_hold', 'done', 'archived']).optional(),
    color: hexColor.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'هیچ فیلدی برای به‌روزرسانی داده نشده' });

/* ---------------------------------------------------------------- teams -- */

export const teamCreateSchema = z.object({
  name,
  kind: z.enum(['team', 'external']).default('team'),
  color: hexColor.default('#93c5fd'),
  sortOrder: z.number().int().optional(),
});

export const teamUpdateSchema = z
  .object({
    name: name.optional(),
    kind: z.enum(['team', 'external']).optional(),
    color: hexColor.optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'هیچ فیلدی برای به‌روزرسانی داده نشده' });

export const reorderSchema = z.object({
  ids: z.array(uuid).min(1, 'دست‌کم یک شناسه لازم است'),
});

/** The complete set of teams a project involves. Empty means "no rows". */
export const teamLinkSchema = z.object({
  teamIds: z.array(uuid),
});

/** Moving several modules by the same number of calendar days. */
export const moduleShiftSchema = z.object({
  moduleIds: z.array(uuid).min(1, 'دست‌کم یک ماژول لازم است'),
  deltaDays: z
    .number()
    .int()
    .min(-3650)
    .max(3650)
    .refine((value) => value !== 0, { message: 'جابه‌جایی صفر روز تغییری ایجاد نمی‌کند' }),
});

/* -------------------------------------------------------------- modules -- */

const moduleBase = {
  teamId: uuid,
  name,
  description: z.string().max(4000).default(''),
  startDate: isoDate,
  endDate: isoDate,
  progress: z.number().int().min(0).max(100).default(0),
  kind: z.enum(['task', 'milestone']).default('task'),
  status: z.enum(['planned', 'in_progress', 'blocked', 'done']).default('planned'),
  /** The person doing the work; null leaves the module unassigned. */
  assigneeId: uuid.nullish(),
  color: hexColor.nullish(),
  sortOrder: z.number().int().optional(),
};

export const moduleCreateSchema = z
  .object(moduleBase)
  .refine((v) => v.endDate >= v.startDate, {
    message: 'تاریخ پایان نباید پیش از تاریخ شروع باشد',
    path: ['endDate'],
  })
  .refine((v) => v.kind !== 'milestone' || v.startDate === v.endDate, {
    message: 'نقطهٔ عطف باید در یک روز شروع و پایان یابد',
    path: ['endDate'],
  });

export const moduleUpdateSchema = z
  .object({
    teamId: uuid.optional(),
    name: name.optional(),
    description: z.string().max(4000).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    progress: z.number().int().min(0).max(100).optional(),
    kind: z.enum(['task', 'milestone']).optional(),
    status: z.enum(['planned', 'in_progress', 'blocked', 'done']).optional(),
    assigneeId: uuid.nullish(),
    color: hexColor.nullish(),
    sortOrder: z.number().int().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'هیچ فیلدی برای به‌روزرسانی داده نشده' })
  .refine((v) => !(v.startDate && v.endDate) || v.endDate >= v.startDate, {
    message: 'تاریخ پایان نباید پیش از تاریخ شروع باشد',
    path: ['endDate'],
  });

/* ---------------------------------------------------------------- users -- */

/**
 * Avatars are referenced by URL rather than uploaded, so there is no file
 * storage to run. The scheme is restricted to http(s) so a stray `javascript:`
 * or `data:` value can never reach an `img src`.
 */
const avatarUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => value === '' || /^https?:\/\//i.test(value), {
    message: 'نشانی تصویر باید با http یا https شروع شود',
  })
  // An empty field means "no picture", which is NULL rather than ''.
  .transform((value) => (value === '' ? null : value));

const email = z
  .string()
  .trim()
  .max(254)
  .refine((value) => value === '' || z.email().safeParse(value).success, {
    message: 'ایمیل واردشده معتبر نیست',
  })
  .transform((value) => (value === '' ? null : value));

export const userCreateSchema = z.object({
  name,
  email: email.nullish(),
  title: z.string().trim().max(160).default(''),
  /** Their home team; a team row in some project, or null if unplaced. */
  teamId: uuid.nullish(),
  avatarUrl: avatarUrl.nullish(),
  avatarColor: hexColor.default('#6366f1'),
});

export const userUpdateSchema = z
  .object({
    name: name.optional(),
    email: email.nullish(),
    title: z.string().trim().max(160).optional(),
    teamId: uuid.nullish(),
    avatarUrl: avatarUrl.nullish(),
    avatarColor: hexColor.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'هیچ فیلدی برای به‌روزرسانی داده نشده' });

/* --------------------------------------------------------- dependencies -- */

export const dependencyCreateSchema = z
  .object({
    fromModuleId: uuid,
    toModuleId: uuid,
    type: z.enum(['FS', 'SS', 'FF', 'SF']).default('FS'),
    lagDays: z.number().int().min(-365).max(365).default(0),
  })
  .refine((v) => v.fromModuleId !== v.toModuleId, {
    message: 'یک ماژول نمی‌تواند به خودش وابسته باشد',
    path: ['toModuleId'],
  });

export const dependencyUpdateSchema = z
  .object({
    type: z.enum(['FS', 'SS', 'FF', 'SF']).optional(),
    lagDays: z.number().int().min(-365).max(365).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'هیچ فیلدی برای به‌روزرسانی داده نشده' });

/* --------------------------------------------------------------- helper -- */

/** Parse `data` or throw a 400 carrying per-field messages. */
export function parse(schema, data) {
  const result = schema.safeParse(data);
  if (result.success) return result.data;

  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || '(body)',
    message: issue.message,
  }));

  throw ApiError.badRequest('اعتبارسنجی ورودی ناموفق بود.', details);
}

/** Validate a route param that must be a UUID. */
export function parseId(value, label = 'id') {
  const result = uuid.safeParse(value);
  if (!result.success) throw ApiError.badRequest(`شناسهٔ نامعتبر (${label}).`);
  return result.data;
}
