# Product Manager Assistant

Plan delivery programmes on a Gantt chart that runs on the **Jalali (Shamsi) calendar**.
Projects hold rows, rows hold modules, and modules depend on each other — including
on cross-cutting rows for finance, procurement and vendors that squads wait on
before they can start. Every module is assigned to a person from a shared
directory.

The interface is in **Persian and right-to-left**; the chart itself stays
left-to-right, because a timeline reads earliest-to-latest and mirroring it
would put the future on the left.

- **Backend** — Node.js 22+ / Express 5 / PostgreSQL 17 (`pg`, no ORM)
- **Frontend** — Angular 22, standalone components, signals, zoneless change detection
- **Calendar** — [`date-fns-jalali`](https://www.npmjs.com/package/date-fns-jalali) for all Shamsi arithmetic and month lengths
- **Type** — [Vazirmatn](https://github.com/rastikerdar/vazirmatn), self-hosted (see *Fonts* below)

---

## Quick start

```bash
npm run setup && npm run db:up && npm run migrate && npm run seed
```

Then run the two dev servers in separate terminals:

```bash
npm run dev:server
```

```bash
npm run dev:client
```

Open <http://localhost:4200>.

| Service        | URL / port                        |
| -------------- | --------------------------------- |
| Angular client | <http://localhost:4200>           |
| REST API       | <http://localhost:3001>           |
| PostgreSQL     | `localhost:5433` (db/user `pma`)  |

> Ports 5432 and 3000 were already taken on the machine this was set up on, so
> PostgreSQL is published on **5433** and the API listens on **3001**. Change
> them in `docker-compose.yml` and `server/.env` if you prefer the defaults.

### Without Docker

Create a database and user, then point `server/.env` at it (copy
`server/.env.example`). Everything else is the same — `npm run migrate`
creates the schema, `npm run seed` fills it with the demo programme.

---

## Dates: Gregorian in the database, Shamsi on screen

Every date column is a PostgreSQL `date` holding a **Gregorian** calendar day,
and the API speaks `YYYY-MM-DD`. Conversion to Jalali happens only in the
browser.

That split is deliberate. Storing Jalali strings would break `ORDER BY`,
`BETWEEN`, date arithmetic and every index the planner might use, and it would
bake a calendar choice into the data. Storing the canonical day and converting
at the edge keeps SQL correct and leaves room for a second calendar later.

Two details that are easy to get wrong and are handled explicitly:

- `pg` parses `date` columns into JS `Date` objects in the server's local
  timezone, which shifts days either side of UTC. `server/src/db/pool.js`
  registers a type parser so dates stay plain strings end to end.
- `new Date('2026-09-02')` parses as UTC midnight and lands on 1 September west
  of Greenwich. The client splits ISO strings by hand and builds dates at
  **local** midnight (`client/src/app/core/jalali.ts`).

The calendar layer has a self-check covering known reference dates (the 1357
revolution, Nowruz, leap-year Esfand 30), a 20,000-day round trip and a
15,000-day monotonicity walk:

```bash
npm run check:jalali
```

---

## Migrations

The schema is versioned under `server/src/db/migrations/`, applied in filename
order and recorded in a `schema_migrations` table. `npm run migrate` applies
whatever has not run yet; each file runs in its own transaction, so an
interrupted run leaves the database on a whole migration rather than half of
one. **Migration files are never edited after they ship** — a change is a new
file.

`npm run db:reset` drops everything and rebuilds from scratch. It destroys
data; `npm run migrate` does not.

---

## Teams

Teams are **workspace-wide entities** kept in one registry. A project does not
own teams — it **connects to** them through the `project_teams` table, and each
connected team is a row on that project's chart.

That split is the point: creating a team from inside a project is how you end
up with three separate "Mechanics" records. So the Gantt has a **picker over
the existing registry**, never a create form; making a genuinely new team is a
workspace-level act on the Teams page.

- **New projects start connected to every team**, in registry order. Starting
  empty would mean a blank chart and a mandatory setup step; removing rows you
  don't need is easier than remembering to add the ones you do.
- **Row order is per project.** `project_teams.sort_order` is independent for
  each project; the registry order is only the default for newly linked rows.
- **Removing a row detaches the team from that project only.** Its work
  elsewhere and the team record itself are untouched. Deleting the *team* (on
  the Teams page) is the workspace-wide act, and reports totals across every
  project.
- Both removal paths **refuse while modules exist** unless `force` is passed,
  and the UI states exactly how many modules would go before you confirm.
- **Collapsed rows are per project, and live on the client** — keyed
  `projectId:teamId` in `localStorage`, since a global flag would fold a team
  away on every other chart too.
- A module may only sit in a team its project is connected to; a composite
  foreign key on `(project_id, team_id)` enforces it rather than trusting the
  route.

## People

Users are **global**, like teams: the same person appears across programmes,
and re-entering them per project would be busywork. Each has a name, an
optional job title and email, and a **home team**.

When assigning a module, the picker shows **that row's team members only** —
they are nearly always who does the work. Two escape hatches stop the filter
being a trap: a team with no members yet falls back to the whole directory, and
whoever is already assigned is always listed even if they have since changed
teams, so opening the dialog can never silently drop an assignment. The module
dialog also has a checkbox to show everyone.

Avatars are a colour plus initials, with an optional picture URL. There is no
upload pipeline to run, nothing renders as a broken image if a URL rots (the
component falls back to initials on a load error), and the URL scheme is
restricted to http(s) server-side so a `javascript:` value can never reach an
`img src`.

Deleting a person **unassigns** their modules rather than deleting the work —
the foreign key is `ON DELETE SET NULL`, and the confirmation says how many
modules that affects.

---

## Fonts

Vazirmatn ships as an npm dependency, and one variable file (109 kB) covers
weights 100–900. It is served from `client/public/fonts/vazirmatn.woff2` rather
than a font CDN — Google Fonts is unreliable from Iran, and self-hosting also
works offline.

The upstream filename is `Vazirmatn[wght].woff2`. Square brackets are wildcard
syntax to shell globs and need percent-encoding in a URL, and both fail
*silently*, so the file is renamed on the way in:

```bash
npm run font:sync
```

Re-run that after upgrading the `vazirmatn` package.

---

## What the chart does

- **Opens on today.** Loading a board scrolls the timeline to the today marker
  rather than to the project's start date — a long plan would otherwise open on
  months of finished work.
- **Rows are teams.** Add, rename, recolour, reorder and delete them. A row
  marked *external* is the finance / procurement / vendor lane — work owned by
  someone else that modules depend on before they can start.
- **Bars are modules**, packed into as few stacked lanes as their dates allow so
  parallel work in one team stays readable. Each carries its assignee's avatar
  when there is room for one; hovering it shows the full name, title and team.
- **One click** on a bar opens its details and they stay open. The panel is also
  where reassigning happens, since that is the most common edit.
- **Drag to move, drag an edge to resize, drag the dot to link.** Every gesture
  is applied optimistically and reverted if the server rejects it.
- **Dependencies** support FS / SS / FF / SF with lag. Circular links are
  refused in the browser *and* by a recursive CTE in PostgreSQL.
- **Cascade** (on by default) pushes dependent modules forward when you move a
  bar, taking the maximum across all of a module's predecessors. It only ever
  moves work later — compacting a plan is a decision, not a side effect.
- **Conflicts** are detected live: a link whose successor starts too early is
  drawn as a red dashed arrow and counted in the header.
- **Keyboard**: focus a bar and use ←/→ to nudge it a day, Shift+←/→ to stretch
  it, Enter to open its editor.
- **Milestones** are zero-length modules, drawn as diamonds.
- Toggle the header between Persian and Latin script, and Persian and Latin
  numerals, from the top bar.

---

## Layout

```
PMA/
├─ docker-compose.yml         PostgreSQL 17 on host port 5433
├─ server/
│  └─ src/
│     ├─ index.js             Express app, CORS, graceful shutdown
│     ├─ db/
│     │  ├─ pool.js           pg pool, date type parsers, transaction helper
│     │  ├─ schema.sql        tables, constraints, updated_at triggers
│     │  ├─ migrate.js        applies schema.sql (`--drop` for a fresh start)
│     │  └─ seed.js           demo programme, anchored relative to today
│     ├─ lib/
│     │  ├─ scheduling.js     constraint maths, cascade, violation detection
│     │  ├─ validation.js     zod schemas
│     │  ├─ serialize.js      row → DTO mapping
│     │  ├─ dates.js          UTC-safe calendar-day helpers
│     │  └─ http.js           ApiError + PostgreSQL error translation
│     └─ routes/              projects, teams, modules, dependencies
└─ client/
   └─ src/app/
      ├─ core/
      │  ├─ jalali.ts         Shamsi conversion, formatting, parsing
      │  ├─ timeline.ts       day↔pixel mapping, Jalali tick bands
      │  ├─ scheduling.ts     client mirror of the constraint maths
      │  ├─ board.store.ts    signal store with optimistic writes
      │  ├─ api.service.ts    typed HTTP client
      │  └─ settings.store.ts view preferences, persisted
      ├─ shared/              modal, confirm dialog, Shamsi date input
      └─ features/
         ├─ projects/         list + create/edit dialog
         └─ gantt/            chart, page shell, editors
```

The constraint maths exists on both sides on purpose: the server is the
authority and re-checks every write, while the client copy is what makes a drag
show its conflict on the same frame instead of a round trip later.

---

## API

All responses are `{ "data": ... }`; errors are
`{ "error": { "message", "details?" } }`.

| Method   | Path                                       | Notes                                      |
| -------- | ------------------------------------------ | ------------------------------------------ |
| `GET`    | `/api/health`                              | liveness + database check                  |
| `GET`    | `/api/projects`                            | supports `?q=` and `?status=`              |
| `POST`   | `/api/projects`                            |                                            |
| `GET`    | `/api/projects/:id`                        | includes roll-up counts                    |
| `PATCH`  | `/api/projects/:id`                        |                                            |
| `DELETE` | `/api/projects/:id`                        | cascades to everything below it            |
| `GET`    | `/api/projects/:id/board`                  | **the Gantt payload** — one round trip     |
| `GET`    | `/api/projects/:id/modules`                | optional `?teamId=`                        |
| `POST`   | `/api/projects/:id/modules`                |                                            |
| `GET`    | `/api/modules/:id`                         |                                            |
| `PATCH`  | `/api/modules/:id`                         | `?cascade=true` pushes dependents; response carries `moved[]` |
| `DELETE` | `/api/modules/:id`                         |                                            |
| `GET`    | `/api/projects/:id/dependencies`           |                                            |
| `POST`   | `/api/projects/:id/dependencies`           | `409` if it would close a cycle            |
| `PATCH`  | `/api/dependencies/:id`                    | link type and lag                          |
| `DELETE` | `/api/dependencies/:id`                    |                                            |
| `GET`    | `/api/projects/:id/teams`                  | the teams this project is connected to     |
| `PUT`    | `/api/projects/:id/teams`                  | `{ teamIds }` — set the connected set; `?force=true` to drop teams that still hold modules |
| `POST`   | `/api/projects/:id/teams/reorder`          | row order for this project only            |
| `DELETE` | `/api/projects/:id/teams/:teamId`          | detach one row from this project; `?force=true` if it holds modules |
| `GET`    | `/api/teams`                               | the whole roster, with cross-project counts |
| `POST`   | `/api/teams`                               |                                            |
| `POST`   | `/api/teams/reorder`                       | `{ ids: [...] }` — one order for all charts |
| `GET`    | `/api/teams/:id`                           |                                            |
| `PATCH`  | `/api/teams/:id`                           |                                            |
| `DELETE` | `/api/teams/:id`                           | refuses a non-empty team unless `?force=true`; deletes its modules in **every** project |
| `GET`    | `/api/users`                               | supports `?q=`, `?teamId=`, `?unassigned=` |
| `POST`   | `/api/users`                               |                                            |
| `GET`    | `/api/users/:id`                           |                                            |
| `PATCH`  | `/api/users/:id`                           |                                            |
| `DELETE` | `/api/users/:id`                           | unassigns their modules, does not delete them |

### Integrity worth knowing about

`teams` and `modules` carry a `UNIQUE (id, project_id)`, and children reference
that pair rather than the bare id. A module therefore *cannot* be attached to a
team from a different project, and a dependency cannot span two projects — the
database rejects it rather than trusting the route to check.

---

## Notes and limits

- There is no authentication; this runs as a single-tenant local tool. Add auth
  before putting it anywhere shared.
- Cascade only pushes work later, never earlier, so a plan is never silently
  compacted.
- Reordering rows is one-position-at-a-time via the ↑/↓ controls; the API
  accepts a full reordering, so drag-to-reorder is a small addition.
- Only Friday is shaded as a weekend, matching the Iranian working week.
