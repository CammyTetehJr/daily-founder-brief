import Database from "better-sqlite3";
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

const DB_PATH = join(process.cwd(), "data", "app.db");
const SCHEMA_PATH = join(process.cwd(), "schema.sql");

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  if (!existsSync(dirname(DB_PATH))) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const schema = readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(schema);

  _db = db;
  return db;
}

export type User = {
  id: string;
  email: string;
  email_time: string;
  timezone: string;
  created_at: string;
};

export type Competitor = {
  id: string;
  user_id: string;
  name: string;
  website: string;
  pricing_page: string | null;
  careers_page: string | null;
  created_at: string;
};

export type SourceType = "homepage" | "pricing" | "careers" | "news" | "github";

export type Scrape = {
  id: string;
  competitor_id: string;
  source_type: SourceType;
  url: string;
  content_hash: string;
  raw_content: string;
  extracted_at: string;
};

export type SignalType = "pricing" | "hiring" | "feature" | "news" | "messaging";

export type Signal = {
  id: string;
  competitor_id: string;
  signal_type: SignalType;
  summary: string;
  before_scrape_id: string | null;
  after_scrape_id: string | null;
  source_url: string | null;
  confidence: number;
  detected_at: string;
};

export type Brief = {
  id: string;
  user_id: string;
  subject_line: string;
  html_content: string;
  analysis_json: string;
  signal_ids: string;
  threat_level: number | null;
  sent_at: string | null;
  resend_message_id: string | null;
  created_at: string;
};
