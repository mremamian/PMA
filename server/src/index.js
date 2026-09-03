import express from 'express';
import cors from 'cors';

import { assertConnection, closePool, query } from './db/pool.js';
import { errorHandler, notFoundHandler, asyncHandler } from './lib/http.js';
import { todayIso } from './lib/dates.js';
import { projectsRouter } from './routes/projects.js';
import { teamsRouter } from './routes/teams.js';
import { projectTeamsRouter } from './routes/project-teams.js';
import { projectModulesRouter, modulesRouter } from './routes/modules.js';
import { projectDependenciesRouter, dependenciesRouter } from './routes/dependencies.js';
import { usersRouter } from './routes/users.js';
import { reportsRouter } from './routes/reports.js';

const PORT = Number(process.env.PORT ?? 3000);

const allowedOrigins = (process.env.CORS_ORIGIN ?? 'http://localhost:4200')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

export const app = express();

app.disable('x-powered-by');
app.use(
  cors({
    // No Origin header means a same-origin or non-browser caller (curl, tests).
    origin: (origin, callback) =>
      !origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')
        ? callback(null, true)
        : callback(new Error(`Origin ${origin} is not allowed by CORS.`)),
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/', (req, res) => {
  res.json({
    name: 'Product Manager Assistant API',
    version: '1.0.0',
    today: todayIso(),
    endpoints: [
      'GET    /api/health',
      'GET    /api/projects',
      'POST   /api/projects',
      'GET    /api/projects/:projectId',
      'PATCH  /api/projects/:projectId',
      'DELETE /api/projects/:projectId',
      'GET    /api/projects/:projectId/board',
      'GET    /api/projects/:projectId/teams',
      'PUT    /api/projects/:projectId/teams',
      'POST   /api/projects/:projectId/teams/reorder',
      'DELETE /api/projects/:projectId/teams/:teamId?force=true',
      'GET    /api/teams',
      'POST   /api/teams',
      'POST   /api/teams/reorder',
      'GET    /api/teams/:teamId',
      'PATCH  /api/teams/:teamId',
      'DELETE /api/teams/:teamId',
      'GET    /api/projects/:projectId/modules',
      'POST   /api/projects/:projectId/modules',
      'GET    /api/modules/:moduleId',
      'PATCH  /api/modules/:moduleId?cascade=true',
      'DELETE /api/modules/:moduleId',
      'GET    /api/projects/:projectId/dependencies',
      'POST   /api/projects/:projectId/dependencies',
      'PATCH  /api/dependencies/:dependencyId',
      'DELETE /api/dependencies/:dependencyId',
      'GET    /api/users',
      'POST   /api/users',
      'GET    /api/users/:userId',
      'PATCH  /api/users/:userId',
      'DELETE /api/users/:userId',
      'GET    /api/reports/workload?from=&to=',
    ],
  });
});

app.get(
  '/api/health',
  asyncHandler(async (req, res) => {
    await query('SELECT 1');
    res.json({ status: 'ok', database: 'up', today: todayIso() });
  }),
);

// Project-scoped collections. The teams router here manages *connections* to
// teams in the shared registry; it never creates one.
app.use('/api/projects/:projectId/teams', projectTeamsRouter);
app.use('/api/projects/:projectId/modules', projectModulesRouter);
app.use('/api/projects/:projectId/dependencies', projectDependenciesRouter);
app.use('/api/projects', projectsRouter);

// Addressed directly by id.
app.use('/api/teams', teamsRouter);
app.use('/api/modules', modulesRouter);
app.use('/api/dependencies', dependenciesRouter);

// Global people directory, not scoped to a project.
app.use('/api/users', usersRouter);

// Cross-project reporting.
app.use('/api/reports', reportsRouter);

app.use(notFoundHandler);
app.use(errorHandler);

async function start() {
  try {
    const info = await assertConnection();
    console.log(`[db] connected to "${info.db}"`);
  } catch (err) {
    console.error('\n[db] could not connect to PostgreSQL:', err.message);
    console.error('     Check server/.env, then run: npm run migrate && npm run seed');
    console.error('     To start PostgreSQL with Docker: docker compose up -d\n');
    process.exit(1);
  }

  const server = app.listen(PORT, () => {
    console.log(`[api] listening on http://localhost:${PORT}`);
    console.log(`[api] CORS origins: ${allowedOrigins.join(', ')}`);
  });

  const shutdown = async (signal) => {
    console.log(`\n[api] ${signal} received, shutting down`);
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    // Don't let an in-flight request hold the process open indefinitely.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start();
