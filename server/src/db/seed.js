import { fileURLToPath } from 'node:url';
import { pool, closePool, withTransaction } from './pool.js';
import { addDays, todayIso } from '../lib/dates.js';

/**
 * Demo data for the payments programme shown in the design reference.
 *
 * Teams and people are workspace-wide, so they are seeded once and shared by
 * both projects — which is also what makes the second project show the same
 * rows as the first, some of them empty.
 *
 * Every date is expressed as a day offset from the project start, and the
 * project is anchored so that "today" lands ~58% of the way through. That
 * keeps the today marker in a useful place on the chart whenever the seed is
 * run, instead of drifting off-screen as hard-coded dates age.
 *
 * Avatars are colour + initials rather than image URLs so the demo has no
 * external dependencies and renders the same offline.
 */
const DAYS_BEFORE_TODAY = 150;
const PROJECT_LENGTH_DAYS = 260;

/** Global rows, in the order they appear on every chart. */
const TEAMS = [
  { name: 'Governance & Approvals', kind: 'team', color: '#d8b4fe' },
  { name: 'UX & Design', kind: 'team', color: '#f9a8d4' },
  // The cross-cutting row: work owned by other departments that squads have to
  // wait on before they can start.
  { name: 'Dependencies (Finance, Procurement, Core Banking)', kind: 'external', color: '#fde047' },
  { name: 'Squad A', kind: 'team', color: '#93c5fd' },
  { name: 'Squad B', kind: 'team', color: '#86efac' },
  { name: 'Web Squad', kind: 'team', color: '#a5b4fc' },
];

/** Global directory. `team` names one of the rows above. */
const PEOPLE = [
  { key: 'nima', name: 'Nima Rasouli', title: 'Delivery Lead', team: 'Governance & Approvals', color: '#a855f7' },
  { key: 'sara', name: 'Sara Ahmadi', title: 'Product Designer', team: 'UX & Design', color: '#ec4899' },
  { key: 'mohammad', name: 'Mohammad Ebrahimi', title: 'Backend Engineer', team: 'Squad A', color: '#3b82f6' },
  { key: 'maryam', name: 'Maryam Tehrani', title: 'QA Lead', team: 'Squad A', color: '#0ea5e9' },
  { key: 'leila', name: 'Leila Hosseini', title: 'Mobile Engineer', team: 'Squad B', color: '#10b981' },
  { key: 'reza', name: 'Reza Karimi', title: 'Core Banking Liaison', team: 'Dependencies (Finance, Procurement, Core Banking)', color: '#f59e0b' },
  { key: 'amir', name: 'Amir Nazari', title: 'Frontend Engineer', team: 'Web Squad', color: '#6366f1' },
];

const PAYMENTS_PROJECT = {
  name: 'Digital Payments Platform',
  description:
    'Cross-squad programme delivering the new payment orchestration service, mobile payment flow and phased go-live.',
  status: 'active',
  color: '#6366f1',
  lengthDays: PROJECT_LENGTH_DAYS,
  startsDaysAgo: DAYS_BEFORE_TODAY,
  // `team` names a global row; `assignee` names someone in PEOPLE.
  modules: [
    { key: 'arch-review', team: 'Governance & Approvals', name: 'Architecture Review & Approval', kind: 'milestone', at: 55, status: 'done', progress: 100, assignee: 'nima' },
    { key: 'uat', team: 'Governance & Approvals', name: 'User Acceptance Testing (UAT)', from: 201, to: 232, assignee: 'maryam' },
    { key: 'cab', team: 'Governance & Approvals', name: 'CAB Submission & Approval', kind: 'milestone', at: 240, assignee: 'nima' },
    { key: 'go-live', team: 'Governance & Approvals', name: 'Go-Live (Phased Rollout)', kind: 'milestone', at: 250, assignee: 'nima' },

    { key: 'research', team: 'UX & Design', name: 'User Research & Journey Mapping', from: 0, to: 20, status: 'done', progress: 100, assignee: 'sara' },
    { key: 'wireframes', team: 'UX & Design', name: 'Wireframing & Prototyping', from: 21, to: 45, status: 'done', progress: 100, assignee: 'sara' },
    { key: 'final-ui', team: 'UX & Design', name: 'Final UI & Design System Components', from: 70, to: 92, status: 'done', progress: 100, assignee: 'sara' },

    { key: 'cb-contract', team: 'Dependencies (Finance, Procurement, Core Banking)', name: 'Core Banking: Finalize API Contract', from: 14, to: 45, status: 'done', progress: 100, assignee: 'reza' },
    { key: 'cb-fx', team: 'Dependencies (Finance, Procurement, Core Banking)', name: 'Core Banking: FX & Compliance API Dev', from: 46, to: 118, status: 'done', progress: 100, assignee: 'reza' },
    { key: 'card-fee', team: 'Dependencies (Finance, Procurement, Core Banking)', name: 'Card Services: Fee Adjustment', from: 119, to: 160, status: 'in_progress', progress: 70, assignee: 'reza' },
    { key: 'perf-signoff', team: 'Dependencies (Finance, Procurement, Core Banking)', name: 'Performance Testing Sign-off', kind: 'milestone', at: 235, assignee: 'maryam' },

    { key: 'discovery', team: 'Squad A', name: 'Discovery & Solutioning', from: 0, to: 34, status: 'done', progress: 100, assignee: 'nima' },
    { key: 'backend', team: 'Squad A', name: 'Backend: Payment Orchestration Service', from: 70, to: 140, status: 'done', progress: 100, assignee: 'mohammad' },
    { key: 'integration', team: 'Squad A', name: 'Integration with Mobile App', from: 141, to: 175, status: 'in_progress', progress: 30, assignee: 'mohammad' },
    { key: 'sit', team: 'Squad A', name: 'System Integration Testing (SIT)', from: 176, to: 200, assignee: 'maryam' },

    { key: 'mobile-ui', team: 'Squad B', name: 'Mobile UI/UX: Payment Flow', from: 93, to: 175, status: 'in_progress', progress: 65, assignee: 'leila' },
  ],
  // [predecessor, successor] — must finish before the next can start.
  dependencies: [
    ['discovery', 'arch-review'],
    ['arch-review', 'backend'],
    ['wireframes', 'final-ui'],
    ['final-ui', 'mobile-ui'],
    ['cb-contract', 'cb-fx'],
    ['cb-fx', 'card-fee'],
    ['cb-fx', 'integration'],
    ['backend', 'integration'],
    ['integration', 'sit'],
    ['mobile-ui', 'sit'],
    ['card-fee', 'sit'],
    ['sit', 'uat'],
    ['uat', 'cab'],
    ['perf-signoff', 'cab'],
    ['cab', 'go-live'],
  ],
};

const PORTAL_PROJECT = {
  name: 'Customer Portal Redesign',
  description: 'Refresh of the self-service portal: new design system, account overview and statements.',
  status: 'planning',
  color: '#0ea5e9',
  lengthDays: 140,
  startsDaysAgo: 20,
  modules: [
    { key: 'audit', team: 'Web Squad', name: 'Design System Audit', from: 0, to: 21, assignee: 'amir' },
    { key: 'account-overview', team: 'Web Squad', name: 'Account Overview Rebuild', from: 22, to: 75, assignee: 'amir' },
    { key: 'statements', team: 'Web Squad', name: 'Statements & Downloads', from: 76, to: 120, assignee: 'amir' },
    { key: 'legal', team: 'Dependencies (Finance, Procurement, Core Banking)', name: 'Legal: Terms & Consent Copy', from: 10, to: 40, assignee: 'reza' },
  ],
  dependencies: [
    ['audit', 'account-overview'],
    ['account-overview', 'statements'],
    ['legal', 'statements'],
  ],
};

async function seedProject(client, blueprint, teamIds, userIds) {
  const projectStart = addDays(todayIso(), -blueprint.startsDaysAgo);

  const { rows: projectRows } = await client.query(
    `INSERT INTO projects (name, description, start_date, end_date, status, color)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name`,
    [
      blueprint.name,
      blueprint.description,
      projectStart,
      addDays(projectStart, blueprint.lengthDays),
      blueprint.status,
      blueprint.color,
    ],
  );
  const project = projectRows[0];

  // key -> module id, so the dependency list can be written in readable terms.
  const moduleIds = new Map();

  for (const [index, module] of blueprint.modules.entries()) {
    const isMilestone = module.kind === 'milestone';
    const startOffset = isMilestone ? module.at : module.from;
    const endOffset = isMilestone ? module.at : module.to;

    const { rows } = await client.query(
      `INSERT INTO modules
         (project_id, team_id, name, start_date, end_date, progress, kind, status, assignee_id, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [
        project.id,
        teamIds.get(module.team),
        module.name,
        addDays(projectStart, startOffset),
        addDays(projectStart, endOffset),
        module.progress ?? 0,
        module.kind ?? 'task',
        module.status ?? 'planned',
        module.assignee ? (userIds.get(module.assignee) ?? null) : null,
        index,
      ],
    );

    moduleIds.set(module.key, rows[0].id);
  }

  for (const [from, to] of blueprint.dependencies) {
    await client.query(
      `INSERT INTO dependencies (project_id, from_module_id, to_module_id, type, lag_days)
       VALUES ($1, $2, $3, 'FS', 0)`,
      [project.id, moduleIds.get(from), moduleIds.get(to)],
    );
  }

  const rowsUsed = new Set(blueprint.modules.map((m) => m.team)).size;
  return { name: project.name, modules: moduleIds.size, rowsUsed };
}

export async function seed({ force = false } = {}) {
  const { rows } = await pool.query('SELECT count(*) AS count FROM projects');

  if (rows[0].count > 0 && !force) {
    console.log(
      `[seed] skipped — the database already holds ${rows[0].count} project(s). Re-run with --force to replace them.`,
    );
    return;
  }

  await withTransaction(async (client) => {
    if (force) {
      // Teams and users are workspace-wide, so the project cascade does not
      // sweep them away; clear them explicitly.
      await client.query('DELETE FROM projects');
      await client.query('DELETE FROM users');
      await client.query('DELETE FROM teams');
      console.log('[seed] cleared existing projects, teams and people');
    }

    const teamIds = new Map();
    for (const [index, team] of TEAMS.entries()) {
      const { rows: created } = await client.query(
        `INSERT INTO teams (name, kind, color, sort_order)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [team.name, team.kind, team.color, index],
      );
      teamIds.set(team.name, created[0].id);
    }
    console.log(`[seed] ${TEAMS.length} shared teams`);

    const userIds = new Map();
    for (const person of PEOPLE) {
      const { rows: created } = await client.query(
        `INSERT INTO users (name, title, team_id, avatar_color)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [person.name, person.title, teamIds.get(person.team) ?? null, person.color],
      );
      userIds.set(person.key, created[0].id);
    }
    console.log(`[seed] ${PEOPLE.length} people`);

    for (const blueprint of [PAYMENTS_PROJECT, PORTAL_PROJECT]) {
      const result = await seedProject(client, blueprint, teamIds, userIds);
      console.log(
        `[seed] "${result.name}" — ${result.modules} modules across ${result.rowsUsed} of ${TEAMS.length} rows`,
      );
    }
  });

  console.log('[seed] done');
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const force = process.argv.includes('--force');
  try {
    await seed({ force });
  } catch (err) {
    console.error('[seed] failed:', err.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
