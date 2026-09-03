-- Teams become first-class entities of their own, shared by every project.
--
-- Until now a team was a row belonging to one project, so "Squad A" in two
-- programmes were two unrelated records. A team is really an organisational
-- unit that outlives any single project, and every chart should be able to
-- show every team — so `project_id` goes away and modules reference the team
-- directly.
--
-- Consequences this migration has to deal with:
--   * Teams that were per-project may now collide by name; equal names are
--     merged into one canonical team and their modules repointed.
--   * `collapsed` was stored per team. On a global team it would leak between
--     projects — collapsing a row in one chart would collapse it in all of
--     them — so it moves to the client as a per-project view preference.
--   * `sort_order` becomes one global ordering shared by every chart.

-- One canonical team per name; the oldest wins.
CREATE TEMP TABLE team_merge ON COMMIT DROP AS
SELECT t.id AS old_id,
       first_value(t.id) OVER (
         PARTITION BY lower(btrim(t.name))
         ORDER BY t.created_at, t.id
       ) AS new_id
FROM teams t;

-- The composite FK pins a module's team to the module's project; it has to go
-- before the duplicates can be repointed across project boundaries.
ALTER TABLE modules DROP CONSTRAINT IF EXISTS modules_team_in_same_project;

UPDATE modules m
SET team_id = tm.new_id
FROM team_merge tm
WHERE m.team_id = tm.old_id AND m.team_id <> tm.new_id;

UPDATE users u
SET team_id = tm.new_id
FROM team_merge tm
WHERE u.team_id = tm.old_id AND u.team_id <> tm.new_id;

DELETE FROM teams
WHERE id IN (SELECT old_id FROM team_merge WHERE old_id <> new_id);

-- Detach teams from projects.
ALTER TABLE teams DROP CONSTRAINT IF EXISTS teams_id_project_key;
DROP INDEX IF EXISTS teams_project_order_idx;
ALTER TABLE teams DROP COLUMN IF EXISTS project_id;
ALTER TABLE teams DROP COLUMN IF EXISTS collapsed;

-- A module still belongs to a project, but its team is now global.
ALTER TABLE modules
  ADD CONSTRAINT modules_team_fk
  FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE CASCADE;

-- Names identify a team now, so stop two from sharing one.
CREATE UNIQUE INDEX IF NOT EXISTS teams_name_key ON teams (lower(btrim(name)));

-- Re-number into a single gap-free ordering.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY sort_order, created_at) - 1 AS position
  FROM teams
)
UPDATE teams t
SET sort_order = ordered.position
FROM ordered
WHERE t.id = ordered.id;

CREATE INDEX IF NOT EXISTS teams_order_idx ON teams (sort_order, created_at);
