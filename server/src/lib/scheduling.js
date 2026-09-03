import {
  addDays,
  addWorkingDays,
  diffDays,
  maxIso,
  nextWorkingDay,
  workingDaysBetween,
} from './dates.js';

/**
 * Earliest start date a successor may take, given one predecessor and the edge
 * joining them. `duration` is the successor's length in days (end - start), which
 * the finish-anchored types need in order to work backwards to a start date.
 *
 *   FS  successor starts the working day after the predecessor finishes
 *   SS  successor starts no earlier than the predecessor starts
 *   FF  successor finishes no earlier than the predecessor finishes
 *   SF  successor finishes no earlier than the predecessor starts
 *
 * The result is always snapped forward to a working day. Nothing starts on a
 * Thursday or Friday, and since every rule is a "no earlier than" bound,
 * moving later can never violate the constraint it came from.
 */
function earliestStartFor(edge, predecessor, duration) {
  const lag = edge.lagDays ?? 0;

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

/** Kahn's algorithm over the whole project graph. Cycles are rejected on write, */
/** but if one ever slips through we return what we ordered and stop. */
function topologicalOrder(ids, edges) {
  const indegree = new Map(ids.map((id) => [id, 0]));
  const successors = new Map(ids.map((id) => [id, []]));

  for (const edge of edges) {
    if (!indegree.has(edge.toModuleId) || !successors.has(edge.fromModuleId)) continue;
    indegree.set(edge.toModuleId, indegree.get(edge.toModuleId) + 1);
    successors.get(edge.fromModuleId).push(edge.toModuleId);
  }

  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order = [];

  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const next of successors.get(id)) {
      const remaining = indegree.get(next) - 1;
      indegree.set(next, remaining);
      if (remaining === 0) queue.push(next);
    }
  }

  return order;
}

/**
 * Push everything downstream of `changedIds` far enough forward that all
 * dependency constraints hold again.
 *
 * Deliberately one-directional: modules are only ever moved later, never
 * pulled earlier. Compacting a plan is a decision a PM makes on purpose, not a
 * side effect of nudging one bar, and pulling work forward silently would
 * rewrite dates nobody asked to change.
 *
 * @param {Array<{id, startDate, endDate}>} modules  every module in the project
 * @param {Array<{fromModuleId, toModuleId, type, lagDays}>} dependencies
 * @param {string[]} changedIds  modules the user just moved
 * @returns {Map<string, {startDate, endDate}>} only the modules that shifted
 */
export function cascadeSchedule(modules, dependencies, changedIds) {
  const byId = new Map(
    modules.map((m) => [m.id, { ...m, startDate: m.startDate, endDate: m.endDate }]),
  );

  // Everything downstream of the edit, transitively.
  const affected = new Set();
  const queue = [...changedIds];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of dependencies) {
      if (edge.fromModuleId !== current || affected.has(edge.toModuleId)) continue;
      affected.add(edge.toModuleId);
      queue.push(edge.toModuleId);
    }
  }

  if (affected.size === 0) return new Map();

  const incoming = new Map();
  for (const edge of dependencies) {
    if (!affected.has(edge.toModuleId)) continue;
    if (!incoming.has(edge.toModuleId)) incoming.set(edge.toModuleId, []);
    incoming.get(edge.toModuleId).push(edge);
  }

  const moved = new Map();

  // Topological order guarantees a predecessor is finalised before any module
  // that reads its dates, so a single pass settles the whole chain.
  for (const id of topologicalOrder([...byId.keys()], dependencies)) {
    if (!affected.has(id)) continue;

    const module = byId.get(id);
    // Calendar span drives the finish-anchored rules, which convert an end
    // date back into a start date over real dates.
    const calendarSpan = diffDays(module.startDate, module.endDate);
    // Working span is what actually gets preserved when the bar moves: the
    // amount of work does not change just because it slid across a weekend.
    const workingSpan = workingDaysBetween(module.startDate, module.endDate);

    let required = null;
    for (const edge of incoming.get(id) ?? []) {
      const predecessor = byId.get(edge.fromModuleId);
      if (!predecessor) continue;
      const candidate = earliestStartFor(edge, predecessor, calendarSpan);
      required = required === null ? candidate : maxIso(required, candidate);
    }

    if (required === null || required <= module.startDate) continue;

    // `required` is already a working day; re-derive the end so a bar pushed
    // over a Thursday keeps the same number of working days.
    module.startDate = required;
    module.endDate = addWorkingDays(required, Math.max(0, workingSpan - 1));
    moved.set(id, { startDate: module.startDate, endDate: module.endDate });
  }

  return moved;
}

/**
 * Dependency constraints that the current dates violate — surfaced in the UI so
 * a PM can see conflicts without the app silently rearranging their plan.
 */
export function findViolations(modules, dependencies) {
  const byId = new Map(modules.map((m) => [m.id, m]));
  const violations = [];

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
