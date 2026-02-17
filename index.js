const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env eksik");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Basit oturum durumu (Railway restart olursa sıfırlanır — şimdilik yeterli)
const sessions = new Map();
/**
 * session shape:
 * {
 *   goal: "kilo"|"enerji"|"beslenme"|null,
 *   step: "idle"|"ask_profile"|"ask_habits"|"ready",
 *   profile: { age?: number, height?: number, weight?: number },
 *   habits: { activity?: string, hardTime?: string }
 * }
 */
function getSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      goal: null,
      step: "idle",
      profile: {},
      habits: {}
    });
  }
  return sessions.get(chatId);
}

function startKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🔥 Kilo Vermek", callback_data: "goal:kilo" },
          { text: "⚡ Enerji", callback_data: "goal:enerji" }
        ],
        [{ text: "🥗 Beslenme Düzeni", callback_data: "goal:beslenme" }],
        [{ text: "ℹ️ Nasıl çalışırım?", callback_data: "help" }]
      ]
    }
  };
}

function habitsKeyboard() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "0–3k adım", callback_data: "act:low" },
          { text: "3–7k adım", callback_data: "act:mid" },
          { text: "7k+ adım", callback_data: "act:high" }
        ],
        [
          { text: "En zor: Akşam", callback_data: "time:aksam" },
          { text: "En zor: Gece", callback_data: "time:gece" },
          { text: "En zor: Öğlen", callback_data: "time:oglen" }
        ],
        [{ text: "🔁 Baştan Başla", callback_data: "reset" }]
      ]
    }
  };
}

function goalLabel(goal) {
  if (goal === "kilo") return "Kilo verme";
  if (goal === "enerji") return "Enerji";
  return "Beslenme düzeni";
}

bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const s = getSession(chatId);
  s.goal = null;
  s.step = "idle";
  s.profile = {};
  s.habits = {};

  await bot.sendMessage(
    chatId,
    "Merhaba 🌿 Ben **TürkanLife Koç Bot**.\n\nSana satış baskısı olmadan, *mini adımlarla* destek olurum.\n\nÖnce hedefini seçelim 👇",
    { parse_mode: "Markdown", ...startKeyboard() }
  );
});

// Inline buton tıklamaları
bot.on("callback_query", async (q) => {
  const chatId = q.message?.chat?.id;
  if (!chatId) return;

  const data = q.data || "";
  const s = getSession(chatId);

  // Telegram'da "loading" dönmesin
  try { await bot.answerCallbackQuery(q.id); } catch {}

  if (data === "reset") {
    s.goal = null;
    s.step = "idle";
    s.profile = {};
    s.habits = {};
    await bot.sendMessage(
      chatId,
      "Tamam ✅ Baştan başlıyoruz.\nHedefini seç 👇",
      { parse_mode: "Markdown", ...startKeyboard() }
    );
    return;
  }

  if (data === "help") {
    await bot.sendMessage(
      chatId,
      "Ben şöyle çalışırım:\n\n✅ 2 dakikada mini profil çıkarırım\n✅ Sana uygun *küçük* bir plan öneririm\n✅ İstersen günlük takip mesajlarıyla destek olurum\n\nHedefini seçerek başlayalım 👇",
      { ...startKeyboard() }
    );
    return;
  }

  if (data.startsWith("goal:")) {
    const goal = data.split(":")[1];
    s.goal = goal; // kilo|enerji|beslenme
    s.step = "ask_profile";
    s.profile = {};

    await bot.sendMessage(
      chatId,
      `Harika ✅ Hedef: **${goalLabel(goal)}**\n\nŞimdi 3 bilgiyi tek satırda yaz:\nÖrn: \`30 165 72\`\n(Yaş Boy Kilo)`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (data.startsWith("act:")) {
    const act = data.split(":")[1];
    s.habits.activity =
      act === "low" ? "0–3k adım" : act === "mid" ? "3–7k adım" : "7k+ adım";

    // Eğer zor saat de seçildiyse hazır say
    if (s.habits.hardTime) s.step = "ready";

    await bot.sendMessage(
      chatId,
      `Not aldım ✅ Aktivite: **${s.habits.activity}**\nŞimdi “en zor saat”i de seçebilirsin 👇`,
      { parse_mode: "Markdown", ...habitsKeyboard() }
    );
    return;
  }

  if (data.startsWith("time:")) {
    const t = data.split(":")[1];
    s.habits.hardTime = t === "aksam" ? "Akşam" : t === "gece" ? "Gece" : "Öğlen";

    if (s.habits.activity) s.step = "ready";

    await bot.sendMessage(
      chatId,
      `Süper ✅ En zor zaman: **${s.habits.hardTime}**\n\nArtık hazırım. Bana bugün nasıl hissettiğini yazabilir ya da “plan yap” yazabilirsin.`,
      { parse_mode: "Markdown" }
    );
    return;
  }
});

// Yaş/Boy/Kilo tek satır yakalama
function parseYBK(text) {
  // "30 165 72" gibi
  const m = text.trim().match(/^(\d{1,2})\s+(\d{2,3})\s+(\d{2,3})$/);
  if (!m) return null;
  const age = Number(m[1]);
  const height = Number(m[2]);
  const weight = Number(m[3]);
  if (age < 10 || age > 90) return null;
  if (height < 120 || height > 220) return null;
  if (weight < 30 || weight > 250) return null;
  return { age, height, weight };
}

async function askHabits(chatId) {
  await bot.sendMessage(
    chatId,
    "Şimdi 2 hızlı seçim yapalım 👇\n\n1) Günlük hareketin?\n2) En zorlandığın saat?",
    { ...habitsKeyboard() }
  );
}

function buildSystemPrompt(session) {
  const goal = session.goal ? goalLabel(session.goal) : "Genel destek";
  const p = session.profile || {};
  const h = session.habits || {};

  return `
Sen "TürkanLife Koç Bot"sun. Türkçe konuş.
Tarz: samimi, motive edici, kısa-öz ama ilgi çekici. Emoji az ama yerinde.
Amaç: satış baskısı yok. Sponsor/koçluk vurgusu "istersen birlikte planlarız" şeklinde yumuşak.
Kurallar:
- Tıbbi/sağlık vaadi, teşhis/tedavi yok. Riskli durumlarda doktora yönlendir.
- Diyet listesi dayatma; sürdürülebilir öneriler, küçük adımlar.
- Kullanıcıdan en fazla 2-3 soru sor.
- Cevap formatı:
  1) 1 cümle empati + hedefe bağla
  2) 3 maddelik mini öneri (• ile)
  3) 1 mini soru (tek soru) + seçenek sun (parantez içinde)
Kişiselleştirme verileri:
- Hedef: ${goal}
- Profil: yaş=${p.age ?? "?"}, boy=${p.height ?? "?"}, kilo=${p.weight ?? "?"}
- Aktivite: ${h.activity ?? "?"}
- Zor zaman: ${h.hardTime ?? "?"}
`.trim();
}

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (!text) return;

  // komutları burada yeme
  if (text.startsWith("/")) return;

  const s = getSession(chatId);

  // Profil adımı: Yaş Boy Kilo bekliyoruz
  if (s.step === "ask_profile") {
    const ybk = parseYBK(text);
    if (!ybk) {
      await bot.sendMessage(
        chatId,
        "Minik bir format rica edeceğim 🙏\nTek satır: `Yaş Boy Kilo`\nÖrn: `30 165 72`",
        { parse_mode: "Markdown" }
      );
      return;
    }
    s.profile = ybk;
    s.step = "ask_habits";
    await bot.sendMessage(
      chatId,
      `Süper ✅ Not aldım: **${ybk.age} yaş / ${ybk.height} cm / ${ybk.weight} kg**\n\nŞimdi hızlı seçimlere geçelim 👇`,
      { parse_mode: "Markdown" }
    );
    await askHabits(chatId);
    return;
  }

  // Onboarding tamamlanmamışsa hatırlat
  if (!s.goal) {
    await bot.sendMessage(
      chatId,
      "Başlamadan önce hedefini seçelim 👇",
      { ...startKeyboard() }
    );
    return;
  }

  // AI cevap
  bot.sendChatAction(chatId, "typing");

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: buildSystemPrompt(s) },
        { role: "user", content: text }
      ],
      temperature: 0.8
    });

    const answer =
      resp.choices?.[0]?.message?.content?.trim() ||
      "Şunu bir daha yazar mısın? 🙂";

    await bot.sendMessage(chatId, answer);
  } catch (e) {
    console.error(e);
    await bot.sendMessage(
      chatId,
      "Şu an cevap veremedim 😕 Biraz sonra tekrar dener misin?"
    );
  }
});

console.log("Bot çalışıyor 🚀");