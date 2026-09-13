// server.js — Express-сервер: раздаёт мини-апп, REST API для задач, крон-планировщик напоминаний
require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');

const db = require('./db');
const { bot, sendReminder } = require('./bot');

// ... верхняя часть файла (require express, cors и т.д.) ...

const app = express();
app.use(cors());
app.use(express.json());

// ⬇️ ВСТАВЛЯТЬ НАЧИНАЯ ОТСЮДА (вместо старой строки app.use(express.static...)) ⬇️
const fs = require('fs');

// Автоматический выбор пути для Railway и локальной разработки
let miniappPath = path.join(__dirname, 'miniapp');
if (!fs.existsSync(miniappPath)) {
  miniappPath = path.join(__dirname, 'bot', 'miniapp');
}

app.use(express.static(miniappPath));

app.get('/', (req, res) => {
  const indexPath = path.join(miniappPath, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send(`Файл index.html не найден по пути: ${indexPath}`);
  }
});
// ⬆️ КОНЕЦ ВСТАВЛЯЕМОГО БЛОКА ⬆️

const BOT_TOKEN = process.env.BOT_TOKEN;

// --- Проверка подлинности Telegram.WebApp.initData ---------------------
// ... далее идет функция verifyInitData и остальной код ...

// --- Проверка подлинности Telegram.WebApp.initData ---------------------
// Мини-апп должен передавать initData в заголовке X-Telegram-Init-Data.
// Это защищает API от подделки telegram_id посторонними запросами.
function verifyInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computedHash !== hash) return null;
  const userJson = params.get('user');
  return userJson ? JSON.parse(userJson) : null;
}

// В режиме разработки (без Telegram, напрямую в браузере) initData отсутствует —
// тогда используем тестового пользователя, чтобы можно было проверять API руками.
function getTelegramId(req) {
  const initData = req.header('X-Telegram-Init-Data');
  const user = verifyInitData(initData);
  if (user) return user.id;
  if (process.env.NODE_ENV !== 'production') return 1; // тестовый пользователь для локальной разработки
  return null;
}

// --- REST API ------------------------------------------------------------
app.get('/api/tasks', (req, res) => {
  const telegram_id = getTelegramId(req);
  if (!telegram_id) return res.status(401).json({ error: 'unauthorized' });
  res.json(db.listTasksForUser(telegram_id));
});

app.post('/api/tasks', (req, res) => {
  const telegram_id = getTelegramId(req);
  if (!telegram_id) return res.status(401).json({ error: 'unauthorized' });
  const { title, date, time, tier } = req.body;
  if (!title || !date || !time) return res.status(400).json({ error: 'title, date and time are required' });
  const task = db.createTask({ telegram_id, title, date, time, tier });
  res.status(201).json(task);
});

app.patch('/api/tasks/:id/done', (req, res) => {
  const telegram_id = getTelegramId(req);
  if (!telegram_id) return res.status(401).json({ error: 'unauthorized' });
  const task = db.setDone(Number(req.params.id), telegram_id, !!req.body.done);
  res.json(task);
});

app.delete('/api/tasks/:id', (req, res) => {
  const telegram_id = getTelegramId(req);
  if (!telegram_id) return res.status(401).json({ error: 'unauthorized' });
  db.deleteTask(Number(req.params.id), telegram_id);
  res.status(204).end();
});

// --- Планировщик напоминаний: проверка каждую минуту ---------------------
cron.schedule('* * * * *', () => {
  const now = new Date();
  const nowDate = now.toISOString().slice(0, 10);
  const nowTime = now.toTimeString().slice(0, 5);
  const due = db.dueForReminder(nowDate, nowTime);
  due.forEach(task => sendReminder(task));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Сервер запущен: http://localhost:${PORT}`);
  console.log('✅ Бот запущен и слушает сообщения (polling)');
});
