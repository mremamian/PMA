/**
 * Capacity maths for the people report: when someone is free, when they are
 * carrying more than one thing at once, and how loaded they are overall.
 *
 * Fridays are excluded throughout. The Iranian working week runs Saturday to
 * Thursday, so counting Fridays would quietly understate everyone's
 * utilisation and invent "free time" nobody actually has.
 */
import { addDays, isWeekend, maxIso, minIso, workingDaysBetween } from './jalali';
import type { Assignment, User } from './models';

export interface Period {
  start: string;
  end: string;
  /** Length in working days, so a run spanning a Friday is not inflated. */
  days: number;
}

export interface OverloadPeriod extends Period {
  /** The most things running at once during this stretch. */
  peak: number;
}

export interface PersonWorkload {
  user: User;
  assignments: Assignment[];
  /** Assignments packed into non-overlapping rows, for drawing. */
  lanes: Assignment[][];

  /** Working days in the window on which they have at least one thing. */
  busyDays: number;
  /** Working days with nothing at all. */
  freeDays: number;
  /** Working days carrying two or more things at once. */
  overloadedDays: number;
  /** Sum of per-day workload — two parallel modules on one day count twice. */
  committedDays: number;
  /** Most concurrent assignments at any point. */
  peakConcurrency: number;

  /** busyDays / working days in window, 0-1. */
  utilisation: number;
  /** committedDays / working days. Above 1 means over-committed on average. */
  loadFactor: number;

  /** Stretches with nothing scheduled. */
  gaps: Period[];
  /** Stretches carrying two or more things. */
  overloads: OverloadPeriod[];
  /** The first gap that has not already passed — where new work could go. */
  nextFreeFrom: string | null;
}

export interface WorkloadWindow {
  from: string;
  to: string;
}

/** Working days (Saturday-Thursday) in the window, in order. */
export function workingDaysIn(window: WorkloadWindow): string[] {
  const days: string[] = [];
  for (let day = window.from; day <= window.to; day = addDays(day, 1)) {
    if (!isWeekend(day)) days.push(day);
  }
  return days;
}

/** Greedy interval packing, so parallel work is visibly stacked. */
export function packLanes(assignments: readonly Assignment[]): Assignment[][] {
  const lanes: Assignment[][] = [];

  for (const assignment of [...assignments].sort(
    (a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate),
  )) {
    const lane = lanes.find((existing) => {
      const last = existing[existing.length - 1];
      return last.endDate < assignment.startDate;
    });

    if (lane) lane.push(assignment);
    else lanes.push([assignment]);
  }

  return lanes;
}

/** Collapses a per-day predicate into contiguous runs of working days. */
function runsOf(
  days: string[],
  counts: Map<string, number>,
  matches: (count: number) => boolean,
): { start: string; end: string; days: number; peak: number }[] {
  const runs: { start: string; end: string; days: number; peak: number }[] = [];
  let start: string | null = null;
  let last: string | null = null;
  let length = 0;
  let peak = 0;

  const close = () => {
    if (start && last) runs.push({ start, end: last, days: length, peak });
    start = null;
    last = null;
    length = 0;
    peak = 0;
  };

  for (const day of days) {
    const count = counts.get(day) ?? 0;
    if (matches(count)) {
      start ??= day;
      last = day;
      length += 1;
      peak = Math.max(peak, count);
    } else {
      close();
    }
  }
  close();

  return runs;
}

/**
 * Builds one workload profile per person.
 *
 * Concurrency is accumulated per assignment rather than by scanning every day
 * against every assignment, so cost scales with the amount of scheduled work
 * rather than window length × module count.
 */
export function buildWorkload(
  users: readonly User[],
  assignments: readonly Assignment[],
  window: WorkloadWindow,
  today: string,
): PersonWorkload[] {
  const days = workingDaysIn(window);
  const workingTotal = days.length || 1;

  const byUser = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    if (!assignment.assigneeId) continue;
    const list = byUser.get(assignment.assigneeId);
    if (list) list.push(assignment);
    else byUser.set(assignment.assigneeId, [assignment]);
  }

  return users.map((user) => {
    const mine = byUser.get(user.id) ?? [];

    const counts = new Map<string, number>();
    for (const assignment of mine) {
      const start = maxIso(assignment.startDate, window.from);
      const end = minIso(assignment.endDate, window.to);
      for (let day = start; day <= end; day = addDays(day, 1)) {
        if (isWeekend(day)) continue;
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
    }

    let busyDays = 0;
    let overloadedDays = 0;
    let committedDays = 0;
    let peakConcurrency = 0;

    for (const day of days) {
      const count = counts.get(day) ?? 0;
      committedDays += count;
      if (count > 0) busyDays += 1;
      if (count > 1) overloadedDays += 1;
      peakConcurrency = Math.max(peakConcurrency, count);
    }

    const gaps = runsOf(days, counts, (count) => count === 0).map(
      ({ start, end, days: length }) => ({ start, end, days: length }),
    );

    const overloads = runsOf(days, counts, (count) => count > 1).map(
      ({ start, end, days: length, peak }) => ({ start, end, days: length, peak }),
    );

    // Past gaps are history; the useful one is the next opening.
    const nextGap = gaps.find((gap) => gap.end >= today) ?? null;

    return {
      user,
      assignments: mine,
      lanes: packLanes(mine),
      busyDays,
      freeDays: workingTotal - busyDays,
      overloadedDays,
      committedDays,
      peakConcurrency,
      utilisation: busyDays / workingTotal,
      loadFactor: committedDays / workingTotal,
      gaps,
      overloads,
      nextFreeFrom: nextGap ? maxIso(nextGap.start, today) : null,
    };
  });
}

/** Inclusive length of an assignment in *working* days — Thu/Fri excluded. */
export function assignmentDays(assignment: Assignment): number {
  return workingDaysBetween(assignment.startDate, assignment.endDate);
}
