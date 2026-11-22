// SQLite via sql.js (WebAssembly — no native build step, works on any OS).
// The database lives in memory and is flushed to data/spark.db after writes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import { PETS, STARTING_HAPPINESS } from './config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DB_FILE = process.env.DB_FILE || path.join(ROOT, 'data', 'spark.db');
const STUDENTS_FILE = path.join(ROOT, 'data', 'students.json');

let db;
let saveTimer = null;

export async function openDb() {
  const SQL = await initSqlJs();
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  db = fs.existsSync(DB_FILE) ? new SQL.Database(fs.readFileSync(DB_FILE)) : new SQL.Database();

  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      uid        TEXT PRIMARY KEY,           -- normalized NFC tag id
      name       TEXT NOT NULL,
      major      TEXT NOT NULL CHECK (major IN ('cs','ds')),
      demo       INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pets (
      id           TEXT PRIMARY KEY,
      happiness    REAL NOT NULL,
      happiness_at INTEGER NOT NULL           -- ms epoch the value was last written
    );
    CREATE TABLE IF NOT EXISTS events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      pet_id          TEXT NOT NULL,
      student_uid     TEXT NOT NULL,
      action          TEXT NOT NULL,
      points          INTEGER NOT NULL,
      happiness_delta REAL NOT NULL,
      device_id       TEXT,
      created_at      INTEGER NOT NULL,
      day             TEXT NOT NULL           -- YYYY-MM-DD in configured timezone
    );
    CREATE INDEX IF NOT EXISTS idx_events_pet_day ON events (pet_id, day);
    CREATE INDEX IF NOT EXISTS idx_events_student ON events (student_uid, action, created_at);
  `);

  const now = Date.now();
  for (const id of Object.keys(PETS)) {
    run('INSERT OR IGNORE INTO pets (id, happiness, happiness_at) VALUES (?, ?, ?)', [id, STARTING_HAPPINESS, now]);
  }
  seedStudents();
  saveNow();
  return db;
}

function seedStudents() {
  if (!fs.existsSync(STUDENTS_FILE)) return;
  const list = JSON.parse(fs.readFileSync(STUDENTS_FILE, 'utf8'));
  for (const s of list) {
    run(
      `INSERT INTO students (uid, name, major, demo, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(uid) DO UPDATE SET name = excluded.name, major = excluded.major, demo = excluded.demo`,
      [normalizeUid(s.uid), s.name, s.major, s.demo ? 1 : 0, Date.now()],
    );
  }
}

// NFC readers report ids as "04:a2:3b:..", "04A23B..", or decimal; we compare
// on uppercase alphanumerics only.
export function normalizeUid(uid) {
  return String(uid || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

export function all(sql, params = []) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

export function get(sql, params = []) {
  return all(sql, params)[0];
}

export function run(sql, params = []) {
  db.run(sql, params);
  scheduleSave();
}

export function lastInsertId() {
  return get('SELECT last_insert_rowid() AS id').id;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(saveNow, 250);
}

export function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!db) return;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, Buffer.from(db.export()));
  fs.renameSync(tmp, DB_FILE);
}
