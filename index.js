const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const http = require("http");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

// 👇 SENİN TELEGRAM ID'N
const ADMIN_ID = 7245087436;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env eksik");

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT);

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      stage: "idle",
      goal: null,
      timeSlot: null,
      contact: null
    });
  }
  return sessions.get(chatId);
}

async function welcome(chatId) {
  const s = getSession(chatId);
  s.stage = "await_goal";

  await bot.sendMessage(chatId,
    "Merhaba, ben Yaşam Koçu Türkan. Size nasıl yardımcı olabilirim?",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "Kilo vermek istiyorum", callback_data: "GOAL:kilo_verme" }],
          [{ text: "Kilo almak istiyorum", callback_data: "GOAL:kilo_alma" }],
          [{ text: "Sağlıklı beslenmek istiyorum", callback_data: "GOAL:saglikli_beslenme" }],
          [{ text: "Cilt beslenmesi hakkında bilgi almak istiyorum", callback_data: "GOAL:cilt" }],
          [{ text: "İş fırsatı hakkında bilgi almak istiyorum", callback_data: "GOAL:is" }],
        ]
      }
    }
  );
}

async function askTime(chatId) {
  const s = getSession(chatId);
  s.stage = "await_time";

  await bot.sendMessage(chatId,
    "Harika ✅ Görüşmemizi en doğru zamana koyalım: hangi saat aralığı sana daha uygun?",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "09:00–12:00", callback_data: "TIME:09-12" }],
          [{ text: "12:00–18:00", callback_data: "TIME:12-18" }],
          [{ text: "18:00 ve sonrası", callback_data: "TIME:18+" }],
        ]
      }
    }
  );
}

async function askContact(chatId) {
  const s = getSession(chatId);
  s.stage = "await_contact";

  await bot.sendMessage(
    chatId,
    "Sana en doğru ve hızlı şekilde ulaşabilmem için iletişim bilgilerini paylaşır mısın?\n\n" +
    "• İsim Soyisim\n" +
    "• Telefon\n" +
    "• E-posta\n" +
    "• Instagram kullanıcı adı\n\n" +
    "Böylece sana özel dönüş yapabilirim 💚"
  );
}

function parseContact(text) {
  const emailMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const eposta = emailMatch ? emailMatch[0] : null;

  const phoneMatch = text.match(/(\+?90\s*)?0?\s*(5\d{2})[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/);
  const telefon = phoneMatch ? phoneMatch[0] : null;

  const instaMatch = text.match(/@\w+/);
  const instagram = instaMatch ? instaMatch[0] : null;

  return {
    ok: !!(telefon || eposta),
    data: { telefon, eposta, instagram, raw: text }
  };
}

bot.onText(/\/start/, async msg => {
  await welcome(msg.chat.id);
});

bot.on("callback_query", async q => {
  const chatId = q.message.chat.id;
  const data = q.data;
  const s = getSession(chatId);

  await bot.answerCallbackQuery(q.id);

  if (data.startsWith("GOAL:")) {
    s.goal = data.split(":")[1];
    await askTime(chatId);
  }

  if (data.startsWith("TIME:")) {
    s.timeSlot = data.split(":")[1];
    await askContact(chatId);
  }
});

bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  const s = getSession(chatId);

  if (s.stage === "await_contact") {
    const { ok, data } = parseContact(text);

    if (!ok) {
      await bot.sendMessage(chatId, "Telefon numaranı veya e-postanı yazman yeterli 🙂");
      return;
    }

    s.contact = data;
    s.stage = "done";

    await bot.sendMessage(chatId,
      "Teşekkür ederim 🙏 Bilgini aldım. En kısa sürede seninle iletişime geçeceğim."
    );

    // 🔥 ADMIN'E BİLDİRİM
    await bot.sendMessage(ADMIN_ID,
      `🔥 Yeni Lead Geldi\n\n` +
      `👤 İsim: ${msg.from.first_name || "-"}\n` +
      `📞 Telefon: ${data.telefon || "-"}\n` +
      `📧 Mail: ${data.eposta || "-"}\n` +
      `📸 Instagram: ${data.instagram || "-"}\n` +
      `🎯 Hedef: ${s.goal || "-"}\n` +
      `🕒 Saat: ${s.timeSlot || "-"}`
    );

    return;
  }
});

console.log("Bot çalışıyor 🚀");