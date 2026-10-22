// Mustafa English · Bot
// Phase 1: /start, language choice, subscription check.
// Phase 2: group automation (cleanup, insult ban for 10 minutes, real counts) and admin commands. Storage: Netlify Blobs.
const TOKEN = process.env.BOT_TOKEN;
const MINI_APP_URL = process.env.MINI_APP_URL;
const CHANNEL = process.env.CHANNEL || "@Ieltswithmustaffa";
const CHANNEL_LINK = "https://t.me/" + CHANNEL.replace("@", "");
const SECRET = process.env.WEBHOOK_SECRET;
const OWNER_IDS = (process.env.ADMIN_IDS || "5456493265")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const BAN_SECONDS = 600; // insult ban; Telegram lifts it automatically after this
const TZ_MS = 5 * 3600 * 1000; // Asia/Tashkent is UTC+5, no DST

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

// ---------- Telegram API ----------
async function api(method, body) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const j = await r.json();
  if (!j.ok) console.error(method, j.description);
  return j;
}

// ---------- Storage (Netlify Blobs) ----------
function db() {
  if (globalThis.__TEST_DB) return globalThis.__TEST_DB; // local tests only
  const { getStore } = require("@netlify/blobs");
  return getStore("mustafa-english");
}
const read = async (key, fallback) =>
  (await db().get(key, { type: "json" })) ?? fallback;
const write = (key, value) => db().setJSON(key, value);
const today = () => new Date(Date.now() + TZ_MS).toISOString().slice(0, 10);
const EMPTY = () => ({ joins: 0, leaves: 0, bans: 0, deleted: 0 });

async function bump(chatId, field) {
  const key = `stats/${chatId}/${today()}`;
  const s = await read(key, EMPTY());
  s[field] += 1;
  await write(key, s);
}

async function isAdmin(id) {
  if (OWNER_IDS.includes(String(id))) return true;
  return (await read("admins", [])).includes(String(id));
}

async function rememberUser(from) {
  if (!from || !from.username) return;
  const users = await read("users", {});
  users[from.username.toLowerCase()] = String(from.id);
  await write("users", users);
}

// ---------- Phase 1: subscription ----------
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

// ---------- Groups ----------
let botId = null;
async function myRights(chatId) {
  if (!botId) botId = (await api("getMe")).result.id;
  const j = await api("getChatMember", { chat_id: chatId, user_id: botId });
  return j.ok ? j.result : {};
}

async function onMyChatMember(m) {
  const chat = m.chat;
  if (chat.type === "private") return;
  const reg = await read("chats", {});
  const s = m.new_chat_member.status;
  if (s === "administrator") {
    reg[chat.id] = {
      title: chat.title || "",
      type: chat.type,
      addedBy: String(m.from.id),
    };
    await write("chats", reg);
    const r = await myRights(chat.id);
    const missing = [];
    if (!r.can_delete_messages) missing.push("xabarlarni o'chirish");
    if (!r.can_restrict_members) missing.push("a'zolarni bloklash");
    await api("sendMessage", {
      chat_id: m.from.id,
      text: missing.length
        ? `"${ chat.title }" ulandi, lekin quyidagi huquqlar yetishmaydi: ${missing.join( ", " )}.`
        : `"${chat.title}" ulandi. Kirish-chiqish xabarlari tozalanadi, haqoratli so'zlar uchun a'zo 10 daqiqaga bloklanadi.`,
    });
  } else if (s === "left" || s === "kicked") {
    delete reg[chat.id];
    await write("chats", reg);
  }
}

const IN = ["member", "administrator", "creator", "restricted"];
async function onChatMember(cm) {
  if (cm.new_chat_member.user.is_bot) return;
  const was = IN.includes(cm.old_chat_member.status);
  const now = IN.includes(cm.new_chat_member.status);
  if (!was && now) await bump(cm.chat.id, "joins");
  else if (was && !now)
    await bump(
      cm.chat.id,
      cm.new_chat_member.status === "kicked" ? "bans" : "leaves"
    );
}

async function moderate(msg) {
  const chatId = msg.chat.id;
  if (msg.new_chat_members || msg.left_chat_member) {
    await api("deleteMessage", { chat_id: chatId, message_id: msg.message_id });
    return true;
  }
  if (!msg.text || (await isAdmin(msg.from.id))) return false;
  const words = await read("words", []);
  const tokens = msg.text.toLowerCase().split(/[^\p{L}\p{N}']+/u);
  if (!words.length || !tokens.some((t) => words.includes(t))) return false;
  await api("deleteMessage", { chat_id: chatId, message_id: msg.message_id });
  await api("banChatMember", {
    chat_id: chatId,
    user_id: msg.from.id,
    until_date: Math.floor(Date.now() / 1000) + BAN_SECONDS,
  });
  await bump(chatId, "deleted");
  return true;
}

async function groupCommand(msg) {
  const cmd = (msg.text || "")
    .trim()
    .split(/\s+/)[0]
    .split("@")[0]
    .toLowerCase();
  if (cmd !== "/hisobot") return false;
  const s = await read(`stats/${msg.chat.id}/${today()}`, EMPTY());
  await api("sendMessage", {
    chat_id: msg.chat.id,
    text: `Bugun (${today()}): qo'shildi ${s.joins}, chiqdi ${ s.leaves }, bloklandi ${s.bans}, haqoratli xabar ${s.deleted}.`,
  });
  return true;
}

// ---------- Admin commands (private chat) ----------
async function adminCommand(msg) {
  const parts = (msg.text || "").trim().split(/\s+/);
  const cmd = parts[0].split("@")[0].toLowerCase();
  const say = (text) => api("sendMessage", { chat_id: msg.chat.id, text });
  const isOwner = OWNER_IDS.includes(String(msg.from.id));

  if (cmd === "/hisobot") {
    const reg = await read("chats", {});
    const ids = Object.keys(reg);
    if (!ids.length) await say("Hali ulangan guruh yo'q.");
    else {
      const lines = [];
      for (const id of ids) {
        const s = await read(`stats/${id}/${today()}`, EMPTY());
        lines.push(
          `${reg[id].title}: qo'shildi ${s.joins}, chiqdi ${s.leaves}, bloklandi ${s.bans}, haqoratli xabar ${s.deleted}`
        );
      }
      await say(`Bugungi hisobot (${today()}):\n` + lines.join("\n"));
    }
    return true;
  }

  if (cmd === "/soz") {
    if (!isOwner) {
      await say("Bu buyruq faqat egasi uchun.");
      return true;
    }
    let words = await read("words", []);
    const sub = (parts[1] || "").toLowerCase();
    const w = (parts[2] || "").toLowerCase();
    if (sub === "qosh" && w && !words.includes(w)) {
      words.push(w);
      await write("words", words);
    }
    if (sub === "ochir" && w) {
      words = words.filter((x) => x !== w);
      await write("words", words);
    }
    await say(
      words.length
        ? `Taqiqlangan so'zlar: ${words.join(", ")}`
        : "Taqiqlangan so'zlar ro'yxati bo'sh. Qo'shish: /soz qosh so'z"
    );
    return true;
  }

  if (cmd === "/admin") {
    if (!isOwner) {
      await say("Adminlarni faqat egasi boshqaradi.");
      return true;
    }
    const sub = (parts[1] || "").toLowerCase();
    const uname = (parts[2] || "").replace("@", "").toLowerCase();
    if (sub === "qosh" || sub === "ochir") {
      const users = await read("users", {});
      const id = users[uname];
      if (!id) {
        await say(
          `@${uname} hali botga /start yozmagan. U avval /start yozsin, keyin qayta urinib ko'ring.`
        );
        return true;
      }
      let admins = await read("admins", []);
      admins =
        sub === "qosh"
          ? [...new Set([...admins, id])]
          : admins.filter((x) => x !== id);
      await write("admins", admins);
      await say(
        `${ sub === "qosh" ? "Admin qo'shildi" : "Admin olib tashlandi" }: @${uname}`
      );
      return true;
    }
    const admins = await read("admins", []);
    await say(
      admins.length
        ? `Qo'shimcha adminlar: ${admins.length} ta. Qo'shish: /admin qosh @username`
        : "Qo'shimcha admin yo'q. Qo'shish: /admin qosh @username"
    );
    return true;
  }
  return false;
}

// ---------- Routing ----------
async function onMessage(msg) {
  if (msg.chat.type !== "private") {
    if (await moderate(msg)) return;
    await groupCommand(msg);
    return;
  }
  await rememberUser(msg.from);
  if (await isAdmin(msg.from.id)) {
    if (await adminCommand(msg)) return;
  }
  if (/^\/start(\s|@|$)/.test(msg.text || "")) {
    await api("sendMessage", {
      chat_id: msg.chat.id,
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
  }
}

async function onCallback(cq) {
  const parts = (cq.data || "").split(":");
  const L = parts[1] === "uz" ? "uz" : "en";
  const chat = cq.message.chat.id;
  const mid = cq.message.message_id;
  await api("answerCallbackQuery", { callback_query_id: cq.id });
  if (parts[0] === "lang") {
    await api("editMessageText", {
      chat_id: chat,
      message_id: mid,
      ...subScreen(L),
    });
  } else if (parts[0] === "check") {
    const ok = await subscribed(cq.from.id);
    const screen = ok
      ? readyScreen(L)
      : { ...subScreen(L), text: T[L].missing };
    await api("editMessageText", { chat_id: chat, message_id: mid, ...screen });
  }
}

exports.handler = async (event) => {
  const h = event.headers || {};
  if (SECRET && h["x-telegram-bot-api-secret-token"] !== SECRET) {
    return { statusCode: 401, body: "unauthorized" };
  }
  try {
    const u = JSON.parse(event.body || "{}");
    if (u.my_chat_member) await onMyChatMember(u.my_chat_member);
    else if (u.chat_member) await onChatMember(u.chat_member);
    else if (u.message) await onMessage(u.message);
    else if (u.callback_query) await onCallback(u.callback_query);
  } catch (e) {
    console.error("handler error", e);
  }
  return { statusCode: 200, body: "ok" };
};
