-- Applied automatically by the server on startup (idempotent).

CREATE TABLE IF NOT EXISTS matches (
  id           SERIAL PRIMARY KEY,
  room_code    TEXT        NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  ended_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  player_count INTEGER     NOT NULL
);

CREATE TABLE IF NOT EXISTS match_players (
  id        SERIAL PRIMARY KEY,
  match_id  INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  name      TEXT    NOT NULL,
  score     INTEGER NOT NULL DEFAULT 0,
  hits      INTEGER NOT NULL DEFAULT 0,
  catches   INTEGER NOT NULL DEFAULT 0,
  outs      INTEGER NOT NULL DEFAULT 0,
  placement INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS match_players_name_idx ON match_players (lower(name));
