const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env eksik");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

bot.onText(/\/start/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `Merhaba 🌿 Ben Yaşam Koçu Türkan.

Burada sana satış baskısı olmadan, gerçekten yanında olarak destek olmak için varım.

Kendini daha enerjik mi hissetmek istiyorsun?
Kilo verirken motivasyon mu arıyorsun?
Yoksa beslenmeni daha dengeli hale mi getirmek istiyorsun?

Hedefini bana yaz… birlikte küçük ama etkili bir başlangıç yapalım 💛`
  );
});

bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;

  if (!text || text.startsWith("/")) return;

  bot.sendChatAction(chatId, "typing");

  try {
    const resp = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: `
Sen TürkanLife için çalışan bir yaşam koçusun.
Türkçe konuş.
Samimi, sıcak, karşı tarafı önemseyen bir dil kullan.
Satış baskısı yapma.
Sağlık/tedavi vaadi verme.
Kısa ama etkileyici cevaplar ver.
`
        },
        { role: "user", content: text }
      ],
      temperature: 0.8
    });

    const answer =
      resp.choices?.[0]?.message?.content?.trim() ||
      "Biraz daha açar mısın? Seni doğru anlamak istiyorum 💛";

    await bot.sendMessage(chatId, answer);
  } catch (e) {
    console.error(e);
    await bot.sendMessage(
      chatId,
      "Şu an teknik bir aksilik oldu 😕 Biraz sonra tekrar deneyelim mi?"
    );
  }
});

console.log("Bot çalışıyor 🚀");