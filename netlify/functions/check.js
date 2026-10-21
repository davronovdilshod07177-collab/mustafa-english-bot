// netlify/functions/check.js
// Verifies Telegram Mini App initData on the server, then returns the user's role and channel membership.
const crypto = require("crypto");

const TOKEN = process.env.BOT_TOKEN;
const CHANNEL = process.env.CHANNEL || "@Ieltswithmustaffa";
const ADMIN_IDS = (process.env.ADMIN_IDS || "5456493265")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const JSON_HEADERS = { "Content-Type": "application/json" };

function verifyInitData(initData) {
  if (!TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(TOKEN)
    .digest();
  const calc = crypto
    .createHmac("sha256", secret)
    .update(dataCheck)
    .digest("hex");
  const a = Buffer.from(calc);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  const user = JSON.parse(params.get("user") || "null");
  return user && user.id ? user : null;
}

async function isSubscribed(userId) {
  const r = await fetch(`https://api.telegram.org/bot${TOKEN}/getChatMember`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ chat_id: CHANNEL, user_id: userId }),
  });
  const j = await r.json();
  return (
    j.ok && ["creator", "administrator", "member"].includes(j.result.status)
  );
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false }),
    };
  }
  try {
    const { initData } = JSON.parse(event.body || "{}");
    const user = verifyInitData(initData);
    if (!user) {
      return {
        statusCode: 401,
        headers: JSON_HEADERS,
        body: JSON.stringify({ ok: false, error: "invalid" }),
      };
    }
    const isAdmin = ADMIN_IDS.includes(String(user.id));
    const subscribed = await isSubscribed(user.id);
    return {
      statusCode: 200,
      headers: JSON_HEADERS,
      body: JSON.stringify({
        ok: true,
        role: isAdmin ? "admin" : "member",
        subscribed,
        link: "https://t.me/" + CHANNEL.replace("@", ""),
      }),
    };
  } catch (e) {
    console.error("check error", e);
    return {
      statusCode: 500,
      headers: JSON_HEADERS,
      body: JSON.stringify({ ok: false }),
    };
  }
};
