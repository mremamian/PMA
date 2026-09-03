/**
 * Timeline geometry: the mapping between calendar days and x-pixels, plus the
 * Jalali tick bands drawn across the top of the chart.
 *
 * A day is a *cell*, not a point. The module 2026-04-05 → 2026-04-05 is one
 * day long and occupies one cell's width, so `xFor` returns a cell's left edge
 * and `xForEndOfDay` its right edge.
 */
import {
  addDays,
  diffDays,
  formatDayNumber,
  formatMonthYear,
  formatWeekdayNarrow,
  formatYear,
  isWeekend,
  jalaliMonthLength,
  monthNameShort,
  startOfJalaliMonth,
  startOfJalaliWeek,
  startOfJalaliYear,
  toIso,
  toJalali,
  toPersianDigits,
  type JalaliLocale,
} from './jalali';

export type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

export interface ZoomPreset {
  id: ZoomLevel;
  label: string;
  /** Pixels per calendar day. */
  dayWidth: number;
  /** Granularity of the lower header band. */
  minorUnit: 'day' | 'week' | 'month';
}

export const ZOOM_PRESETS: readonly ZoomPreset[] = [
  { id: 'day', label: 'Day', dayWidth: 34, minorUnit: 'day' },
  { id: 'week', label: 'Week', dayWidth: 12, minorUnit: 'week' },
  { id: 'month', label: 'Month', dayWidth: 4.2, minorUnit: 'month' },
  { id: 'quarter', label: 'Quarter', dayWidth: 1.8, minorUnit: 'month' },
];

export const DEFAULT_ZOOM: ZoomLevel = 'week';

export interface TimelineTick {
  /** First day covered by this tick. */
  iso: string;
  x: number;
  width: number;
  label: string;
  /** Secondary label, e.g. the weekday letter under a day number. */
  sublabel?: string;
  isWeekend: boolean;
  isToday: boolean;
  /** True when the tick starts a new Jalali month — drawn as a heavier gridline. */
  startsMonth: boolean;
}

export class Timeline {
  readonly totalDays: number;
  readonly width: number;

  constructor(
    /** First day shown, inclusive. */
    readonly startIso: string,
    /** Last day shown, inclusive. */
    readonly endIso: string,
    readonly dayWidth: number,
    readonly locale: JalaliLocale = 'fa',
    readonly persianDigits = true,
  ) {
    this.totalDays = Math.max(1, diffDays(startIso, endIso) + 1);
    this.width = this.totalDays * dayWidth;
  }

  private get fmt() {
    return { locale: this.locale, persianDigits: this.persianDigits };
  }

  /** Left edge of the cell for `iso`. */
  xFor(iso: string): number {
    return diffDays(this.startIso, iso) * this.dayWidth;
  }

  /** Right edge of the cell for `iso` — i.e. the instant that day ends. */
  xForEndOfDay(iso: string): number {
    return this.xFor(iso) + this.dayWidth;
  }

  /** Centre of the cell for `iso`, where milestone diamonds sit. */
  xForCenter(iso: string): number {
    return this.xFor(iso) + this.dayWidth / 2;
  }

  /** Width in pixels of an inclusive `start..end` span. */
  widthFor(startIso: string, endIso: string): number {
    return (diffDays(startIso, endIso) + 1) * this.dayWidth;
  }

  /** The day whose cell contains pixel `x`. */
  dateAt(x: number): string {
    return addDays(this.startIso, Math.floor(x / this.dayWidth));
  }

  /** A pixel delta converted to a whole number of days. */
  daysFromPixels(dx: number): number {
    return Math.round(dx / this.dayWidth);
  }

  /** Top band: Jalali month (with year), one tick per month in range. */
  monthTicks(): TimelineTick[] {
    const ticks: TimelineTick[] = [];
    let cursor = startOfJalaliMonth(this.startIso);

    while (cursor <= this.endIso) {
      const { jy, jm } = toJalali(cursor);
      const monthEnd = addDays(cursor, jalaliMonthLength(jy, jm) - 1);

      const visibleStart = cursor < this.startIso ? this.startIso : cursor;
      const visibleEnd = monthEnd > this.endIso ? this.endIso : monthEnd;

      const width = this.widthFor(visibleStart, visibleEnd);
      // Below ~46px there is no room for "Shahrivar 1405"; fall back to "Sha".
      const label =
        width >= 78
          ? formatMonthYear(cursor, this.fmt)
          : width >= 30
            ? monthNameShort(jm, this.locale)
            : '';

      ticks.push({
        iso: visibleStart,
        x: this.xFor(visibleStart),
        width,
        label,
        isWeekend: false,
        isToday: false,
        startsMonth: true,
      });

      cursor = addDays(monthEnd, 1);
    }

    return ticks;
  }

  /** Year band, shown when the range spans more than one Jalali year. */
  yearTicks(): TimelineTick[] {
    const ticks: TimelineTick[] = [];
    let cursor = startOfJalaliYear(this.startIso);

    while (cursor <= this.endIso) {
      const { jy } = toJalali(cursor);
      const yearEnd = addDays(toIso(jy + 1, 1, 1), -1);

      const visibleStart = cursor < this.startIso ? this.startIso : cursor;
      const visibleEnd = yearEnd > this.endIso ? this.endIso : yearEnd;

      ticks.push({
        iso: visibleStart,
        x: this.xFor(visibleStart),
        width: this.widthFor(visibleStart, visibleEnd),
        label: formatYear(cursor, this.fmt),
        isWeekend: false,
        isToday: false,
        startsMonth: false,
      });

      cursor = addDays(yearEnd, 1);
    }

    return ticks;
  }

  /**
   * Lower band. Day cells when zoomed in, week cells at mid zoom, and nothing
   * at all when zoomed out — the month band above already carries the labels,
   * and 900 day cells would be unreadable as well as slow.
   */
  minorTicks(minorUnit: ZoomPreset['minorUnit'], todayIsoValue: string): TimelineTick[] {
    if (minorUnit === 'month') return [];

    const ticks: TimelineTick[] = [];

    if (minorUnit === 'day') {
      for (let cursor = this.startIso; cursor <= this.endIso; cursor = addDays(cursor, 1)) {
        ticks.push({
          iso: cursor,
          x: this.xFor(cursor),
          width: this.dayWidth,
          label: formatDayNumber(cursor, this.fmt),
          sublabel: formatWeekdayNarrow(cursor, this.locale),
          isWeekend: isWeekend(cursor),
          isToday: cursor === todayIsoValue,
          startsMonth: toJalali(cursor).jd === 1,
        });
      }
      return ticks;
    }

    // Weeks: label each Saturday with the day-of-month it falls on.
    let cursor = startOfJalaliWeek(this.startIso);
    while (cursor <= this.endIso) {
      const weekEnd = addDays(cursor, 6);
      const visibleStart = cursor < this.startIso ? this.startIso : cursor;
      const visibleEnd = weekEnd > this.endIso ? this.endIso : weekEnd;

      ticks.push({
        iso: visibleStart,
        x: this.xFor(visibleStart),
        width: this.widthFor(visibleStart, visibleEnd),
        label: formatDayNumber(cursor, this.fmt),
        isWeekend: false,
        isToday: todayIsoValue >= visibleStart && todayIsoValue <= visibleEnd,
        startsMonth: toJalali(visibleStart).jd === 1,
      });

      cursor = addDays(weekEnd, 1);
    }

    return ticks;
  }

  /**
   * Shaded bands for Thursdays and Fridays, drawn only when a day is wide
   * enough to see. Two adjacent days make a visible block at month zoom, so
   * the threshold is lower than it would be for a single day.
   */
  weekendBands(): { x: number; width: number }[] {
    if (this.dayWidth < 4) return [];

    const bands: { x: number; width: number }[] = [];
    for (let cursor = this.startIso; cursor <= this.endIso; cursor = addDays(cursor, 1)) {
      if (isWeekend(cursor)) {
        bands.push({ x: this.xFor(cursor), width: this.dayWidth });
      }
    }
    return bands;
  }

  /** X of the today marker, or null when today is outside the visible range. */
  todayX(todayIsoValue: string): number | null {
    if (todayIsoValue < this.startIso || todayIsoValue > this.endIso) return null;
    return this.xForCenter(todayIsoValue);
  }
}

/**
 * Pads a project's date span so bars never touch the chart edges, and rounds
 * outwards to whole Jalali months so the month band starts and ends cleanly.
 */
export function paddedRange(
  startIso: string,
  endIso: string,
  paddingDays = 14,
): { start: string; end: string } {
  const start = startOfJalaliMonth(addDays(startIso, -paddingDays));

  const paddedEnd = addDays(endIso, paddingDays);
  const { jy, jm } = toJalali(paddedEnd);
  const end = addDays(startOfJalaliMonth(paddedEnd), jalaliMonthLength(jy, jm) - 1);

  return { start, end };
}

/** `۱۲ روز` style counts for chips and tooltips. */
export function localeNumber(value: number, persianDigits: boolean): string {
  return persianDigits ? toPersianDigits(value) : String(value);
}
