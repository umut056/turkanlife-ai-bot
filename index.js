const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const http = require("http");

// ENV
const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env eksik");

// Railway healthcheck için HTTP server
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK - Telegram bot running");
  })
  .listen(PORT, () => console.log("HTTP server listening on", PORT));

// Bot + OpenAI
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Hata yakalama (Railway logs için)
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
bot.on("polling_error", (err) => console.error("polling_error:", err?.message || err));

// Basit state
// stages: "idle" | "await_goal" | "await_time" | "await_contact" | "done"
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      stage: "idle",
      goal: null,
      timeSlot: null,
      contact: null,
      lastPrompt: null, // spam önlemek için
    });
  }
  return sessions.get(chatId);
}

async function welcome(chatId) {
  const s = getSession(chatId);
  s.stage = "await_goal";
  s.goal = null;
  s.timeSlot = null;
  s.contact = null;
  s.lastPrompt = "welcome";

  return bot.sendMessage(chatId, "Merhaba, ben Yaşam Koçu Türkan. Size nasıl yardımcı olabilirim?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Kilo vermek istiyorum", callback_data: "GOAL:kilo_verme" }],
        [{ text: "Kilo almak istiyorum", callback_data: "GOAL:kilo_alma" }],
        [{ text: "Sağlıklı beslenmek istiyorum", callback_data: "GOAL:saglikli_beslenme" }],
        [{ text: "Cilt beslenmesi hakkında bilgi almak istiyorum", callback_data: "GOAL:cilt" }],
        [{ text: "İş fırsatı hakkında bilgi almak istiyorum", callback_data: "GOAL:is" }],
      ],
    },
  });
}

async function askTime(chatId) {
  const s = getSession(chatId);
  s.stage = "await_time";
  s.lastPrompt = "time";

  return bot.sendMessage(chatId, "Harika ✅ Görüşmemizi en doğru zamana koyalım: hangi saat aralığı sana daha uygun?", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "09:00–12:00", callback_data: "TIME:09-12" }],
        [{ text: "12:00–18:00", callback_data: "TIME:12-18" }],
        [{ text: "18:00 ve sonrası", callback_data: "TIME:18+" }],
      ],
    },
  });
}

async function askContact(chatId) {
  const s = getSession(chatId);
  s.stage = "await_contact";
  s.lastPrompt = "contact";

  return bot.sendMessage(
    chatId,
    "Süper 🙂 Telefon numaranı veya e-postanı tek mesajda yazman yeterli."
  );
}

// Format zorunlu değil: metinden telefon veya email yakala
function parseContact(text) {
  const raw = (text || "").trim();

  // Email
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const eposta = emailMatch ? emailMatch[0] : null;

  // Telefon (TR için esnek)
  // örn: 0555 123 45 67 / 05551234567 / +90 555 123 45 67
  const phoneMatch = raw.match(/(\+?90\s*)?0?\s*(5\d{2})[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/);
  const telefon = phoneMatch ? phoneMatch[0].replace(/\s+/g, " ").trim() : null;

  // Ad/Soyad tahmini: email/telefon çıkar, kalan ilk kelimeleri al
  const cleaned = raw
    .replace(eposta || "", " ")
    .replace(telefon || "", " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  let ad = null,
    soyad = null;
  if (cleaned) {
    const parts = cleaned.split(" ").filter(Boolean);
    if (parts.length >= 1) ad = parts[0];
    if (parts.length >= 2) soyad = parts.slice(1).join(" ");
  }

  // Yeterlilik: telefon veya email varsa OK
  const ok = !!(telefon || eposta);

  return {
    ok,
    data: {
      ad,
      soyad,
      eposta,
      telefon,
      raw, // ham mesajı da sakla
    },
  };
}

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await welcome(chatId);
});

// Inline butonlar
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const data = q.data || "";
  if (!chatId) return;

  const s = getSession(chatId);

  // loading kapat
  try {
    await bot.answerCallbackQuery(q.id);
  } catch {}

  if (data.startsWith("GOAL:")) {
    s.goal = data.split(":")[1] || null;
    await askTime(chatId);
    return;
  }

  if (data.startsWith("TIME:")) {
    s.timeSlot = data.split(":")[1] || null;
    await askContact(chatId);
    return;
  }
});

// Normal mesajlar
bot.on("message", async (msg) => {
  const chatId = msg.chat?.id;
  const text = msg.text;

  if (!chatId) return;
  if (!text) return;

  // /komutları burada işlemiyoruz
  if (text.startsWith("/")) return;

  const s = getSession(chatId);

  // /start yazmadan yazdıysa
  if (s.stage === "idle") {
    await welcome(chatId);
    return;
  }

  // Hedef seçmeden yazarsa
  if (s.stage === "await_goal") {
    if (s.lastPrompt !== "welcome_hint") {
      s.lastPrompt = "welcome_hint";
      await bot.sendMessage(chatId, "Bir seçenek seçmen yeterli 👇");
      await welcome(chatId);
    }
    return;
  }

  // Saat seçmeden yazarsa
  if (s.stage === "await_time") {
    if (s.lastPrompt !== "time_hint") {
      s.lastPrompt = "time_hint";
      await bot.sendMessage(chatId, "Saat aralığını seçmen yeterli 👇");
      await askTime(chatId);
    }
    return;
  }

  // İletişim bekliyorsa: format zorunlu değil
  if (s.stage === "await_contact") {
    const { ok, data } = parseContact(text);

    if (!ok) {
      // sadece kısa hatırlatma
      if (s.lastPrompt !== "contact_retry") {
        s.lastPrompt = "contact_retry";
        await bot.sendMessage(chatId, "Telefon numaranı veya e-postanı yazman yeterli 🙂");
      }
      return;
    }

    s.contact = data;
    s.stage = "done";
    s.lastPrompt = "done";

    await bot.sendMessage(chatId, "Teşekkür ederim 🙏 Bilgini aldım. En kısa sürede seninle iletişime geçeceğim.");
    return;
  }

  // Form bitti — AI cevap verebilir
  try {
    await bot.sendChatAction(chatId, "typing");

    const resp = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Türkçe konuş. Kısa, net ve ilgili cevap ver. Satış baskısı yapma. Sağlık/tedavi vaadi verme. Kullanıcıyı önemseyen, sıcak ama abartısız bir dil kullan.",
        },
        { role: "user", content: text },
      ],
      temperature: 0.7,
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "Tekrar yazar mısın?";
    await bot.sendMessage(chatId, answer);
  } catch (e) {
    console.error("OpenAI error:", e);
    await bot.sendMessage(chatId, "Şu an cevap veremedim 😕 Biraz sonra tekrar dener misin?");
  }
});

console.log("Bot çalışıyor 🚀 (polling + healthcheck)");