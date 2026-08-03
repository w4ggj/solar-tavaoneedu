CREATE TABLE IF NOT EXISTS solar_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  recorded_at TEXT NOT NULL,
  sfi         REAL,
  a_index     REAL,
  k_index     REAL,
  xray_flux   REAL,
  xray_class  TEXT,
  source      TEXT DEFAULT 'noaa'
);

CREATE INDEX IF NOT EXISTS idx_solar_history_recorded_at ON solar_history (recorded_at);
