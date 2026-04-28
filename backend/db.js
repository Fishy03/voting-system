const path = require("path");
const Database = require("better-sqlite3");

const dbPath = path.join(__dirname, "data.sqlite");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS polls (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_by_user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(created_by_user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS candidates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    poll_id TEXT NOT NULL,
    name TEXT NOT NULL,
    FOREIGN KEY(poll_id) REFERENCES polls(id)
  );

  CREATE TABLE IF NOT EXISTS votes (
    poll_id TEXT NOT NULL,
    user_id INTEGER NOT NULL,
    candidate_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (poll_id, user_id),
    FOREIGN KEY(poll_id) REFERENCES polls(id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(candidate_id) REFERENCES candidates(id)
  );
`);

module.exports = { db };

