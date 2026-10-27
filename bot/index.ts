import { Bot, InlineKeyboard } from 'grammy';

async function main() {
  const token = process.env.BOT_TOKEN?.trim();
  const appUrl = process.env.WEB_APP_URL?.trim();
  if (!token || !appUrl) {
    throw new Error('Заполните BOT_TOKEN и WEB_APP_URL в .env.');
  }
  let url: URL;
  try {
    url = new URL(appUrl);
  } catch {
    throw new Error('WEB_APP_URL должен содержать корректный HTTPS-адрес.');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('WEB_APP_URL должен быть HTTPS-адресом без логина и пароля.');
  }

  const bot = new Bot(token);
  const menuButton = {
    type: 'web_app' as const,
    text: 'Открыть приложение',
    web_app: { url: url.href },
  };
  await bot.api.setChatMenuButton({ menu_button: menuButton });
  bot.command('start', async (ctx) => {
    if (ctx.chat.type !== 'private') {
      await ctx.reply('Открой личный чат со мной, чтобы запустить приложение.');
      return;
    }
    await bot.api.setChatMenuButton({ chat_id: ctx.chat.id, menu_button: menuButton });
    await ctx.reply('Нажми кнопку, чтобы открыть приложение.', {
      reply_markup: new InlineKeyboard().webApp('Открыть приложение', url.href),
    });
  });
  // Не выводим объекты ошибок API: они могут содержать данные пользователя.
  bot.catch(() => console.error('Не удалось обработать обновление Telegram.'));
  process.once('SIGINT', () => { void bot.stop(); });
  process.once('SIGTERM', () => { void bot.stop(); });
  await bot.start({ onStart: () => console.info('Бот запущен.') });
}

main().catch(() => {
  console.error('Не удалось запустить бота. Проверьте .env, токен и подключение к Telegram.');
  process.exitCode = 1;
});
