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
  // Anyone who said "going" to an upcoming game but isn't on the roster gets added.
  try {
    const now = Date.now();
    const accepted = events.filter((e) => !e.cancelled && Date.parse(e.startTimestamp) >= now - 864e5 && games.some((g) => g.spond_id === String(e.id)))
      .flatMap((e) => (e.responses && e.responses.acceptedIds) || []);
    if (accepted.length) {
      const [groups, players] = await Promise.all([spondGet(token, "groups/"), q(`players?team_id=eq.${encodeURIComponent(team.id)}&select=id,name,num,active`)]);
      const recips = { recipients: { group: { members: events.flatMap((e) => ((e.recipients || {}).group || {}).members || []) } } };
      await addAccepted(q, team.id, membersOf(groups, team.spond_group, recips), accepted, players);
    }
  } catch (e) { console.log("Adding Spond players failed for", team.id, e.message); }
  if (upserts.length)
    await q("games?on_conflict=spond_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(upserts) });
  await q(`teams?id=eq.${encodeURIComponent(team.id)}`, { method: "PATCH", body: JSON.stringify({ spond_synced_at: new Date().toISOString() }) });
  return { added, updated, removed, skipped: events.length - games.length };
}

// Who said they're coming to one Spond game, matched to the site's roster by name.
// Spond keeps answers as member ids; the group's member list gives their names.
const squash = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, "").replace(/\s+/g, " ").trim();
// Spond names often carry a jersey number and a nickname, sometimes all in one field:
// 'Peter Leree #7', 'Dylan “DJ” Lampert #11'. Pull those apart.
export function parseMember(m) {
  let t = `${m.firstName || ""} ${m.lastName || ""}`;
  const num = (t.match(/#\s*(\d{1,3})\b/) || [])[1];
  t = t.replace(/#\s*\d{1,3}\b/g, " ").replace(/\bno\.?\s*\d{1,3}\b/gi, " ");
  const nick = (t.match(/[“"(]([^”")]+)[”")]/) || [])[1];
  t = t.replace(/[“"(][^”")]*[”")]/g, " ").replace(/\s+/g, " ").trim();
  const words = t.split(" ").filter(Boolean), sq = words.map(squash).filter(Boolean);
  const first = sq[0] || "", last = sq.slice(1).join(" ");
  const shown = words.length ? `${words[0]}${words.length > 1 ? " " + words[words.length - 1][0].toUpperCase() + "." : ""}` : "";
  return { first, last, nick: squash(nick || ""), num: num ? +num : null, shown: shown.slice(0, 40) };
}
export function matchMembers(members, players) {
  const P = members.map((m) => ({ id: m.id, ...parseMember(m) }));
  const firstCount = {};
  for (const m of P) firstCount[m.first] = (firstCount[m.first] || 0) + 1;
  const pn = (p) => squash(String(p.name || "").replace(/#\s*\d{1,3}\b/g, " ").replace(/[“"(][^”")]*[”")]/g, " ")), pf = (p) => pn(p).split(" ")[0], pl = (p) => (pn(p).split(" ")[1] || "")[0] || "";
  const out = {};
  for (const m of P) {
    if (!m.first) continue;
    const full = `${m.first} ${m.last}`.trim(), li = m.last[0] || "";
    const one = (arr) => (arr.length === 1 ? arr[0] : null);
    const hit = players.find((p) => pn(p) === full)
      || (li && players.find((p) => pn(p) === `${m.first} ${li}`))
      || (m.nick && players.find((p) => [m.nick, `${m.nick} ${li}`.trim(), `${m.nick} ${m.last}`.trim()].includes(pn(p))))
      // Same jersey number, and the first name, nickname, or last initial agrees.
      || (m.num ? one(players.filter((p) => +p.num === m.num && (pf(p) === m.first || (m.nick && pf(p) === m.nick) || (li && pl(p) === li)))) : null)
      || (firstCount[m.first] === 1 ? players.find((p) => pn(p) === m.first) : null)
      || (firstCount[m.first] === 1 ? one(players.filter((p) => pf(p) === m.first)) : null);
    if (hit) out[m.id] = hit.id;
  }
  return out;
}
// Kids who say "going" in Spond but aren't on the site's roster yet get added to it (name as "First L.").
// A player a coach removed from the roster (inactive) is never re-added.
export async function addAccepted(q, teamId, members, acceptedIds, players) {
  const map = matchMembers(members, players);
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  // Fill in jersey numbers Spond knows about, and tidy names an earlier sync copied with the number or nickname in them.
  for (const [mid, pid] of Object.entries(map)) {
    const p = players.find((x) => x.id === pid), info = parseMember(byId[mid] || {}), fix = {};
    if (!p) continue;
    if (info.num != null && !(+p.num)) fix.num = info.num;
    if (/[#“”"]/.test(p.name || "") && info.shown) fix.name = info.shown;
    if (Object.keys(fix).length) { await q(`players?id=eq.${encodeURIComponent(pid)}`, { method: "PATCH", body: JSON.stringify(fix) }).catch(() => {}); Object.assign(p, fix); }
  }
  const fresh = [...new Set(acceptedIds)].filter((id) => !map[id] && byId[id] && parseMember(byId[id]).first);
  if (!fresh.length) return { map, added: [] };
  const rows = fresh.map((id) => { const i = parseMember(byId[id]); return { team_id: teamId, name: i.shown, num: i.num ?? 0, active: true }; });
  const added = await q("players", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(rows) }) || [];
  added.forEach((p, i) => { map[fresh[i]] = p.id; });
  await q("activity", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ team_id: teamId, by_name: "Spond sync", what: `Added ${added.map((p) => p.name).join(", ")} to the roster (said going in Spond)` }) }).catch(() => {});
  return { map, added };
}
const membersOf = (groups, groupId, ev) => {
  const group = (groups || []).find((g) => g.id === groupId) || {};
  const all = [...(group.members || []), ...(((ev && ev.recipients) || {}).group || {}).members || []];
  return Object.values(Object.fromEntries(all.map((m) => [m.id, m])));
};

async function rsvp(env, team, game, q) {
  const token = await spondLogin(env);
  const day = new Date(game.date + "T12:00:00Z");
  const from = new Date(day - 2 * 864e5).toISOString(), to = new Date(+day + 2 * 864e5).toISOString();
  const [events, groups, players] = await Promise.all([
    spondGet(token, `sponds/?max=100&scheduled=true&includeHidden=true&groupId=${encodeURIComponent(team.spond_group)}&minStartTimestamp=${from}&maxEndTimestamp=${to}`),
    spondGet(token, "groups/"),
    q(`players?team_id=eq.${encodeURIComponent(team.id)}&select=id,name,num,active`),
  ]);
  let ev = (events || []).find((e) => String(e.id) === String(game.spond_id));
  if (!ev) ev = ((await spondGet(token, `sponds/?max=500&scheduled=true&includeHidden=true&groupId=${encodeURIComponent(team.spond_group)}&minStartTimestamp=${from}`)) || []).find((e) => String(e.id) === String(game.spond_id));
  if (!ev) return { error: "Couldn't find this game in Spond anymore." };
  const members = membersOf(groups, team.spond_group, ev);
  const byId = Object.fromEntries(members.map((m) => [m.id, m]));
  const r = ev.responses || {};
  const { map, added } = await addAccepted(q, team.id, members, r.acceptedIds || [], players);
  const inactive = new Set(players.filter((p) => p.active === false).map((p) => p.id));
  const pick = (ids) => (ids || []).map((id) => map[id]).filter((id) => id && !inactive.has(id));
  const unmatched = [...(r.acceptedIds || []), ...(r.declinedIds || []), ...(r.unansweredIds || [])]
    .filter((id) => !map[id] && byId[id] && !(r.acceptedIds || []).includes(id)).map((id) => `${byId[id].firstName || ""} ${byId[id].lastName || ""}`.replace(/\s+/g, " ").trim());
  return { renamed: players.filter((p) => p.active !== false).map((p) => ({ id: p.id, name: p.name, num: p.num })), added: added.map((p) => ({ id: p.id, name: p.name, num: p.num, active: true, team_id: p.team_id })), going: pick(r.acceptedIds), not_going: pick(r.declinedIds), no_answer: pick([...(r.unansweredIds || []), ...(r.unconfirmedIds || [])]), waiting: pick(r.waitinglistIds), unmatched };
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
    if (body.action === "rsvp") {
      const game = (await q(`games?id=eq.${encodeURIComponent(String(body.game_id || ""))}&team_id=eq.${encodeURIComponent(team_id)}&select=id,date,spond_id`))[0];
      const team = (await q(`teams?id=eq.${encodeURIComponent(team_id)}&select=id,spond_group`))[0];
      if (!game || !game.spond_id || game.spond_id.startsWith("ics:") || !team || !team.spond_group) return json({ error: "This game didn't come from Spond." }, 400);
      return json(await rsvp(env, team, game, q));
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
