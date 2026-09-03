-- Projects reference existing teams instead of owning their own.
--
-- Migration 003 made teams global and had every chart show every team. That
-- removed duplicate team records but left two problems: there was no way to
-- say "this programme involves these teams", and the only way to get a row
-- onto a chart was to create another team entity from inside the project.
--
-- This join table is the connection. A project's rows are now teams *picked*
-- from the registry, creation happens once on the roster, and each project
-- gets its own row order rather than sharing one global ordering.

CREATE TABLE IF NOT EXISTS project_teams (
  project_id uuid NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  team_id    uuid NOT NULL REFERENCES teams (id) ON DELETE CASCADE,
  -- Row order within this project, independent of every other project.
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, team_id)
);

CREATE INDEX IF NOT EXISTS project_teams_order_idx
  ON project_teams (project_id, sort_order);

-- Preserve what is on screen today: every existing project keeps every team,
-- in the global order it was already using.
INSERT INTO project_teams (project_id, team_id, sort_order)
SELECT p.id, t.id, t.sort_order
FROM projects p
CROSS JOIN teams t
ON CONFLICT DO NOTHING;

-- A module may only sit in a team its project actually involves. Without this
-- the link table would be advisory and a module could reference a team the
-- project has since dropped.
--
-- No cascade: unlinking a team that still holds work must fail loudly rather
-- than quietly deleting modules. The API checks first and offers `?force=true`,
-- which removes the modules before unlinking.
ALTER TABLE modules
  DROP CONSTRAINT IF EXISTS modules_team_in_project;

ALTER TABLE modules
  ADD CONSTRAINT modules_team_in_project
  FOREIGN KEY (project_id, team_id)
  REFERENCES project_teams (project_id, team_id)
  ON DELETE RESTRICT;
