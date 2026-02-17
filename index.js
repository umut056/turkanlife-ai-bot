const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env eksik");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Basit hafıza (Railway restart olursa sıfırlanır)
const sessions = new Map(); // chatId -> { goal, tone, lastUserText, startedAt }

// ---- Helpers ----
function normalize(text) {
  return (text || "").toLowerCase().trim();
}

function detectGoal(text) {
  const t = normalize(text);

  // kilo
  if (
    t.includes("kilo") ||
    t.includes("zayıf") ||
    t.includes("zayif") ||
    t.includes("vermek") ||
    t.includes("yağ") ||
    t.includes("yag")
  )
    return "kilo";

  // enerji
  if (
    t.includes("enerji") ||
    t.includes("yorgun") ||
    t.includes("uyku") ||
    t.includes("performans") ||
    t.includes("bitkin")
  )
    return "enerji";

  // beslenme
  if (
    t.includes("beslen") ||
    t.includes("diyet") ||
    t.includes("öğün") ||
    t.includes("ogun") ||
    t.includes("tatlı") ||
    t.includes("tatli") ||
    t.includes("atıştır") ||
    t.includes("atistir")
  )
    return "beslenme";

  return null;
}

function ensureSession(chatId) {
  if (!sessions.has(chatId)) {
    sessions.set(chatId, {
      goal: null,
      tone: "warm",
      lastUserText: "",
      startedAt: Date.now(),
    });
  }
  return sessions.get(chatId);
}

// Riskli sağlık söylemlerinde “tıbbi iddia yok” güvenliği
function safetyHintIfNeeded(text) {
  const t = normalize(text);
  const flags = [
    "hamile",
    "emzir",
    "tansiyon",
    "şeker",
    "seker",
    "diyabet",
    "kalp",
    "ilaç",
    "ilac",
    "hastalık",
    "hastalik",
    "tedavi",
    "depresyon",
    "panik",
    "anoreksi",
    "bulimi",
  ];
  if (flags.some((w) => t.includes(w))) {
    return `Not: Kullanıcı sağlık durumu/ilaç vb. ifade etmiş olabilir. Tıbbi tavsiye verme. Güvenli, genel öneriler ver; gerekirse doktora/diyetisyene yönlendir.`;
  }
  return "";
}

// ---- START ----
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  ensureSession(chatId);

  const text =
    `Hoş geldin 🌿\n` +
    `Bugün “benim için iyi olacak” küçük bir şey seçelim.\n\n` +
    `Bana tek kelime yazman yeter:\n` +
    `• kilo\n` +
    `• enerji\n` +
    `• beslenme\n\n` +
    `İstersen şunu da ekle: “Şu aralar en zor olan…”`;

  await bot.sendMessage(chatId, text);
});

// ---- MAIN MESSAGE HANDLER ----
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  // Bot mesajı / boş / komut ise pas geç
  if (!text) return;
  if (msg.from?.is_bot) return;
  if (text.startsWith("/")) return;

  const session = ensureSession(chatId);
  session.lastUserText = text;

  // Eğer kullanıcı hedefi ilk kez söylüyorsa yakala ve daha “sohbet başlatan” sorular sor
  const goal = detectGoal(text);
  if (goal && !session.goal) {
    session.goal = goal;

    let followup = "";
    if (goal === "kilo") {
      followup =
        `Tamam 💛\n` +
        `Sana uygun bir başlangıç bulalım.\n\n` +
        `1) Gün içinde en çok ne zorlanıyor? (tatlı / gece yeme / porsiyon / su / motivasyon)\n` +
        `2) Günlük hareketin nasıl? (az / orta / çok)\n` +
        `3) Hedefin kaç kilo ya da beden? (yaklaşık yazabilirsin)\n\n` +
        `Kısacık yaz, ben toparlayıp 1 dakikalık bir plan çıkaracağım.`;
    } else if (goal === "enerji") {
      followup =
        `Anladım ✨\n` +
        `Enerjini yükselten küçük ayarları bulalım.\n\n` +
        `1) En çok hangi saatlerde düşüyor? (sabah / öğlen / akşam)\n` +
        `2) Uyku düzenin nasıl? (kaçta yatıp kalkıyorsun)\n` +
        `3) Gün içinde kahve/çay ne kadar?\n\n` +
        `Bunları yaz, ben sana “bugün uygulanabilir” mini bir rutin önereceğim.`;
    } else {
      followup =
        `Süper 🍽️\n` +
        `Beslenmede en çok nerede takılıyorsun bulalım.\n\n` +
        `1) En zor kısım hangisi? (öğün atlama / tatlı / dışarıda yeme / geç saat)\n` +
        `2) Gün içinde kaç öğün çıkıyor genelde?\n` +
        `3) Hedefin ne: düzen / hafifleme / şişkinlik / denge?\n\n` +
        `Kısaca yaz; ben sana 3 net öneriyle döneyim.`;
    }

    await bot.sendMessage(chatId, followup);
    return;
  }

  // Normal sohbet: OpenAI ile yanıt
  bot.sendChatAction(chatId, "typing");

  try {
    const goalLabel =
      session.goal === "kilo"
        ? "Kilo yönetimi"
        : session.goal === "enerji"
        ? "Enerji & rutin"
        : session.goal === "beslenme"
        ? "Beslenme düzeni"
        : "Genel destek";

    const safety = safetyHintIfNeeded(text);

    const systemPrompt = `
Sen Türkçe konuşan, sıcak ve dikkatli bir destek asistanısın.
Görevin: Kullanıcının hedefi (${goalLabel}) doğrultusunda onu küçük, uygulanabilir adımlarla yönlendirmek.
Üslup:
- “Ben yaşam koçuyum” gibi tanıtım yapma. Kullanıcı merkezli konuş.
- Cümleler kısa, canlı, ilgiyi taşıyan olsun. Emoji az ama yerinde.
- Kullanıcıya 1-2 seçenek sun, soru sormayı unutma (sohbet ilerlesin).
- Asla tıbbi tedavi/teşhis vaadi verme, kesin iddialar kurma.
- Uygun olduğunda: 1) küçük bir özet, 2) 2-3 net aksiyon, 3) tek bir soru.
- Herbalife/ürün/satış gibi şeylerden bahsetme (kullanıcı istemedikçe).
${safety}
`.trim();

    const userPrompt = `
Kullanıcı mesajı: "${text}"

Bağlam:
- Hedef: ${goalLabel}
- Daha önce seçilen hedef varsa ona göre ilerle.
İstenen çıktı:
- Dikkat çeken, kullanıcıyı önemseyen bir yanıt
- 2-3 pratik adım
- 1 net soru ile bitir
`.trim();

    const resp = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.75,
      max_tokens: 260,
    });

    const answer =
      resp.choices?.[0]?.message?.content?.trim() ||
      "Bir şeyi kaçırdım gibi 🙈 Cümleyi bir kez daha yazar mısın?";

    await bot.sendMessage(chatId, answer);
  } catch (e) {
    console.error(e);
    await bot.sendMessage(
      chatId,
      "Şu an kısa bir aksilik oldu 😕 10 saniye sonra tekrar yazar mısın?"
    );
  }
});

console.log("Bot çalışıyor 🚀");