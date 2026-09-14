-- Observed band activity from Mission Control's WSJT-X decode relay.
-- This table already exists in the live solar-history D1 database (created
-- directly against production while wiring up the Mission Control side of
-- this integration), but had no migration file recording it — this adds
-- that file so a fresh database built from migrations matches production,
-- and so `wrangler d1 migrations apply` doesn't try to recreate it.

CREATE TABLE IF NOT EXISTS band_activity_history (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at    TEXT NOT NULL,       -- when this cron run wrote the row
  band           TEXT NOT NULL,
  window_start   TEXT NOT NULL,       -- start of the 15-min window, from Mission Control
  window_minutes INTEGER NOT NULL DEFAULT 15,
  decode_count   INTEGER NOT NULL DEFAULT 0,
  unique_calls   INTEGER NOT NULL DEFAULT 0,
  best_snr       INTEGER,
  grids          TEXT                 -- JSON array of grid squares seen, as a string
);

CREATE INDEX IF NOT EXISTS idx_band_activity_recorded ON band_activity_history (recorded_at);
CREATE INDEX IF NOT EXISTS idx_band_activity_band_window ON band_activity_history (band, window_start);
