// AI for coaches: scoresheet photos, Spond text, player reports, clip review, game plans.
//
// Uses Cloudflare Workers AI by default (free daily allowance, no key needed; the "AI" binding in
// wrangler.jsonc). If ANTHROPIC_API_KEY is set, uses Claude instead, which is stronger, especially on video.
//
// Worker variables (Settings > Variables and Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   to check the caller is team staff (a secret key, sb_secret_...)
//   ANTHROPIC_API_KEY                         optional, switches to Claude (type Secret)
//   CLAUDE_MODEL                              optional, defaults below
//   CF_TEXT_MODEL, CF_VISION_MODEL            optional Workers AI model overrides

const CLAUDE_DEFAULT = "claude-sonnet-5-5";
const CF_TEXT_DEFAULT = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const CF_VISION_DEFAULT = "@cf/meta/llama-3.2-11b-vision-instruct";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const provider = (env) => (env.ANTHROPIC_API_KEY ? "claude" : env.AI ? "cloudflare" : null);

export async function onRequestGet({ env }) {
  const p = provider(env);
  // multi_image: whether several images can go in one request (Claude yes; the free vision model takes one).
  return json({ enabled: !!p, provider: p, multi_image: p === "claude" });
}

function parseJson(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function askClaude(env, prompt, images) {
  const content = [];
  for (const im of images) {
    if (im.label) content.push({ type: "text", text: String(im.label).slice(0, 200) });
    content.push({ type: "image", source: { type: "base64", media_type: im.media_type || "image/jpeg", data: im.data } });
  }
  content.push({ type: "text", text: prompt });
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || CLAUDE_DEFAULT, max_tokens: 4000, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(`The AI service answered ${r.status}.`);
  const out = await r.json();
  return (out.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
}

const SYSTEM = "You are a careful assistant for a youth baseball coaching staff. Answer with a single valid JSON object and nothing else: no markdown, no code fences, no comments.";

async function askCloudflare(env, prompt, images) {
  const text = (r) => (typeof r?.response === "string" ? r.response : r?.response ? JSON.stringify(r.response) : r?.result || "");
  if (!images.length) {
    const r = await env.AI.run(env.CF_TEXT_MODEL || CF_TEXT_DEFAULT, {
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }],
      max_tokens: 2500, temperature: 0.3,
    });
    return text(r);
  }
  // The free vision model takes one image per request; the site sends clips as a single contact sheet.
  const im = images[0];
  const model = env.CF_VISION_MODEL || CF_VISION_DEFAULT;
  const input = {
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content: (im.label ? im.label + "\n\n" : "") + prompt }],
    image: `data:${im.media_type || "image/jpeg"};base64,${im.data}`,
    max_tokens: 2000, temperature: 0.3,
  };
  try {
    return text(await env.AI.run(model, input));
  } catch (e) {
    // Meta's license for this model has to be accepted once per Cloudflare account.
    if (!/agree|licen[cs]e|5016/i.test(String(e && e.message || e))) throw e;
    await env.AI.run(model, { prompt: "agree" });
    return text(await env.AI.run(model, input));
  }
}

export async function onRequestPost({ request, env }) {
  const p = provider(env);
  if (!p) return json({ error: "AI is turned off for this site." }, 501);
  const base = (env.SUPABASE_URL || "").replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !base) return json({ error: "Sign in first." }, 401);
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json({ error: "Your sign-in expired. Sign in again." }, 401);
  const caller = await who.json();

  let body; try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const h = { apikey: svc, ...(svc.startsWith("eyJ") ? { Authorization: `Bearer ${svc}` } : {}) };
  const sa = await (await fetch(`${base}/rest/v1/site_admins?user_id=eq.${caller.id}&select=user_id`, { headers: h })).json();
  const mem = await (await fetch(`${base}/rest/v1/memberships?user_id=eq.${caller.id}&team_id=eq.${encodeURIComponent(body.team_id || "")}&role=in.(admin,coach,scorekeeper)&select=user_id`, { headers: h })).json();
  if (!sa.length && !mem.length) return json({ error: "Only coaches and scorekeepers can use this." }, 403);

  const images = (Array.isArray(body.images) ? body.images : body.image ? [{ data: body.image, media_type: body.media_type }] : [])
    .map((im) => ({ data: String(im.data || ""), media_type: im.media_type, label: im.label }));
  if (images.length > 16) return json({ error: "Send at most 16 images at a time." }, 400);
  let total = 0;
  for (const im of images) {
    total += im.data.length;
    if (im.data.length > 7_000_000 || total > 20_000_000) return json({ error: "Those images are too large. Try fewer or smaller ones." }, 400);
  }
  if (p === "cloudflare" && images.length > 1) return json({ error: "The free AI model looks at one image at a time." }, 400);
  const prompt = String(body.prompt || "").slice(0, p === "claude" ? 60000 : 40000);

  try {
    return json({ data: await runAI(env, prompt, images), provider: p });
  } catch (e) {
    return json({ error: e.message }, e.status || 502);
  }
}

// Shared by the write-up code: ask the configured model and return parsed JSON, or throw a friendly error.
export async function runAI(env, prompt, images = []) {
  const p = provider(env);
  if (!p) throw Object.assign(new Error("AI is turned off for this site."), { status: 501 });
  const ask = p === "claude" ? askClaude : askCloudflare;
  try {
    // One retry if the answer isn't clean JSON (smaller models sometimes add extra text).
    let data = parseJson(await ask(env, prompt, images));
    if (!data) data = parseJson(await ask(env, prompt + "\n\nReturn only the JSON object.", images));
    if (!data) throw Object.assign(new Error("The AI's answer wasn't readable. Try again."), { status: 502 });
    return data;
  } catch (e) {
    if (e.status) throw e;
    const msg = String(e && e.message || e);
    if (/daily|quota|neuron|limit|4006/i.test(msg)) throw Object.assign(new Error("Today's free AI allowance is used up. It resets at 4 or 5 PM Pacific."), { status: 429 });
    throw Object.assign(new Error("The AI couldn't finish that. Try again in a minute."), { status: 502 });
  }
}
export { provider };
