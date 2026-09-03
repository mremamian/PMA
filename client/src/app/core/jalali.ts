/**
 * Jalali (Shamsi / Persian) calendar support, built on `date-fns-jalali` —
 * a date-fns v4 port whose every function operates on the Jalali calendar.
 *
 * Boundary rules for this module:
 *  - The API and the database speak Gregorian `YYYY-MM-DD` calendar days.
 *  - The UI speaks Jalali.
 *  - `Date` objects are only ever an intermediate representation, always built
 *    at *local* midnight. `new Date('2026-09-02')` would parse as UTC midnight
 *    and land on the previous day west of Greenwich, so ISO strings are split
 *    by hand rather than handed to the Date constructor.
 */
import {
  addDays as addDaysFns,
  differenceInCalendarDays,
  format as formatFns,
  getDate,
  getDaysInMonth,
  getDay,
  getMonth,
  getYear,
  isLeapYear,
  newDate,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns-jalali';
import { faIR } from 'date-fns-jalali/locale/fa-IR';
import { enUS } from 'date-fns-jalali/locale/en-US';

export interface JalaliDate {
  /** Jalali year, e.g. 1405 */
  jy: number;
  /** Jalali month, 1-12 */
  jm: number;
  /** Jalali day of month, 1-31 */
  jd: number;
}

/** Which script dates are rendered in. */
export type JalaliLocale = 'fa' | 'en';

/** Saturday — the first day of the Persian week. */
const WEEK_STARTS_ON = 6 as const;

const LOCALES = { fa: faIR, en: enUS };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

/* --------------------------------------------------- ISO <-> Date bridge -- */

/** `2026-09-02` → a Date at local midnight on that Gregorian day. */
export function isoToDate(iso: string): Date {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new TypeError(`Expected YYYY-MM-DD, received "${iso}"`);
  return new Date(+match[1], +match[2] - 1, +match[3]);
}

/** A Date → its local Gregorian day as `YYYY-MM-DD`. */
export function dateToIso(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/* ------------------------------------------------------------ conversion -- */

/** `2026-09-02` → `{ jy: 1405, jm: 6, jd: 11 }` */
export function toJalali(iso: string): JalaliDate {
  const date = isoToDate(iso);
  return { jy: getYear(date), jm: getMonth(date) + 1, jd: getDate(date) };
}

/** `(1405, 6, 11)` → `2026-09-02` */
export function toIso(jy: number, jm: number, jd: number): string {
  return dateToIso(newDate(jy, jm - 1, jd));
}

export function isLeapJalaliYear(jy: number): boolean {
  return isLeapYear(newDate(jy, 0, 1));
}

/** Days in a Jalali month: 31 for Farvardin–Shahrivar, 30 for Mehr–Bahman, 29/30 for Esfand. */
export function jalaliMonthLength(jy: number, jm: number): number {
  return getDaysInMonth(newDate(jy, jm - 1, 1));
}

export function isValidJalali(jy: number, jm: number, jd: number): boolean {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return false;
  if (jy < 1 || jy > 3177 || jm < 1 || jm > 12 || jd < 1) return false;
  return jd <= jalaliMonthLength(jy, jm);
}

/* -------------------------------------------------------- day arithmetic -- */

export function addDays(iso: string, days: number): string {
  return dateToIso(addDaysFns(isoToDate(iso), days));
}

/** Whole calendar days from `a` to `b`; negative when `b` is earlier. */
export function diffDays(a: string, b: string): number {
  return differenceInCalendarDays(isoToDate(b), isoToDate(a));
}

/** Today as `YYYY-MM-DD` in the browser's local calendar. */
export function todayIso(): string {
  return dateToIso(new Date());
}

export function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

export function clampIso(value: string, low: string, high: string): string {
  return minIso(maxIso(value, low), high);
}

/** Day of the week as a Persian index: 0 = Saturday … 6 = Friday. */
export function jalaliWeekday(iso: string): number {
  // date-fns getDay() is 0 = Sunday; rotate so Saturday leads the week.
  return (getDay(isoToDate(iso)) + 1) % 7;
}

/**
 * Non-working days, as Persian weekday indices: 5 = Thursday, 6 = Friday.
 *
 * The working week here is Saturday to Wednesday. Everything that counts days
 * — bar durations, utilisation, dependency scheduling — goes through this, so
 * the definition lives in exactly one place.
 */
export const WEEKEND_DAYS: readonly number[] = [5, 6];

export function isWeekend(iso: string): boolean {
  return WEEKEND_DAYS.includes(jalaliWeekday(iso));
}

/** `iso` itself if it is a working day, otherwise the next one. */
export function nextWorkingDay(iso: string): string {
  let day = iso;
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}

/** `iso` itself if it is a working day, otherwise the previous one. */
export function previousWorkingDay(iso: string): string {
  let day = iso;
  while (isWeekend(day)) day = addDays(day, -1);
  return day;
}

/**
 * Inclusive count of working days from `startIso` to `endIso`.
 *
 * Whole weeks are counted arithmetically — five working days each — so only
 * the trailing partial week is walked. A year-long span costs six iterations
 * rather than 365, which matters because this runs per bar while dragging.
 */
export function workingDaysBetween(startIso: string, endIso: string): number {
  if (endIso < startIso) return 0;

  const span = diffDays(startIso, endIso) + 1;
  const fullWeeks = Math.floor(span / 7);
  let count = fullWeeks * (7 - WEEKEND_DAYS.length);

  for (let day = addDays(startIso, fullWeeks * 7); day <= endIso; day = addDays(day, 1)) {
    if (!isWeekend(day)) count += 1;
  }

  return count;
}

/** Moves `count` working days forward from `iso`, skipping weekends. */
export function addWorkingDays(iso: string, count: number): string {
  let day = nextWorkingDay(iso);
  let remaining = count;

  while (remaining > 0) {
    day = nextWorkingDay(addDays(day, 1));
    remaining -= 1;
  }

  return day;
}

/** 1 Farvardin of the Jalali year containing `iso`. */
export function startOfJalaliYear(iso: string): string {
  return dateToIso(startOfYear(isoToDate(iso)));
}

/** First day of the Jalali month containing `iso`. */
export function startOfJalaliMonth(iso: string): string {
  return dateToIso(startOfMonth(isoToDate(iso)));
}

/** Saturday on or before `iso`. */
export function startOfJalaliWeek(iso: string): string {
  return dateToIso(startOfWeek(isoToDate(iso), { weekStartsOn: WEEK_STARTS_ON }));
}

/* -------------------------------------------------------------- display -- */

export const JALALI_MONTHS_FA = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

export const JALALI_MONTHS_EN = [
  'Farvardin', 'Ordibehesht', 'Khordad', 'Tir', 'Mordad', 'Shahrivar',
  'Mehr', 'Aban', 'Azar', 'Dey', 'Bahman', 'Esfand',
];

/** Compact labels for a narrow axis. */
export const JALALI_MONTHS_EN_SHORT = [
  'Far', 'Ord', 'Kho', 'Tir', 'Mor', 'Sha',
  'Meh', 'Aba', 'Aza', 'Dey', 'Bah', 'Esf',
];

export const JALALI_WEEKDAYS_FA = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
export const JALALI_WEEKDAYS_EN = ['Sa', 'Su', 'Mo', 'Tu', 'We', 'Th', 'Fr'];

const PERSIAN_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** `1405` → `۱۴۰۵` */
export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => PERSIAN_DIGITS[+d]);
}

/** `۱۴۰۵` → `1405`, also normalising Arabic-Indic digits pasted from elsewhere. */
export function toLatinDigits(value: string): string {
  return value
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export interface FormatOptions {
  locale?: JalaliLocale;
  /** Render digits as ۰۱۲۳. Defaults to true for `fa`, false for `en`. */
  persianDigits?: boolean;
}

function resolve(options: FormatOptions = {}): Required<FormatOptions> {
  const locale = options.locale ?? 'fa';
  return { locale, persianDigits: options.persianDigits ?? locale === 'fa' };
}

/**
 * The fa-IR locale renders numerals in Latin script, so digit shaping is
 * applied here — that also keeps it switchable independently of the language.
 */
function shape(text: string, opts: Required<FormatOptions>): string {
  return opts.persianDigits ? toPersianDigits(text) : toLatinDigits(text);
}

export function monthName(jm: number, locale: JalaliLocale = 'fa'): string {
  return (locale === 'fa' ? JALALI_MONTHS_FA : JALALI_MONTHS_EN)[jm - 1];
}

export function monthNameShort(jm: number, locale: JalaliLocale = 'fa'): string {
  return (locale === 'fa' ? JALALI_MONTHS_FA : JALALI_MONTHS_EN_SHORT)[jm - 1];
}

/**
 * Date labels are assembled from the converted components rather than from the
 * library's own locale strings: its en-US Jalali locale spells Shahrivar as
 * "Sharivar", and the axis is too visible a place to inherit that.
 * The library still does all the calendar arithmetic behind `toJalali`.
 */

/** `۱۱ شهریور ۱۴۰۵` / `11 Shahrivar 1405` */
export function formatLong(iso: string, options?: FormatOptions): string {
  const opts = resolve(options);
  const { jy, jm, jd } = toJalali(iso);
  return shape(`${jd} ${monthName(jm, opts.locale)} ${jy}`, opts);
}

/** `۱۴۰۵/۰۶/۱۱` */
export function formatShort(iso: string, options?: FormatOptions): string {
  const opts = resolve(options);
  const { jy, jm, jd } = toJalali(iso);
  return shape(`${jy}/${pad(jm)}/${pad(jd)}`, opts);
}

/** `۱۱ شهریور` — axis ticks, where the year lives on its own band. */
export function formatDayMonth(iso: string, options?: FormatOptions): string {
  const opts = resolve(options);
  const { jm, jd } = toJalali(iso);
  return shape(`${jd} ${monthNameShort(jm, opts.locale)}`, opts);
}

/** `شهریور ۱۴۰۵` — the month band of the timeline header. */
export function formatMonthYear(iso: string, options?: FormatOptions): string {
  const opts = resolve(options);
  const { jy, jm } = toJalali(iso);
  return shape(`${monthName(jm, opts.locale)} ${jy}`, opts);
}

/** `شهریور` — the month band when the column is too narrow for the year. */
export function formatMonthOnly(iso: string, options?: FormatOptions): string {
  const opts = resolve(options);
  return monthNameShort(toJalali(iso).jm, opts.locale);
}

/** Just the day number, for the dense day band. */
export function formatDayNumber(iso: string, options?: FormatOptions): string {
  const opts = resolve(options);
  return shape(String(toJalali(iso).jd), opts);
}

/** `۱۴۰۵` — the year band. */
export function formatYear(iso: string, options?: FormatOptions): string {
  const opts = resolve(options);
  return shape(String(toJalali(iso).jy), opts);
}

/** `شنبه` / `Saturday` — from the library, whose weekday names are correct. */
export function formatWeekdayLong(iso: string, options?: FormatOptions): string {
  const opts = resolve(options);
  return shape(formatFns(isoToDate(iso), 'EEEE', { locale: LOCALES[opts.locale] }), opts);
}

/** `ش` / `Sa` — single-letter heading for the dense day band. */
export function formatWeekdayNarrow(iso: string, locale: JalaliLocale = 'fa'): string {
  const index = jalaliWeekday(iso);
  return (locale === 'fa' ? JALALI_WEEKDAYS_FA : JALALI_WEEKDAYS_EN)[index];
}

/** Parse `1405/06/11`, `1405-6-11` or `۱۴۰۵/۰۶/۱۱` into a Gregorian ISO date. */
export function parseJalaliInput(text: string): string | null {
  const normalised = toLatinDigits(text).trim().replace(/[/.،]/g, '-');
  const match = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(normalised);
  if (!match) return null;

  const [jy, jm, jd] = [+match[1], +match[2], +match[3]];
  if (!isValidJalali(jy, jm, jd)) return null;

  return toIso(jy, jm, jd);
}

/** `۱۲ روز` / `12 days` */
export function formatDuration(days: number, options?: FormatOptions): string {
  const opts = resolve(options);
  const count = shape(String(days), opts);
  return opts.locale === 'fa' ? `${count} روز` : `${count} day${days === 1 ? '' : 's'}`;
}

/**
 * Inclusive length of a bar in *working* days — Thursdays and Fridays do not
 * count, so a Saturday-to-Sunday bar is 8 days of work, not 10.
 */
export function durationDays(startIso: string, endIso: string): number {
  return workingDaysBetween(startIso, endIso);
}

/** Inclusive calendar length, including weekends. Used for bar geometry. */
export function calendarDays(startIso: string, endIso: string): number {
  return diffDays(startIso, endIso) + 1;
}
