PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  email_time TEXT DEFAULT '07:00',
  timezone TEXT DEFAULT 'Europe/Berlin',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  website TEXT NOT NULL,
  pricing_page TEXT,
  careers_page TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS scrapes (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL,
  url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  extracted_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scrapes_competitor_type_time
  ON scrapes(competitor_id, source_type, extracted_at DESC);

CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  signal_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  before_scrape_id TEXT REFERENCES scrapes(id),
  after_scrape_id TEXT REFERENCES scrapes(id),
  source_url TEXT,
  confidence REAL DEFAULT 0.5,
  detected_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_signals_competitor_time
  ON signals(competitor_id, detected_at DESC);

CREATE TABLE IF NOT EXISTS briefs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_line TEXT NOT NULL,
  html_content TEXT NOT NULL,
  analysis_json TEXT NOT NULL,
  signal_ids TEXT NOT NULL,
  threat_level INTEGER,
  sent_at TEXT,
  resend_message_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_briefs_user_time
  ON briefs(user_id, created_at DESC);
