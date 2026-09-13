// bot.js — сам Telegram-бот: команды, открытие мини-приложения, кнопка "Уже бегу!"
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN не задан. Скопируйте .env.example в .env и укажите токен от @BotFather.');
  process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// /start — приветствие + кнопка запуска мини-приложения
bot.onText(/\/start/, async (msg) => {
  db.upsertUser(msg.from.id, msg.from.first_name);

  if (!WEBAPP_URL) {
    // WEBAPP_URL не задан — не пытаемся слать кнопку с пустым url (Telegram её отклонит),
    // просто предупреждаем в чате, чтобы это было видно сразу, а не только в логах.
    console.error('⚠️ WEBAPP_URL не задан — кнопка мини-аппа не будет отправлена.');
    await bot.sendMessage(msg.chat.id,
      `Привет, ${msg.from.first_name}! Бот запущен, но переменная WEBAPP_URL ещё не настроена на сервере, поэтому кнопка приложения пока недоступна.`
    ).catch(e => console.error('Не удалось отправить сообщение:', e.message));
    return;
  }

  try {
    await bot.sendMessage(msg.chat.id,
      `Привет, ${msg.from.first_name}! Я помогу планировать задачи на неделю и напомню, когда придёт время.`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: '📋 Открыть планировщик', web_app: { url: WEBAPP_URL } }
          ]]
        }
      }
    );
  } catch (e) {
    console.error('Ошибка при отправке /start:', e.message);
  }
});

// /today — быстрый текстовый список задач на сегодня (без мини-аппа)
bot.onText(/\/today/, (msg) => {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = db.listTasksForUser(msg.from.id).filter(t => t.date === today);
  if (tasks.length === 0) {
    bot.sendMessage(msg.chat.id, 'На сегодня задач нет 🎉');
    return;
  }
  const lines = tasks.map(t =>
    `${t.done ? '✅' : (t.tier === 1 ? '🔴' : '🟣')} ${t.time} — ${t.title}`
  );
  bot.sendMessage(msg.chat.id, lines.join('\n'));
});

// Нажатие кнопки "Уже бегу!" под напоминанием
bot.on('callback_query', async (query) => {
  const data = query.data || '';
  if (data.startsWith('ack:')) {
    const taskId = Number(data.split(':')[1]);
    db.markAcknowledged(taskId);
    await bot.answerCallbackQuery(query.id, { text: 'Отлично, погнали! 🏃' });
    // убираем кнопку, чтобы повторно нажать было нельзя
    try {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
      await bot.editMessageText(query.message.text + '\n\n✅ Принято', {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id
      });
    } catch (e) { /* сообщение могло быть уже изменено — не критично */ }
  }
});

// Отправка самого напоминания. Вызывается планировщиком из server.js
async function sendReminder(task) {
  try {
    await bot.sendMessage(task.telegram_id,
      `⏰ Время выполнять задачу «${task.title}»`,
      {
        reply_markup: {
          inline_keyboard: [[
            { text: 'Уже бегу! 🏃', callback_data: `ack:${task.id}` }
          ]]
        }
      }
    );
    db.markNotified(task.id);
  } catch (e) {
    console.error('Не удалось отправить напоминание пользователю', task.telegram_id, e.message);
  }
}

// Подстраховка: необработанные ошибки Telegram API (сеть, неверные данные и т.п.)
// не должны убивать весь процесс — просто логируем их.
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ Необработанная ошибка (unhandledRejection):', reason);
});
bot.on('polling_error', (err) => {
  console.error('⚠️ Ошибка polling:', err.message);
});

module.exports = { bot, sendReminder };
