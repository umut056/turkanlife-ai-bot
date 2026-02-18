const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const http = require("http");

// ENV
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env eksik");

// Railway healthcheck server
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("OK - Bot Running");
}).listen(PORT, () => {
  console.log("HTTP server listening on", PORT);
});

// Bot & OpenAI
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Hata logları
process.on("unhandledRejection", err => console.error("unhandledRejection:", err));
process.on("uncaughtException", err => console.error("uncaughtException:", err));
bot.on("polling_error", err => console.error("polling_error:", err?.message));

// Basit state sistemi
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

// Karşılama
async function welcome(chatId) {
  const s = getSession(chatId);
  s.stage = "await_goal";

  return bot.sendMessage(chatId,
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

// Saat seçimi
async function askTime(chatId) {
  const s = getSession(chatId);
  s.stage = "await_time";

  return bot.sendMessage(chatId,
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

// İletişim mesajı
async function askContact(chatId) {
  const s = getSession(chatId);
  s.stage = "await_contact";

  return bot.sendMessage(
    chatId,
    "Sana en doğru ve hızlı şekilde ulaşabilmem için iletişim bilgilerini paylaşır mısın?\n\n" +
    "• İsim Soyisim\n" +
    "• Telefon\n" +
    "• E-posta\n" +
    "• Instagram kullanıcı adı\n\n" +
    "Böylece sana özel dönüş yapabilirim 💚"
  );
}

// Metinden iletişim bilgisi çıkarma
function parseContact(text) {
  const raw = text.trim();

  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const eposta = emailMatch ? emailMatch[0] : null;

  const phoneMatch = raw.match(/(\+?90\s*)?0?\s*(5\d{2})[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/);
  const telefon = phoneMatch ? phoneMatch[0] : null;

  const instaMatch = raw.match(/@?[a-zA-Z0-9_.]{3,}/g);
  let instagram = null;
  if (instaMatch) {
    instagram = instaMatch.find(i => i.startsWith("@")) || null;
  }

  const ok = !!(telefon || eposta);

  return {
    ok,
    data: {
      raw,
      telefon,
      eposta,
      instagram
    }
  };
}

// START
bot.onText(/\/start/, async msg => {
  await welcome(msg.chat.id);
});

// Butonlar
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

// Mesajlar
bot.on("message", async msg => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text || text.startsWith("/")) return;

  const s = getSession(chatId);

  if (s.stage === "idle") {
    await welcome(chatId);
    return;
  }

  if (s.stage === "await_contact") {
    const { ok, data } = parseContact(text);

    if (!ok) {
      await bot.sendMessage(chatId,
        "Telefon numaranı veya e-postanı yazman yeterli 🙂"
      );
      return;
    }

    s.contact = data;
    s.stage = "done";

    await bot.sendMessage(chatId,
      "Teşekkür ederim 🙏 Bilgini aldım. En kısa sürede seninle iletişime geçeceğim."
    );
    return;
  }

  // Form bittikten sonra AI cevap verir
  if (s.stage === "done") {
    try {
      await bot.sendChatAction(chatId, "typing");

      const resp = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "Türkçe konuş. Kısa, net ve ilgili cevap ver. Satış baskısı yapma. Sağlık vaadi verme. Samimi ama profesyonel ol."
          },
          { role: "user", content: text }
        ],
        temperature: 0.7
      });

      const answer = resp.choices[0]?.message?.content || "Tekrar yazar mısın?";
      await bot.sendMessage(chatId, answer);
    } catch (e) {
      console.error(e);
      await bot.sendMessage(chatId, "Şu an cevap veremedim 😕");
    }
  }
});

console.log("Bot çalışıyor 🚀");