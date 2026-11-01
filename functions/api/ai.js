// Reads a scoresheet photo or pasted Spond text with Claude.
// Optional. Needs these environment variables (Pages > Settings > Variables):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (to check the caller is team staff)
//   ANTHROPIC_API_KEY                         (from console.anthropic.com; set as an encrypted variable)
//   CLAUDE_MODEL                              (optional; defaults below)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function onRequestGet({ env }) {
  return json({ enabled: !!env.ANTHROPIC_API_KEY });
}

export async function onRequestPost({ request, env }) {
  if (!env.ANTHROPIC_API_KEY) return json({ error: "Photo and Spond reading are turned off. Add ANTHROPIC_API_KEY in Cloudflare to turn them on." }, 501);
  const base = (env.SUPABASE_URL || "").replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !base) return json({ error: "Sign in first." }, 401);
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json({ error: "Your sign-in expired. Sign in again." }, 401);
  const caller = await who.json();

  let body; try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const h = { apikey: svc, Authorization: `Bearer ${svc}` };
  const sa = await (await fetch(`${base}/rest/v1/site_admins?user_id=eq.${caller.id}&select=user_id`, { headers: h })).json();
  const mem = await (await fetch(`${base}/rest/v1/memberships?user_id=eq.${caller.id}&team_id=eq.${encodeURIComponent(body.team_id || "")}&role=in.(admin,scorekeeper)&select=user_id`, { headers: h })).json();
  if (!sa.length && !mem.length) return json({ error: "Only coaches and scorekeepers can use this." }, 403);

  const content = [];
  if (body.image) {
    if (body.image.length > 7_000_000) return json({ error: "That photo is too large. Try a smaller one." }, 400);
    content.push({ type: "image", source: { type: "base64", media_type: body.media_type || "image/jpeg", data: body.image } });
  }
  content.push({ type: "text", text: String(body.prompt || "").slice(0, 20000) });

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.CLAUDE_MODEL || "claude-sonnet-5-5", max_tokens: 4000, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) return json({ error: `Claude couldn't read it (${r.status}).` }, 502);
  const out = await r.json();
  const text = (out.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return json({ error: "Claude's answer wasn't readable. Try again." }, 502);
  try { return json({ data: JSON.parse(m[0]) }); } catch { return json({ error: "Claude's answer wasn't readable. Try again." }, 502); }
}
