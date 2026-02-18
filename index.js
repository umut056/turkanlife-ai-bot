const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env eksik");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Basit state yönetimi
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

function welcome(chatId) {
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

function askTime(chatId) {
  const s = getSession(chatId);
  s.stage = "await_time";
  s.lastPrompt = "time";

  return bot.sendMessage(
    chatId,
    "Harika ✅ Görüşmemizi en doğru zamana koyalım: hangi saat aralığı sana daha uygun?",
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "09:00–12:00", callback_data: "TIME:09-12" }],
          [{ text: "12:00–18:00", callback_data: "TIME:12-18" }],
          [{ text: "18:00 ve sonrası", callback_data: "TIME:18+" }],
        ],
      },
    }
  );
}

function askContact(chatId) {
  const s = getSession(chatId);
  s.stage = "await_contact";
  s.lastPrompt = "contact";

  const msg =
    "Süper. İletişim bilgilerini tek mesajda yazabilir misin?\n\n" +
    "Ad:\n" +
    "Soyad:\n" +
    "E-posta:\n" +
    "Telefon:";

  return bot.sendMessage(chatId, msg);
}

function parseContact(text) {
  // Esnek: "Ad: Ali" / "Ad Ali" gibi varyasyonları yakalamaya çalışır
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  const data = {};
  for (const line of lines) {
    const m = line.match(/^(\s*(ad|soyad|e-?posta|telefon)\s*[:\-]?\s*)(.+)$/i);
    if (m) {
      const keyRaw = m[2].toLowerCase();
      const val = m[3].trim();
      if (keyRaw === "ad") data.ad = val;
      if (keyRaw === "soyad") data.soyad = val;
      if (keyRaw === "telefon") data.telefon = val;
      if (keyRaw.startsWith("e")) data.eposta = val;
    }
  }

  // Minimum kontrol: en az ad + telefon veya eposta gelsin
  const ok = !!(data.ad && (data.telefon || data.eposta));
  return { ok, data };
}

// /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  await welcome(chatId);
});

// Inline buton tıklamaları
bot.on("callback_query", async (q) => {
  const chatId = q.message.chat.id;
  const data = q.data || "";
  const s = getSession(chatId);

  // Telegram "loading" hissini kapat
  try { await bot.answerCallbackQuery(q.id); } catch {}

  if (data.startsWith("GOAL:")) {
    const goal = data.split(":")[1];
    s.goal = goal;

    // Hedef seçildikten sonra zamanı sor
    await askTime(chatId);
    return;
  }

  if (data.startsWith("TIME:")) {
    const timeSlot = data.split(":")[1];
    s.timeSlot = timeSlot;

    // Saat seçildikten sonra iletişim bilgisi iste
    await askContact(chatId);
    return;
  }
});

// Normal mesajlar
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
if (!text) return;
  if (text.startsWith("/")) return; // komutları burada işlemiyoruz

  const s = getSession(chatId);

  // Eğer kullanıcı /start yazmadan mesaj attıysa, direkt karşılama göster
  if (s.stage === "idle") {
    await welcome(chatId);
    return;
  }

  // Form aşamasında AI’ye gitme, sadece beklenen alanı işle
  if (s.stage === "await_goal") {
    // Butona basması lazım; yazarsa nazikçe yönlendir
    if (s.lastPrompt !== "welcome_hint") {
      s.lastPrompt = "welcome_hint";
      await bot.sendMessage(chatId, "Bir seçenek seçmen yeterli 👇");
      await welcome(chatId);
    }
    return;
  }

  if (s.stage === "await_time") {
    if (s.lastPrompt !== "time_hint") {
      s.lastPrompt = "time_hint";
      await bot.sendMessage(chatId, "Saat aralığını seçmen yeterli 👇");
      await askTime(chatId);
    }
    return;
  }

  if (s.stage === "await_contact") {
    const { ok, data } = parseContact(text);
    if (!ok) {
      // Kuralcı değil, sadece kısa hatırlatma (spam olmasın)
      if (s.lastPrompt !== "contact_retry") {
        s.lastPrompt = "contact_retry";
        await bot.sendMessage(
          chatId,
          "Tek mesajda şu bilgileri yazman yeterli:\nAd:\nSoyad:\nE-posta:\nTelefon:"
        );
      }
      return;
    }

    s.contact = data;
    s.stage = "done";
    s.lastPrompt = "done";

    await bot.sendMessage(chatId, "Teşekkür ederim 🙏 Bilgilerini aldım. En kısa sürede seninle iletişime geçeceğim.");
    return;
  }

  // Form bitti — istersen burada AI’yi açabiliriz.
  // Şimdilik basit bırakıyorum: AI’ye sorulsun istiyorsan aşağıdaki bloğu açarız.
  // ---- AI BLOĞU (opsiyonel) ----
  try {
    bot.sendChatAction(chatId, "typing");

    const resp = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "Türkçe konuş. Kısa, net ve ilgili cevap ver. Satış baskısı yapma. Sağlık/tedavi vaadi verme. Kullanıcıyı önemseyen, sıcak ama abartısız bir dil kullan."
        },
        { role: "user", content: text }
      ],
      temperature: 0.7
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "Tekrar yazar mısın?";
    await bot.sendMessage(chatId, answer);
  } catch (e) {
    console.error(e);
    await bot.sendMessage(chatId, "Şu an cevap veremedim 😕 Biraz sonra tekrar dener misin?");
  }
});

console.log("Bot çalışıyor 🚀");
