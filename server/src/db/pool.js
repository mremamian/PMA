import pg from 'pg';

const { Pool, types } = pg;

/**
 * PostgreSQL hands `date` columns back as JS `Date` objects built in the
 * server's local timezone, which shifts calendar days by one either side of
 * UTC. Every date in this app is a plain calendar day (a module starts *on*
 * 2026-06-22, not at some instant), so we keep them as `YYYY-MM-DD` strings
 * end to end and let the client do the Jalali conversion.
 */
types.setTypeParser(types.builtins.DATE, (value) => value);

/** `bigint`/`count(*)` arrives as a string; every count we run fits in a Number. */
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

function buildPoolConfig() {
  const ssl =
    process.env.PGSSLMODE && process.env.PGSSLMODE !== 'disable'
      ? { rejectUnauthorized: false }
      : false;

  if (process.env.DATABASE_URL) {
    return { connectionString: process.env.DATABASE_URL, ssl };
  }

  return {
    host: process.env.PGHOST ?? 'localhost',
    port: Number(process.env.PGPORT ?? 5432),
    user: process.env.PGUSER ?? 'pma',
    password: process.env.PGPASSWORD ?? 'pma_dev_password',
    database: process.env.PGDATABASE ?? 'pma',
    ssl,
  };
}

export const pool = new Pool({
  ...buildPoolConfig(),
  max: Number(process.env.PGPOOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

// A pooled client can die between checkouts (network blip, server restart).
// Without a listener this surfaces as an unhandled 'error' event and kills the
// process; pg discards the broken client for us, so logging is enough.
pool.on('error', (err) => {
  console.error('[db] idle client error:', err.message);
});

/** Run a single query on a pooled connection. */
export function query(text, params) {
  return pool.query(text, params);
}

/** Convenience: first row of a query, or `undefined`. */
export async function queryOne(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0];
}

/**
 * Run `fn` inside a transaction on a dedicated client, committing on success
 * and rolling back on any throw.
 */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      console.error('[db] rollback failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Verify the database is reachable; used at boot so failures are loud. */
export async function assertConnection() {
  const { rows } = await pool.query('SELECT current_database() AS db, version() AS version');
  return rows[0];
}

export async function closePool() {
  await pool.end();
}
