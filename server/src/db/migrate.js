import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, closePool } from './pool.js';

const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));

/** Child tables first so the drop order is explicit rather than implied. */
const DROP_ORDER = ['dependencies', 'modules', 'users', 'teams', 'projects', 'schema_migrations'];

/**
 * Applies any migration file that has not run yet, in filename order.
 *
 * Each file runs inside its own transaction and is recorded on success, so an
 * interrupted run leaves the database on a whole migration rather than half of
 * one. Files are never edited after they ship — a change is a new file.
 */
export async function migrate({ drop = false } = {}) {
  const client = await pool.connect();

  try {
    if (drop) {
      for (const table of DROP_ORDER) {
        await client.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      }
      console.log(`[migrate] dropped: ${DROP_ORDER.join(', ')}`);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((row) => row.version));

    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();
    let count = 0;

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) continue;

      // join(), not a file:// URL — a Windows path like E:\… is not a valid URL base.
      const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`migration ${version} failed: ${err.message}`, { cause: err });
      }

      console.log(`[migrate] applied ${version}`);
      count += 1;
    }

    console.log(
      count === 0
        ? `[migrate] up to date (${files.length} migration${files.length === 1 ? '' : 's'})`
        : `[migrate] ${count} migration${count === 1 ? '' : 's'} applied`,
    );
  } finally {
    client.release();
  }
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);

if (isMain) {
  const drop = process.argv.includes('--drop');
  try {
    await migrate({ drop });
  } catch (err) {
    console.error('[migrate] failed:', err.message);
    process.exitCode = 1;
  } finally {
    await closePool();
  }
}
