const TelegramBot = require("node-telegram-bot-api");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Basit hafıza (Railway yeniden başlarsa sıfırlanır - şimdilik yeterli)
const sessions = new Map();

// Aşamalar
const STEP = {
  WELCOME: "WELCOME",
  GOAL: "GOAL",
  TIME: "TIME",
  IG: "IG",
  LOCATION: "LOCATION",
  NAME: "NAME",
  SURNAME: "SURNAME",
  EMAIL: "EMAIL",
  PHONE: "PHONE",
  DONE: "DONE",
};

function resetSession(chatId) {
  sessions.set(chatId, {
    step: STEP.GOAL,
    data: {
      goal: null,
      time: null,
      instagram: null,
      countryCity: null,
      name: null,
      surname: null,
      email: null,
      phone: null,
    },
    // çift tetiklemeyi azaltmak için
    lastMessageId: null,
  });
}

function sendWelcome(chatId) {
  return bot.sendMessage(
    chatId,
    "Merhaba, ben Yaşam Koçu Türkan.\nSize nasıl yardımcı olabilirim?",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Kilo vermek istiyorum", callback_data: "goal:kilo_vermek" }],
          [{ text: "Kilo almak istiyorum", callback_data: "goal:kilo_almak" }],
          [{ text: "Sağlıklı beslenme istiyorum", callback_data: "goal:saglikli_beslenme" }],
          [{ text: "Cilt beslenmesi hakkında bilgi almak istiyorum", callback_data: "goal:cilt" }],
          [{ text: "İş fırsatı hakkında bilgi almak istiyorum", callback_data: "goal:is_firsati" }],
        ],
      },
    }
  );
}

function sendTimeOptions(chatId) {
  return bot.sendMessage(chatId, "Hangi saat aralığında müsaitsiniz?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "09:00 – 12:00", callback_data: "time:09-12" }],
        [{ text: "12:00 – 18:00", callback_data: "time:12-18" }],
        [{ text: "18:00 ve sonrası", callback_data: "time:18plus" }],
      ],
    },
  });
}

function ask(chatId, text) {
  return bot.sendMessage(chatId, text);
}

// /start her zaman resetlesin
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  resetSession(chatId);
  await sendWelcome(chatId);
});

// Buton tıklamaları
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const session = sessions.get(chatId) || (resetSession(chatId), sessions.get(chatId));

  // Aynı callback'e iki kere basılınca tekrarı azalt
  if (session.lastMessageId === q.id) {
    return bot.answerCallbackQuery(q.id);
  }
  session.lastMessageId = q.id;

  const data = q.data || "";

  try {
    // Telegram "loading" kapat
    await bot.answerCallbackQuery(q.id);

    if (data.startsWith("goal:")) {
      session.data.goal = data.split(":")[1];
      session.step = STEP.TIME;
      await sendTimeOptions(chatId);
      return;
    }

    if (data.startsWith("time:")) {
      session.data.time = data.split(":")[1];
      session.step = STEP.IG;
      await ask(chatId, "Instagram kullanıcı adınız?");
      return;
    }
  } catch (e) {
    console.error("callback_query error:", e);
  }
});

// Metin mesajları (form alanları)
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // komutları burada işleme
  if (!text || text.startsWith("/")) return;

  const session = sessions.get(chatId);
  // kullanıcı /start demeden yazarsa yine akışı başlat
  if (!session) {
    resetSession(chatId);
    await sendWelcome(chatId);
    return;
  }

  // IG -> LOCATION -> NAME -> SURNAME -> EMAIL -> PHONE
  try {
    if (session.step === STEP.IG) {
      session.data.instagram = text.trim();
      session.step = STEP.LOCATION;
      await ask(chatId, "Hangi ülke ve şehirde yaşıyorsunuz?");
      return;
    }

    if (session.step === STEP.LOCATION) {
      session.data.countryCity = text.trim();
      session.step = STEP.NAME;
      await ask(chatId, "Ad");
      return;
    }

    if (session.step === STEP.NAME) {
      session.data.name = text.trim();
      session.step = STEP.SURNAME;
      await ask(chatId, "Soyad");
      return;
    }

    if (session.step === STEP.SURNAME) {
      session.data.surname = text.trim();
      session.step = STEP.EMAIL;
      await ask(chatId, "E-posta");
      return;
    }

    if (session.step === STEP.EMAIL) {
      session.data.email = text.trim();
      session.step = STEP.PHONE;
      await ask(chatId, "Telefon");
      return;
    }

    if (session.step === STEP.PHONE) {
      session.data.phone = text.trim();
      session.step = STEP.DONE;

      await bot.sendMessage(chatId, "Teşekkür ederim.\nEn kısa sürede sizinle iletişime geçeceğim.");

      // İstersen burada bilgileri loglayalım (Railway logs'tan görürsün)
      console.log("NEW LEAD:", { chatId, ...session.data });

      return;
    }

    // DONE sonrası yazarsa tekrar menü açalım (isteğe bağlı)
    if (session.step === STEP.DONE) {
      resetSession(chatId);
      await sendWelcome(chatId);
      return;
    }
  } catch (e) {
    console.error("message flow error:", e);
    await bot.sendMessage(chatId, "Bir sorun oldu. /start yazar mısınız?");
  }
});

console.log("Bot çalışıyor 🚀");