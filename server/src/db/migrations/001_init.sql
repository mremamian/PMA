-- Product Manager Assistant — schema
--
-- Date policy: every calendar field is a `date` (no time, no timezone). Dates
-- are stored as Gregorian and converted to Jalali/Shamsi for display in the
-- Angular client, so sorting, range queries and arithmetic all stay correct.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Keeps updated_at honest without every caller remembering to set it.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------- projects --
CREATE TABLE IF NOT EXISTS projects (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('planning', 'active', 'on_hold', 'done', 'archived')),
  color       text NOT NULL DEFAULT '#6366f1',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT projects_date_order CHECK (end_date >= start_date)
);

DROP TRIGGER IF EXISTS projects_set_updated_at ON projects;
CREATE TRIGGER projects_set_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------------- teams --
-- A "team" is one row of the Gantt chart. `kind = 'external'` marks the
-- cross-cutting rows (finance, procurement, core banking, ...) that other
-- teams' modules depend on before they can start.
CREATE TABLE IF NOT EXISTS teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(btrim(name)) > 0),
  kind       text NOT NULL DEFAULT 'team' CHECK (kind IN ('team', 'external')),
  color      text NOT NULL DEFAULT '#93c5fd',
  sort_order integer NOT NULL DEFAULT 0,
  collapsed  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Lets modules reference (team_id, project_id) as a unit, which makes it
  -- impossible to attach a module to a team from a different project.
  CONSTRAINT teams_id_project_key UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS teams_project_order_idx ON teams (project_id, sort_order, created_at);

DROP TRIGGER IF EXISTS teams_set_updated_at ON teams;
CREATE TRIGGER teams_set_updated_at BEFORE UPDATE ON teams
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ----------------------------------------------------------------- modules --
-- One bar on the chart. `kind = 'milestone'` renders as a diamond marker and
-- always has start_date = end_date.
CREATE TABLE IF NOT EXISTS modules (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  team_id     uuid NOT NULL,
  name        text NOT NULL CHECK (length(btrim(name)) > 0),
  description text NOT NULL DEFAULT '',
  start_date  date NOT NULL,
  end_date    date NOT NULL,
  progress    integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  kind        text NOT NULL DEFAULT 'task' CHECK (kind IN ('task', 'milestone')),
  status      text NOT NULL DEFAULT 'planned'
              CHECK (status IN ('planned', 'in_progress', 'blocked', 'done')),
  owner       text NOT NULL DEFAULT '',
  color       text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT modules_date_order CHECK (end_date >= start_date),
  CONSTRAINT modules_milestone_is_single_day
    CHECK (kind <> 'milestone' OR start_date = end_date),
  CONSTRAINT modules_team_in_same_project
    FOREIGN KEY (team_id, project_id) REFERENCES teams (id, project_id) ON DELETE CASCADE,
  -- Same trick as teams: dependencies reference (module_id, project_id).
  CONSTRAINT modules_id_project_key UNIQUE (id, project_id)
);

CREATE INDEX IF NOT EXISTS modules_project_idx ON modules (project_id);
CREATE INDEX IF NOT EXISTS modules_team_order_idx ON modules (team_id, sort_order, start_date);

DROP TRIGGER IF EXISTS modules_set_updated_at ON modules;
CREATE TRIGGER modules_set_updated_at BEFORE UPDATE ON modules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ------------------------------------------------------------ dependencies --
-- `from_module_id` must satisfy its constraint before `to_module_id` can run.
-- Drawn on the chart as an arrow from the predecessor to the successor.
CREATE TABLE IF NOT EXISTS dependencies (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_module_id uuid NOT NULL,
  to_module_id   uuid NOT NULL,
  -- FS finish-to-start, SS start-to-start, FF finish-to-finish, SF start-to-finish.
  type           text NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'SS', 'FF', 'SF')),
  lag_days       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dependencies_no_self_link CHECK (from_module_id <> to_module_id),
  CONSTRAINT dependencies_unique_edge UNIQUE (from_module_id, to_module_id),
  CONSTRAINT dependencies_from_in_project
    FOREIGN KEY (from_module_id, project_id) REFERENCES modules (id, project_id) ON DELETE CASCADE,
  CONSTRAINT dependencies_to_in_project
    FOREIGN KEY (to_module_id, project_id) REFERENCES modules (id, project_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS dependencies_project_idx ON dependencies (project_id);
CREATE INDEX IF NOT EXISTS dependencies_to_idx ON dependencies (to_module_id);
