-- People directory, and the link from a module to the person doing it.
--
-- Users are global rather than per-project: the same person shows up across
-- programmes, and re-entering them per project would be busywork. `team_id`
-- is their home team — a row in some project — and is nullable so a person can
-- exist before they are placed, and survive their team being deleted.

CREATE TABLE IF NOT EXISTS users (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL CHECK (length(btrim(name)) > 0),
  email        text,
  -- Job title, e.g. "Backend Engineer". Distinct from `team_id`.
  title        text NOT NULL DEFAULT '',
  team_id      uuid REFERENCES teams(id) ON DELETE SET NULL,
  -- Optional picture; when absent the UI draws initials on `avatar_color`.
  avatar_url   text,
  avatar_color text NOT NULL DEFAULT '#6366f1',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness, but only for users who have an email at all.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key
  ON users (lower(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS users_team_idx ON users (team_id);

DROP TRIGGER IF EXISTS users_set_updated_at ON users;
CREATE TRIGGER users_set_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- A module is assigned to at most one person. Deleting a person unassigns
-- their work rather than deleting it.
ALTER TABLE modules
  ADD COLUMN IF NOT EXISTS assignee_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS modules_assignee_idx ON modules (assignee_id);

-- Replaces the free-text `owner` column, which held a name with nothing behind
-- it. Anything already there is carried into the directory first so no
-- attribution is lost, then matched back onto the modules.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'modules' AND column_name = 'owner'
  ) THEN
    INSERT INTO users (name)
    SELECT DISTINCT btrim(owner)
    FROM modules
    WHERE btrim(coalesce(owner, '')) <> ''
      AND NOT EXISTS (
        SELECT 1 FROM users u WHERE lower(u.name) = lower(btrim(modules.owner))
      );

    UPDATE modules m
    SET assignee_id = u.id
    FROM users u
    WHERE m.assignee_id IS NULL
      AND btrim(coalesce(m.owner, '')) <> ''
      AND lower(u.name) = lower(btrim(m.owner));

    ALTER TABLE modules DROP COLUMN owner;
  END IF;
END
$$;
