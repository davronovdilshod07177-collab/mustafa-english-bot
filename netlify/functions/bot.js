// Mustafa English · Bot, phase 1
// Plain Telegram Bot API, no npm dependencies. Secrets come from Netlify environment variables.
const TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL;
const CHANNEL = process.env.CHANNEL || "@zaytryn";
const CHANNEL_LINK = "https://t.me/" + CHANNEL.replace("@", "");
const SECRET = process.env.WEBHOOK_SECRET;

const T = {
  en: {
    sub: "One quick step before we begin\n\nJoin Mustafa's official channel to unlock your dashboard and community features. Once you've joined, tap Check Subscription.",
    join: "Join channel",
    check: "Check Subscription",
    open: "Open Dashboard",
    ready: "You're all set. Tap below to open your dashboard.",
    missing:
      "We couldn't see your subscription yet. Join the channel, then tap Check Subscription again.",
  },
  uz: {
    sub: "Boshlashga bir qadam qoldi\n\nKabinetingiz va hamjamiyat imkoniyatlarini ochish uchun Mustafaning rasmiy kanaliga obuna bo'ling. So'ng Obunani tekshirish tugmasini bosing.",
    join: "Kanalga qo'shilish",
    check: "Obunani tekshirish",
    open: "Boshqaruv panelini ochish",
    ready: "Hammasi tayyor. Panelni ochish uchun quyidagi tugmani bosing.",
    missing:
      "Obunangiz hali topilmadi. Kanalga qo'shiling, so'ng Obunani tekshirish tugmasini qayta bosing.",
  },
};

async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) console.error(method, j.description);
  return j;
}

async function subscribed(userId) {
  const j = await api("getChatMember", { chat_id: CHANNEL, user_id: userId });
  return (
    j.ok && ["creator", "administrator", "member"].includes(j.result.status)
  );
}

function subScreen(L) {
  return {
    text: T[L].sub,
    reply_markup: {
      inline_keyboard: [
        [{ text: T[L].join, url: CHANNEL_LINK }],
        [{ text: T[L].check, callback_data: "check:" + L }],
      ],
    },
  };
}

function readyScreen(L) {
  return {
    text: T[L].ready,
    reply_markup: {
      inline_keyboard: [[{ text: T[L].open, web_app: { url: MINI_APP_URL } }]],
    },
  };
}

exports.handler = async (event) => {
  const h = event.headers || {};
  if (SECRET && h["x-telegram-bot-api-secret-token"] !== SECRET) {
    return { statusCode: 401, body: "unauthorized" };
  }
  try {
    const u = JSON.parse(event.body || "{}");
    if (u.message && /^\/start(\s|@|$)/.test(u.message.text || "")) {
      await api("sendMessage", {
        chat_id: u.message.chat.id,
        text: "Welcome to Mustafa English! · Mustafa English olamiga xush kelibsiz!\n\nChoose your language · Tilni tanlang",
        reply_markup: {
          inline_keyboard: [
            [
              { text: "English", callback_data: "lang:en" },
              { text: "O'zbekcha", callback_data: "lang:uz" },
            ],
          ],
        },
      });
    } else if (u.callback_query) {
      const cq = u.callback_query;
      const parts = (cq.data || "").split(":");
      const L = parts[1] === "uz" ? "uz" : "en";
      const chat = cq.message.chat.id;
      const mid = cq.message.message_id;
      await api("answerCallbackQuery", { callback_query_id: cq.id });
      if (parts[0] === "lang") {
        await api(
          "editMessageText",
          Object.assign({ chat_id: chat, message_id: mid }, subScreen(L))
        );
      } else if (parts[0] === "check") {
        const ok = await subscribed(cq.from.id);
        const screen = ok
          ? readyScreen(L)
          : Object.assign(subScreen(L), { text: T[L].missing });
        await api(
          "editMessageText",
          Object.assign({ chat_id: chat, message_id: mid }, screen)
        );
      }
    }
  } catch (e) {
    console.error("handler error", e);
  }
  return { statusCode: 200, body: "ok" };
};
