import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.join(__dirname, '..', 'db', 'schema.sql');

let pool = null;

export const dbEnabled = () => pool !== null;

// The game works without a database. If DATABASE_URL is set, we connect,
// apply the schema, and start recording matches.
export async function initDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log('[db] DATABASE_URL not set, running without match history');
    return;
  }
  const candidate = new pg.Pool({ connectionString: url, max: 5 });
  candidate.on('error', (err) => console.error('[db] idle client error', err.message));

  const schema = await fs.readFile(SCHEMA_PATH, 'utf8');
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await candidate.query(schema);
      pool = candidate;
      console.log('[db] connected, schema ready');
      return;
    } catch (err) {
      console.warn(`[db] connect attempt ${attempt} failed: ${err.message}`);
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  console.error('[db] giving up, running without match history');
  await candidate.end().catch(() => {});
}

export async function saveMatch(roomCode, startedAt, results) {
  if (!pool || results.length === 0) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'INSERT INTO matches (room_code, started_at, player_count) VALUES ($1, $2, $3) RETURNING id',
      [roomCode, startedAt, results.length],
    );
    const matchId = rows[0].id;
    for (const r of results) {
      await client.query(
        `INSERT INTO match_players (match_id, name, score, hits, catches, outs, placement)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [matchId, r.name, r.score, r.hits, r.catches, r.outs, r.placement],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[db] failed to save match', err.message);
  } finally {
    client.release();
  }
}

export async function getLeaderboard(limit = 10) {
  if (!pool) return [];
  const { rows } = await pool.query(
    `SELECT MIN(name) AS name,
            SUM(hits)::int AS hits,
            SUM(catches)::int AS catches,
            COUNT(*)::int AS matches,
            COUNT(*) FILTER (WHERE placement = 1)::int AS wins
       FROM match_players
      GROUP BY lower(name)
      ORDER BY hits DESC, wins DESC
      LIMIT $1`,
    [limit],
  );
  return rows;
}

export async function closeDb() {
  if (pool) await pool.end();
}
