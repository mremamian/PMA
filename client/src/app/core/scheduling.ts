/**
 * Dependency constraint maths, mirrored from `server/src/lib/scheduling.js`.
 *
 * The duplication is deliberate: dragging a bar must show a conflict the
 * instant the pointer moves, and a round trip per frame would make the chart
 * feel dead. The server stays the authority — it re-checks and cascades on
 * every write — this is the optimistic half.
 */
import { addDays, diffDays, nextWorkingDay } from './jalali';
import type { Dependency, ProjectModule, Violation } from './models';

/** Just the fields the constraint maths needs, so drafts can be checked too. */
export interface Scheduled {
  id: string;
  startDate: string;
  endDate: string;
}

/**
 * Earliest start a successor may take given one predecessor and their link.
 * `duration` is the successor's span in days (end - start).
 */
export function earliestStartFor(
  edge: Pick<Dependency, 'type' | 'lagDays'>,
  predecessor: Scheduled,
  duration: number,
): string {
  const lag = edge.lagDays ?? 0;

  // Snapped forward to a working day, matching the server. Every rule here is
  // a "no earlier than" bound, so moving later can never break it.
  switch (edge.type) {
    case 'SS':
      return nextWorkingDay(addDays(predecessor.startDate, lag));
    case 'FF':
      return nextWorkingDay(addDays(predecessor.endDate, lag - duration));
    case 'SF':
      return nextWorkingDay(addDays(predecessor.startDate, lag - duration));
    case 'FS':
    default:
      return nextWorkingDay(addDays(predecessor.endDate, 1 + lag));
  }
}

/** Every link whose current dates break its own constraint. */
export function findViolations(
  modules: readonly ProjectModule[],
  dependencies: readonly Dependency[],
): Violation[] {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const violations: Violation[] = [];

  for (const edge of dependencies) {
    const predecessor = byId.get(edge.fromModuleId);
    const successor = byId.get(edge.toModuleId);
    if (!predecessor || !successor) continue;

    const duration = diffDays(successor.startDate, successor.endDate);
    const earliest = earliestStartFor(edge, predecessor, duration);

    if (successor.startDate < earliest) {
      violations.push({
        dependencyId: edge.id,
        fromModuleId: edge.fromModuleId,
        toModuleId: edge.toModuleId,
        type: edge.type,
        earliestStart: earliest,
        actualStart: successor.startDate,
        slipDays: diffDays(successor.startDate, earliest),
      });
    }
  }

  return violations;
}

/**
 * Would linking `from -> to` close a loop? True when `to` already reaches
 * `from`. Checked before the drag-to-link gesture commits so the arrow can be
 * refused without a server round trip.
 */
export function wouldCreateCycle(
  dependencies: readonly Dependency[],
  fromModuleId: string,
  toModuleId: string,
): boolean {
  if (fromModuleId === toModuleId) return true;

  const successors = new Map<string, string[]>();
  for (const edge of dependencies) {
    const list = successors.get(edge.fromModuleId);
    if (list) list.push(edge.toModuleId);
    else successors.set(edge.fromModuleId, [edge.toModuleId]);
  }

  const seen = new Set<string>([toModuleId]);
  const queue = [toModuleId];

  while (queue.length) {
    const current = queue.shift()!;
    if (current === fromModuleId) return true;

    for (const next of successors.get(current) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }

  return false;
}

/** Modules with no predecessor still unfinished — what could start today. */
export function isBlocked(
  moduleId: string,
  modules: readonly ProjectModule[],
  dependencies: readonly Dependency[],
): boolean {
  const byId = new Map(modules.map((m) => [m.id, m]));
  return dependencies
    .filter((edge) => edge.toModuleId === moduleId)
    .some((edge) => byId.get(edge.fromModuleId)?.status !== 'done');
}
