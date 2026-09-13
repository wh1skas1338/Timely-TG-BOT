// db.js — лёгкая база данных SQLite (файл tasks.db создастся автоматически рядом)
const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'tasks.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    telegram_id INTEGER PRIMARY KEY,
    first_name  TEXT,
    created_at  TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id   INTEGER NOT NULL,
    title         TEXT NOT NULL,
    date          TEXT NOT NULL,   -- 'YYYY-MM-DD'
    time          TEXT NOT NULL,   -- 'HH:MM'
    tier          INTEGER NOT NULL DEFAULT 2, -- 1 = срочная, 2 = обычная
    done          INTEGER NOT NULL DEFAULT 0,
    notified      INTEGER NOT NULL DEFAULT 0, -- напоминание уже отправлено
    acknowledged  INTEGER NOT NULL DEFAULT 0, -- пользователь нажал "Уже бегу!"
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_user_date ON tasks(telegram_id, date);
`);

function upsertUser(telegram_id, first_name) {
  db.prepare(`
    INSERT INTO users (telegram_id, first_name) VALUES (?, ?)
    ON CONFLICT(telegram_id) DO UPDATE SET first_name = excluded.first_name
  `).run(telegram_id, first_name || null);
}

function listTasksForUser(telegram_id) {
  return db.prepare(`SELECT * FROM tasks WHERE telegram_id = ? ORDER BY date, time`).all(telegram_id);
}

function createTask({ telegram_id, title, date, time, tier }) {
  const info = db.prepare(`
    INSERT INTO tasks (telegram_id, title, date, time, tier)
    VALUES (?, ?, ?, ?, ?)
  `).run(telegram_id, title, date, time, tier === 1 ? 1 : 2);
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(info.lastInsertRowid);
}

function setDone(id, telegram_id, done) {
  db.prepare(`UPDATE tasks SET done = ? WHERE id = ? AND telegram_id = ?`).run(done ? 1 : 0, id, telegram_id);
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
}

function deleteTask(id, telegram_id) {
  db.prepare(`DELETE FROM tasks WHERE id = ? AND telegram_id = ?`).run(id, telegram_id);
}

// задачи, которым пора напомнить прямо сейчас
function dueForReminder(nowDate, nowTime) {
  return db.prepare(`
    SELECT * FROM tasks
    WHERE done = 0 AND notified = 0
      AND (date < ? OR (date = ? AND time <= ?))
  `).all(nowDate, nowDate, nowTime);
}

function markNotified(id) {
  db.prepare(`UPDATE tasks SET notified = 1 WHERE id = ?`).run(id);
}

function markAcknowledged(id) {
  db.prepare(`UPDATE tasks SET acknowledged = 1 WHERE id = ?`).run(id);
}

function getTask(id) {
  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
}

module.exports = {
  db,
  upsertUser,
  listTasksForUser,
  createTask,
  setDone,
  deleteTask,
  dueForReminder,
  markNotified,
  markAcknowledged,
  getTask,
};
