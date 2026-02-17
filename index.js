const TelegramBot = require("node-telegram-bot-api");
const OpenAI = require("openai");

const BOT_TOKEN = process.env.BOT_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN env eksik");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY env eksik");

const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Merhaba 👋 TurkanLife bot aktif. Bana hedefini yaz (kilo vermek / enerji / beslenme)."
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
          content:
            "Sen TurkanLife için Türkçe konuşan, samimi, satış baskısı yapmayan bir destek asistanısın. Sağlık/tedavi vaadi verme."
        },
        { role: "user", content: text }
      ],
      temperature: 0.6
    });

    const answer = resp.choices?.[0]?.message?.content?.trim() || "Tekrar yazar mısın?";
    await bot.sendMessage(chatId, answer);
  } catch (e) {
    console.error(e);
    await bot.sendMessage(chatId, "Şu an cevap veremedim 😕 Biraz sonra tekrar dener misin?");
  }
});

console.log("Bot çalışıyor 🚀");