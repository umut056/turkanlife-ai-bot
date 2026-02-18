/**
 * TurkanLife Bot (Railway + Polling)
 * Akış:
 *  - Kullanıcı bota ne yazarsa yazsın -> otomatik başlar (idle -> welcome)
 *  - Hedef seçimi -> Saat seçimi -> İletişim bilgisi -> DONE
 *  - Form bittikten sonra kullanıcı ne yazarsa -> AI devreye girer (ChatGPT)
 *  - Lead gelince ADMIN'e otomatik bildirim gider
 */

const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");
const http = require("http");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const PORT = process.env.PORT || 3000;

// ✅ Senin Telegram ID'n (admin bildirimleri buraya gider)
const ADMIN_ID = 7245087436;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env eksik");

// Railway healthcheck için basit HTTP server
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("OK - TurkanLife Bot Running");
  })
  .listen(PORT, () => console.log("HTTP server listening on", PORT));

// Bot + OpenAI
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Hata logları (Railway logs'ta görünür)
process.on("unhandledRejection", (err) => console.error("unhandledRejection:", err));
process.on("uncaughtException", (err) => console.error("uncaughtException:", err));
bot.on("polling_error", (err) => console.error("polling_error:", err?.message || err));

// Session state
// stages: "idle" | "await_goal" | "await_time" | "await_contact" | "done"
const sessions = new Map();

function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      stage: "idle",
      goal: null,
      timeSlot: null,
      contact: null,
      createdAt: Date.now(),
    });
  }
  return sessions.get(chatId);
}

function goalLabel(goal) {
  const map = {
    kilo_verme: "Kilo vermek",
    kilo_alma: "Kilo almak",
    saglikli_beslenme: "Sağlıklı beslenmek",
    cilt: "Cilt beslenmesi",
    is: "İş fırsatı",
  };
  return map[goal] || goal || "-";
}

function timeLabel(slot) {
  const map = {
    "09-12": "09:00–12:00",
    "12-18": "12:00–18:00",
    "18+": "18:00 ve sonrası",
  };
  return map[slot] || slot || "-";
}

async function welcome(chatId) {
  const s = getSession(chatId);
  s.stage = "await_goal";
  s.goal = null;
  s.timeSlot = null;
  s.contact = null;

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

// Metinden daha doğru iletişim çıkarma (format zorunlu değil)
function parseContact(text) {
  const raw = (text || "").trim();

  // Email
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const eposta = emailMatch ? emailMatch[0] : null;

  // Telefon (TR) — 10/11 haneli varyasyonlar, +90 vs
  const phoneMatch = raw.match(/(\+?90\s*)?0?\s*(5\d{2})[\s-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/);
  const telefon = phoneMatch ? phoneMatch[0].replace(/\s+/g, " ").trim() : null;

  // Instagram: mutlaka @ ile başlayan
  // örn: @umutgg, @umut.poyraz_34
  const instaMatch = raw.match(/@([a-zA-Z0-9_.]{3,30})/);
  const instagram = instaMatch ? `@${instaMatch[1]}` : null;

  // İsim/soyisim tahmini: email/telefon/instagram çıkar, kalan metinden ilk 2-4 kelime
  const cleaned = raw
    .replace(eposta || "", " ")
    .replace(telefon || "", " ")
    .replace(instagram || "", " ")
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  let isim = null;
  if (cleaned) {
    const parts = cleaned.split(" ").filter(Boolean);
    // Çok uzunsa 4 kelimeyle sınırla
    isim = parts.slice(0, 4).join(" ");
  }

  // Yeterlilik: telefon veya eposta gelirse tamam
  const ok = !!(telefon || eposta);

  return {
    ok,
    data: {
      isim, // yazdıysa yakalanır, yoksa null
      telefon,
      eposta,
      instagram,
      raw,
    },
  };
}

// /start (isterse)
bot.onText(/\/start/, async (msg) => {
  await welcome(msg.chat.id);
});

// Inline butonlar
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  const data = q.data || "";
  if (!chatId) return;

  const s = getSession(chatId);

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
  if (text.startsWith("/")) return; // /start zaten yukarıda

  const s = getSession(chatId);

  // ✅ Kullanıcı ne yazarsa yazsın, ilk temas -> otomatik başlat
  if (s.stage === "idle") {
    await welcome(chatId);
    return;
  }

  // Hedef seçmeden yazarsa -> hedef menüsünü tekrar göster
  if (s.stage === "await_goal") {
    await bot.sendMessage(chatId, "Bir seçenek seçmen yeterli 👇");
    await welcome(chatId);
    return;
  }

  // Saat seçmeden yazarsa -> saat menüsünü tekrar göster
  if (s.stage === "await_time") {
    await bot.sendMessage(chatId, "Saat aralığını seçmen yeterli 👇");
    await askTime(chatId);
    return;
  }

  // İletişim bekliyorsa: serbest format kabul
  if (s.stage === "await_contact") {
    const { ok, data } = parseContact(text);

    if (!ok) {
      await bot.sendMessage(chatId, "Telefon numaranı veya e-postanı yazman yeterli 🙂");
      return;
    }

    s.contact = data;
    s.stage = "done";

    // Kullanıcıya onay
    await bot.sendMessage(chatId, "Teşekkür ederim 🙏 Bilgini aldım. En kısa sürede seninle iletişime geçeceğim.");

    // Admin'e lead bildirimi
    const leadText =
      `🔥 Yeni Lead Geldi\n\n` +
      `👤 İsim: ${data.isim || msg.from?.first_name || "-"}\n` +
      `📞 Telefon: ${data.telefon || "-"}\n` +
      `📧 Mail: ${data.eposta || "-"}\n` +
      `📸 Instagram: ${data.instagram || "-"}\n` +
      `🎯 Hedef: ${goalLabel(s.goal)}\n` +
      `🕒 Saat: ${timeLabel(s.timeSlot)}`;

    try {
      await bot.sendMessage(ADMIN_ID, leadText);
    } catch (e) {
      console.error("ADMIN notify error:", e?.message || e);
    }

    return;
  }

  // ✅ Form bittiyse: AI devreye girsin
  if (s.stage === "done") {
    try {
      await bot.sendChatAction(chatId, "typing");

      const resp = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content:
              "Türkçe konuş. Kısa, net ve ilgili cevap ver. Satış baskısı yapma. Sağlık/tedavi vaadi verme. Kullanıcıyı önemseyen, sıcak ama abartısız bir dil kullan. Gereksiz uzun yazma.",
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
    return;
  }

  // Beklenmedik durum -> güvenli şekilde akışı başlat
  await welcome(chatId);
});

console.log("Bot çalışıyor 🚀 (polling + lead + AI)");