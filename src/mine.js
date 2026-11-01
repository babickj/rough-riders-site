// A player's own photos and videos, for the player and their linked parent.
// POST /api/mine {team_id} -> {media: [...], urls: {path: signedUrl}}
// The server checks the caller is linked to a player on that team, then returns only media tagged with that player.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const enc = encodeURIComponent;

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "The site isn't configured yet." }, 501);
  const base = env.SUPABASE_URL.replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: svc, ...(svc.startsWith("eyJ") ? { Authorization: `Bearer ${svc}` } : {}), "content-type": "application/json" };
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json({ error: "Your sign-in expired. Sign in again." }, 401);
  const caller = await who.json();
  let body; try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const team = String(body.team_id || "");

  const m = await fetch(`${base}/rest/v1/memberships?user_id=eq.${caller.id}&team_id=eq.${enc(team)}&role=in.(player,parent)&select=player_id`, { headers: h });
  const pid = m.ok ? ((await m.json())[0] || {}).player_id : null;
  if (!pid) return json({ media: [], urls: {} });

  const r = await fetch(`${base}/rest/v1/media?team_id=eq.${enc(team)}&players=cs.${enc("{" + pid + "}")}&select=id,kind,path,url,caption,game_id,mime,players,team_tag,created_at&order=created_at.desc&limit=200`, { headers: h });
  const media = r.ok ? await r.json() : [];
  const paths = media.filter((x) => x.path).map((x) => x.path), urls = {};
  for (let i = 0; i < paths.length; i += 100) {
    const s = await fetch(`${base}/storage/v1/object/sign/media`, { method: "POST", headers: h, body: JSON.stringify({ expiresIn: 3600, paths: paths.slice(i, i + 100) }) });
    if (!s.ok) continue;
    for (const d of await s.json()) {
      const u = d.signedURL || d.signedUrl;
      if (u && d.path) urls[d.path] = `${base}/storage/v1${u.startsWith("/") ? u : "/" + u}`;
    }
  }
  // Only this player's tag goes back, not teammates' ids.
  return json({ media: media.map((x) => ({ ...x, players: [pid] })), urls });
}
