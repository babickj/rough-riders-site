// Spond schedule sync.
// Spond has no official public API. This uses the same sign-in and events calls as the
// open-source Spond library (pypi.org/project/spond), so it can break if Spond changes them.
//
// Worker variables (Settings > Variables and Secrets):
//   SPOND_EMAIL, SPOND_PASSWORD  a Spond login that is a member of the team's group (type Secret)
//   SPOND_TIMEZONE               optional, defaults to America/Los_Angeles
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (already set for the admin features)

const SPOND = "https://api.spond.com/core/v1/";
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function spondLogin(env) {
  if (!env.SPOND_EMAIL || !env.SPOND_PASSWORD) throw new Error("Spond isn't connected yet. Add SPOND_EMAIL and SPOND_PASSWORD in Cloudflare.");
  const r = await fetch(SPOND + "auth2/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: env.SPOND_EMAIL, password: env.SPOND_PASSWORD }),
  });
  const j = await r.json().catch(() => ({}));
  const token = j && j.accessToken && j.accessToken.token;
  if (!token) throw new Error("Spond sign-in failed. Check SPOND_EMAIL and SPOND_PASSWORD in Cloudflare.");
  return token;
}
async function spondGet(token, path) {
  const r = await fetch(SPOND + path, { headers: { "content-type": "application/json", Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Spond answered ${r.status}.`);
  return r.json();
}

// Turn one Spond event into a game, or null for practices, meetings and cancelled events.
export function parseEvent(ev, tz, teamName = "") {
  const title = String(ev.heading || "").trim();
  if (!title || !ev.startTimestamp) return null;
  if (/\b(practice|practise|training|workout|meeting|party|picture|photo day|clinic|tryout|evaluation|scrimmage practice|batting cage)\b/i.test(title)) return null;
  const d = new Date(ev.startTimestamp);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(d).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute} ${parts.dayPeriod}`;
  let opp = title, home = true;
  const squash = (x) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const us = squash(teamName);
  // "Home Team – Away Team" style titles: drop our side, keep the opponent. Listed first = home.
  const sides = title.split(/\s+[–—-]\s+|\s+(?:vs\.?|v\.?|versus|@|at)\s+/i);
  const m = title.match(/(?:^|\s)(vs\.?|v\.?|versus|@|at)\s+(.+)$/i);
  if (us && sides.length === 2 && sides.some((x) => squash(x).includes(us))) {
    const ourIdx = squash(sides[0]).includes(us) ? 0 : 1;
    opp = sides[1 - ourIdx].trim();
    home = m && /^(@|at)$/i.test(m[1]) ? ourIdx === 1 : ourIdx === 0;
  } else if (m) { opp = m[2]; home = !/^(@|at)$/i.test(m[1]); }
  opp = opp.replace(/\s*[-–—|:]\s*(game|home|away)\b.*$/i, "").replace(/^(game|home game|away game)\s*[-–—:]?\s*/i, "").trim() || title;
  if (/\baway\b/i.test(title) && !m) home = false;
  const loc = (ev.location && (ev.location.feature || ev.location.address)) || "";
  return { spond_id: String(ev.id), date, time, opp: opp.slice(0, 80), home, loc: String(loc).slice(0, 120), cancelled: !!ev.cancelled };
}

function db(env) {
  const base = env.SUPABASE_URL.replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: svc, ...(svc.startsWith("eyJ") ? { Authorization: `Bearer ${svc}` } : {}), "content-type": "application/json" };
  return async (path, init = {}) => {
    const r = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`Database error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  };
}

export async function syncTeam(env, team, token) {
  const q = db(env), tz = env.SPOND_TIMEZONE || "America/Los_Angeles";
  if (!team.name) team.name = ((await q(`teams?id=eq.${encodeURIComponent(team.id)}&select=name`))[0] || {}).name || "";
  token = token || await spondLogin(env);
  const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10) + "T00:00:00.000Z";
  const events = await spondGet(token, `sponds/?max=500&scheduled=true&includeHidden=false&groupId=${encodeURIComponent(team.spond_group)}&minStartTimestamp=${from}`) || [];
  const games = events.map((e) => parseEvent(e, tz, team.name)).filter(Boolean);
  const existing = await q(`games?team_id=eq.${encodeURIComponent(team.id)}&spond_id=not.is.null&select=id,spond_id,status`);
  const byId = Object.fromEntries(existing.map((g) => [g.spond_id, g]));
  let added = 0, updated = 0, removed = 0;
  const upserts = [];
  for (const g of games) {
    const had = byId[g.spond_id];
    if (g.cancelled) {
      if (had && had.status !== "final") { await q(`games?id=eq.${had.id}`, { method: "DELETE" }); removed++; }
      continue;
    }
    upserts.push({ team_id: team.id, spond_id: g.spond_id, date: g.date, time: g.time, opp: g.opp, home: g.home, loc: g.loc });
    had ? updated++ : added++;
  }
  if (upserts.length)
    await q("games?on_conflict=spond_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(upserts) });
  await q(`teams?id=eq.${encodeURIComponent(team.id)}`, { method: "PATCH", body: JSON.stringify({ spond_synced_at: new Date().toISOString() }) });
  return { added, updated, removed, skipped: events.length - games.length };
}

// Runs on the Worker's schedule (see wrangler.jsonc "triggers").
export async function scheduled(env) {
  if (!env.SPOND_EMAIL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const q = db(env);
  const teams = await q("teams?spond_group=not.is.null&select=id,spond_group");
  if (!teams.length) return;
  const token = await spondLogin(env);
  for (const t of teams) { try { await syncTeam(env, t, token); } catch (e) { console.log("Spond sync failed for", t.id, e.message); } }
}

// POST /api/spond  {action: "groups" | "set_group" | "sync", team_id, group_id?, group_name?}
export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "The server isn't configured yet." }, 501);
  const base = env.SUPABASE_URL.replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json({ error: "Your sign-in expired. Sign in again." }, 401);
  const caller = await who.json();
  let body; try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const q = db(env), team_id = String(body.team_id || "");
  const sa = (await q(`site_admins?user_id=eq.${caller.id}&select=user_id`)).length > 0;
  const mem = await q(`memberships?user_id=eq.${caller.id}&team_id=eq.${encodeURIComponent(team_id)}&select=role`);
  const role = sa ? "admin" : (mem[0] && mem[0].role);
  if (!["admin", "coach", "scorekeeper"].includes(role)) return json({ error: "Only coaches and scorekeepers can do this." }, 403);

  try {
    if (body.action === "groups") {
      if (role !== "admin") return json({ error: "Only admins can connect Spond." }, 403);
      const groups = await spondGet(await spondLogin(env), "groups/");
      return json({ groups: (groups || []).map((g) => ({ id: g.id, name: g.name, subgroups: (g.subGroups || []).map((s) => s.name) })) });
    }
    if (body.action === "set_group") {
      if (role !== "admin") return json({ error: "Only admins can connect Spond." }, 403);
      await q(`teams?id=eq.${encodeURIComponent(team_id)}`, { method: "PATCH", body: JSON.stringify({ spond_group: body.group_id || null, spond_group_name: body.group_name || null }) });
      if (!body.group_id) return json({ ok: true });
      const team = (await q(`teams?id=eq.${encodeURIComponent(team_id)}&select=id,spond_group`))[0];
      return json({ ok: true, result: await syncTeam(env, team) });
    }
    if (body.action === "sync") {
      const team = (await q(`teams?id=eq.${encodeURIComponent(team_id)}&select=id,spond_group`))[0];
      if (!team || !team.spond_group) return json({ error: "Pick the team's Spond group in Admin first." }, 400);
      return json({ ok: true, result: await syncTeam(env, team) });
    }
  } catch (e) {
    return json({ error: e.message || "Spond sync failed." }, 502);
  }
  return json({ error: "Unknown action." }, 400);
}
