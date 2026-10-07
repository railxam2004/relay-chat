import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { PGlite } from '@electric-sql/pglite';

export async function createDb(config) {
  let db;
  if (config.dbDriver === 'postgres') {
    if (!config.databaseUrl) throw new Error('DB_DRIVER=postgres требует DATABASE_URL');
    const pool = new Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 10000 });
    pool.on('error', error => console.error('PostgreSQL pool:', error.message));
    db = {
      query: (sql, args = []) => pool.query(sql, args),
      tx: async fn => {
        const client = await pool.connect();
        try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
        catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      },
      close: () => pool.end(),
    };
  } else {
    const local = new PGlite(config.pgliteDir === ':memory:' ? undefined : config.pgliteDir);
    await local.waitReady;
    db = { query: (sql, args = []) => local.query(sql, args), tx: fn => local.transaction(fn), close: () => local.close() };
  }
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  // Serialize startup migrations on shared PostgreSQL instances. PGlite uses one process.
  await db.tx(async tx => {
    if (config.dbDriver === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(8147001)');
    for (const statement of schema.split(';').map(x => x.trim()).filter(Boolean)) await tx.query(statement);
  });
  return db;
}
