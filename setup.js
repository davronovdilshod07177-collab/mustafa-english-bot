// netlify/functions/setup.js
// One-time webhook setup. Uses BOT_TOKEN stored in Netlify, so no token is typed into a browser.
// Open once: https://mustafa-english.netlify.app/.netlify/functions/setup?key=WEBHOOK_SECRET
const TOKEN = process.env.BOT_TOKEN;
const SECRET = process.env.WEBHOOK_SECRET;
const SITE = process.env.URL || "https://mustafa-english.netlify.app";

const json = (statusCode, obj) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(obj, null, 2),
});

exports.handler = async (event) => {
  const key = (event.queryStringParameters || {}).key;
  if (!SECRET || key !== SECRET) return { statusCode: 403, body: "forbidden" };
  const call = async (method, body) => {
    const r = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    return r.json();
  };
  try {
    const me = await call("getMe");
    if (!me.ok) {
      return json(200, { step: "getMe", result: me, hint: "Netlify'dagi BOT_TOKEN eskirgan. BotFather'dan yangi tokenni olib, BOT_TOKEN ni yangilang va Trigger deploy qiling." });
    }
    const hook = await call("setWebhook", {
      url: `${SITE}/.netlify/functions/bot`,
      secret_token: SECRET,
      allowed_updates: ["message", "callback_query", "my_chat_member", "chat_member"],
    });
    return json(200, { bot: me.result.username, webhook: hook });
  } catch (e) {
    return json(500, { error: String(e) });
  }
};
