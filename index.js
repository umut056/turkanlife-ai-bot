const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

/**
 * Basit state (RAM)
 * chatId -> { step: "idle" | "awaiting_form" | "done", goal: string|null, lastStartAt: number }
 */
const state = new Map();

function getState(chatId) {
  if (!state.has(chatId)) {
    state.set(chatId, { step: "idle", goal: null, lastStartAt: 0 });
  }
  return state.get(chatId);
}

function mainMenuKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Kilo vermek istiyorum", callback_data: "goal:kilo_vermek" }],
        [{ text: "Kilo almak istiyorum", callback_data: "goal:kilo_almak" }],
        [{ text: "Sağlıklı beslenmek istiyorum", callback_data: "goal_saglikli_beslenme" }],
      ],
    },
  };
}

function normalizeGoal(cb) {
  // callback_data: goal:kilo_vermek ...
  if (cb === "goal:kilo_vermek") return "Kilo vermek";
  if (cb === "goal:kilo_almak") return "Kilo almak";
  if (cb === "goal_saglikli_beslenme") return "Sağlıklı beslenmek";
  return null;
}

function formTemplateMessage() {
  // Tek mesajda doldurtma şablonu
  return `Ad:
Soyad:
E-posta:
Telefon:`;
}

function looksLikeFilledForm(text) {
  // Kullanıcı şablonu tek mesajda doldurmuş mu?
  // En azından 4 satır ve her biri ":" içeriyor gibi basit kontrol
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  if (lines.length < 4) return false;

  const keys = ["ad", "soyad", "e-posta", "eposta", "email", "telefon", "tel"];
  const hasColonLines = lines.filter(l => l.includes(":")).length >= 3;

  const joined = lines.join(" ").toLowerCase();
  const hasSomeKey = keys.some(k => joined.includes(k));

  return hasColonLines && hasSomeKey;
}

async function sendWelcome(chatId) {
  const welcomeText =
    "Merhaba, ben Yaşam Koçu Türkan.\n" +
    "Size nasıl yardımcı olabilirim?";
  await bot.sendMessage(chatId, welcomeText, mainMenuKeyboard());
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const s = getState(chatId);

  // /start spam engeli (2 sn içinde tekrar gelirse ignore)
  const now = Date.now();
  if (now - s.lastStartAt < 2000) return;
  s.lastStartAt = now;

  // Kullanıcı daha önce tamamladıysa bile tekrar /start ile menüyü gösterelim
  s.step = "idle";
  s.goal = null;

  await sendWelcome(chatId);
});

bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  if (!chatId) return;

  const s = getState(chatId);
  const goal = normalizeGoal(q.data);

  // Telegram "loading" kapansın
  try { await bot.answerCallbackQuery(q.id); } catch {}

  if (!goal) {
    // bilinmeyen callback
    return;
  }

  s.goal = goal;
  s.step = "awaiting_form";

  // Menü mesajını istersen düzenleyelim (temiz görünür)
  try {
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: chatId, message_id: q.message.message_id }
    );
  } catch {}

  await bot.sendMessage(chatId, formTemplateMessage());
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text) return;
  if (text.startsWith("/")) return; // komutları yukarıda yakalıyoruz

  const s = getState(chatId);

  // Eğer kullanıcı henüz hedef seçmediyse: sadece menüye yönlendir
  if (s.step === "idle") {
    await sendWelcome(chatId);
    return;
  }

  // Form bekleniyorsa:
  if (s.step === "awaiting_form") {
    // Kullanıcı şablonu doldurmadıysa tekrar şablon iste (kısa)
    if (!looksLikeFilledForm(text)) {
      await bot.sendMessage(chatId, "Lütfen tek mesajda şu formatla doldur:");
      await bot.sendMessage(chatId, formTemplateMessage());
      return;
    }

    // Burada istersen text'i parse edip bir yere loglayabiliriz.
    // Şimdilik sadece teşekkür ediyoruz.
    s.step = "done";

    await bot.sendMessage(chatId, "Teşekkür ederim. En kısa sürede sizinle iletişime geçeceğim.");
    return;
  }

  // done durumunda kullanıcı yazarsa: menüye geri al
  if (s.step === "done") {
    await sendWelcome(chatId);
    return;
  }
});

console.log("Bot çalışıyor 🚀");