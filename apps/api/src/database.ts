import Database from 'better-sqlite3';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const defaultDatabasePath = resolve(__dirname, '../data/bounce.sqlite');
const migrationsDirectory = resolve(__dirname, '../migrations');

export function migrateDatabase(db: Database.Database, directory = migrationsDirectory) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) STRICT`);

  const isApplied = db.prepare('SELECT name FROM schema_migrations WHERE name = ?');
  const recordMigration = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  for (const name of readdirSync(directory)
    .filter((file) => file.endsWith('.sql'))
    .sort()) {
    db.transaction(() => {
      if (isApplied.get(name)) return;
      db.exec(readFileSync(resolve(directory, name), 'utf8'));
      recordMigration.run(name);
    }).immediate();
  }
}

export function openDatabase(path = defaultDatabasePath) {
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true });
  const db = new Database(path);

  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    migrateDatabase(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
