/**
 * Calendar-day helpers. Dates are `YYYY-MM-DD` strings throughout; every
 * operation goes through UTC so a host timezone can never shift a day.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

/** True when `value` is a well-formed *and* real calendar date (rejects 2026-02-30). */
export function isIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

export function toUtcDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function toIso(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso, days) {
  return toIso(new Date(toUtcDate(iso).getTime() + days * MS_PER_DAY));
}

/** Whole days from `a` to `b`; negative when `b` precedes `a`. */
export function diffDays(a, b) {
  return Math.round((toUtcDate(b).getTime() - toUtcDate(a).getTime()) / MS_PER_DAY);
}

export function maxIso(a, b) {
  return a > b ? a : b;
}

/** Today in the server's local calendar, as `YYYY-MM-DD`. */
export function todayIso() {
  const now = new Date();
  return toIso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())));
}

/* --------------------------------------------------------- working week -- */

/**
 * Non-working days as Persian weekday indices: 5 = Thursday, 6 = Friday.
 * The working week is Saturday to Wednesday.
 *
 * This mirrors `WEEKEND_DAYS` in the client's `core/jalali.ts`. The two must
 * agree: the client previews a drag using its copy, and the server commits and
 * cascades using this one.
 */
export const WEEKEND_DAYS = [5, 6];

/** Persian weekday index: 0 = Saturday … 6 = Friday. */
export function jalaliWeekday(iso) {
  // getUTCDay(): 0 = Sunday. Shift so Saturday leads the week.
  return (toUtcDate(iso).getUTCDay() + 1) % 7;
}

export function isWeekend(iso) {
  return WEEKEND_DAYS.includes(jalaliWeekday(iso));
}

/** `iso` itself when it is a working day, otherwise the next one. */
export function nextWorkingDay(iso) {
  let day = iso;
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}

/** Moves `count` working days forward from `iso`, skipping weekends. */
export function addWorkingDays(iso, count) {
  let day = nextWorkingDay(iso);
  let remaining = count;

  while (remaining > 0) {
    day = nextWorkingDay(addDays(day, 1));
    remaining -= 1;
  }

  return day;
}

/** Inclusive count of working days between two dates. */
export function workingDaysBetween(startIso, endIso) {
  if (endIso < startIso) return 0;

  const span = diffDays(startIso, endIso) + 1;
  const fullWeeks = Math.floor(span / 7);
  let count = fullWeeks * (7 - WEEKEND_DAYS.length);

  for (let day = addDays(startIso, fullWeeks * 7); day <= endIso; day = addDays(day, 1)) {
    if (!isWeekend(day)) count += 1;
  }

  return count;
}
