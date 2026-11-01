// Schedule sync from any calendar link: TeamSnap, GameChanger, SportsEngine, TeamReach, Google Calendar, etc.
// The coach pastes the team's "subscribe" / iCal link once in Admin; the Worker re-reads it every 2 hours
// (same timer as Spond) and adds, updates, cancels or removes games to match.
//
// The link itself is kept in a private storage file only the server can read (a TeamSnap link can
// show practices and notes), so it never reaches the public site. No database changes needed.
//
// Games only, like the Spond sync: practices, meetings, and similar entries are skipped.
// A game marked final on the site is never changed by a sync.

import { parseEvent } from "./spond.js";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const enc = encodeURIComponent;

function db(env) {
  const base = env.SUPABASE_URL.replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: svc, ...(svc.startsWith("eyJ") ? { Authorization: `Bearer ${svc}` } : {}), "content-type": "application/json" };
  return async (path, init = {}) => {
    const r = await fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers || {}) } });
    if (!r.ok) throw new Error(`Database error ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const t = await r.text(); return t ? JSON.parse(t) : null;
  };
}

// Accept webcal:// links (what TeamSnap and iPhones hand out) and plain https.
export function cleanUrl(u) {
  let s = String(u || "").trim();
  if (/^webcals?:\/\//i.test(s)) s = s.replace(/^webcals?:\/\//i, "https://");
  let url; try { url = new URL(s); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(url.hostname)) return null;
  if (url.protocol === "http:") url.protocol = "https:";
  return url.toString();
}

// A friendly name for where the link comes from, shown on the schedule.
export function sourceName(u) {
  const h = (() => { try { return new URL(u).hostname; } catch { return ""; } })();
  if (/teamsnap/i.test(h)) return "TeamSnap";
  if (/gc\.com|gamechanger/i.test(h)) return "GameChanger";
  if (/sportsengine|sportngin/i.test(h)) return "SportsEngine";
  if (/google/i.test(h)) return "Google Calendar";
  if (/teamreach/i.test(h)) return "TeamReach";
  if (/leagueapps/i.test(h)) return "LeagueApps";
  if (/heja/i.test(h)) return "Heja";
  if (/outlook|office|live\.com/i.test(h)) return "Outlook";
  return h.replace(/^www\./, "") || "calendar link";
}

const unesc = (s) => String(s || "").replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

// Minimal iCalendar reader: VEVENTs with UID, SUMMARY, DTSTART, LOCATION, STATUS.
export function parseIcs(text) {
  const lines = String(text).replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "").split(/\r?\n/);
  const out = []; let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";");
    const val = line.slice(i + 1), key = name.toUpperCase();
    const p = Object.fromEntries(params.map((x) => x.split("=")).map(([a, b]) => [String(a).toUpperCase(), String(b || "").replace(/"/g, "")]));
    if (key === "DTSTART") cur.start = { val, tzid: p.TZID, date: p.VALUE === "DATE" || /^\d{8}$/.test(val) };
    else if (["UID", "SUMMARY", "LOCATION", "STATUS", "DESCRIPTION"].includes(key)) cur[key.toLowerCase()] = unesc(val);
  }
  return out;
}

// Wall-clock time in a time zone -> real moment (for TZID=... start times).
function zonedToDate(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(guess)).map((x) => [x.type, +x.value || x.value]));
  const asIf = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute);
  return new Date(guess - (asIf - guess));
}

// One calendar entry -> game row (or null for practices etc.), reusing the Spond title rules.
export function toGame(ev, tz, teamName) {
  if (!ev.start || !ev.summary) return null;
  const m = ev.start.val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, , z] = m;
  const cancelled = /^cancel/i.test(ev.status || "") || /\b(cancel+ed|rained out|rainout)\b/i.test(ev.summary);
  const heading = ev.summary.replace(/^\s*(cancel+ed|postponed|rained out)\s*[:\-–]\s*/i, "");
  if (ev.start.date || !hh) {
    // All-day entry: no time.
    const g = parseEvent({ id: ev.uid, heading, startTimestamp: `${y}-${mo}-${d}T12:00:00Z`, location: { feature: ev.location } }, "UTC", teamName);
    return g && tidy({ ...g, date: `${y}-${mo}-${d}`, time: "", cancelled });
  }
  const when = z ? new Date(Date.UTC(+y, mo - 1, +d, +hh, +mi)) : ev.start.tzid ? zonedToDate(+y, +mo, +d, +hh, +mi, ev.start.tzid) : zonedToDate(+y, +mo, +d, +hh, +mi, tz);
  const g = parseEvent({ id: ev.uid, heading, startTimestamp: when.toISOString(), location: { feature: ev.location } }, tz, teamName);
  return g && tidy({ ...g, cancelled, postponed: /^postponed/i.test(ev.summary) });
}
// "National City (Away)" -> opponent "National City", away game.
function tidy(g) {
  const m = g.opp.match(/\s*[([]\s*(home|away)\s*[)\]]\s*$/i);
  if (m) { g.opp = g.opp.slice(0, m.index).trim(); g.home = m[1].toLowerCase() === "home"; }
  return g;
}

export async function fetchFeed(url) {
  const r = await fetch(url, { headers: { accept: "text/calendar, text/plain, */*", "user-agent": "TeamSite-ScheduleSync/1.0" }, redirect: "follow", cf: { cacheTtl: 0 } });
  if (!r.ok) throw new Error(`That calendar link answered ${r.status}. Copy the link again from the app.`);
  const text = (await r.text()).slice(0, 3_000_000);
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("That link isn't a calendar feed. In TeamSnap use Schedule, Settings, Sync Calendar / Export, and copy that link.");
  return text;
}

// Settings live in a small private file in the "media" storage bucket: _sync/<team>.json.
// Storage rules only let team staff read files under their own team's folder, so only the server
// (secret key) can read these. No database changes needed.
function store(env) {
  const base = env.SUPABASE_URL.replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: svc, ...(svc.startsWith("eyJ") ? { Authorization: `Bearer ${svc}` } : {}) };
  const obj = (team) => `${base}/storage/v1/object/media/_sync/${enc(team)}.json`;
  return {
    get: async (team) => { const r = await fetch(obj(team), { headers: h }); return r.ok ? r.json().catch(() => null) : null; },
    put: async (team, data) => {
      const r = await fetch(obj(team), { method: "POST", headers: { ...h, "content-type": "application/json", "x-upsert": "true", "cache-control": "no-cache" }, body: JSON.stringify(data) });
      if (!r.ok) throw new Error(`Couldn't save the calendar link (${r.status}).`);
    },
    del: async (team) => { await fetch(obj(team), { method: "DELETE", headers: h }); },
    list: async () => {
      const r = await fetch(`${base}/storage/v1/object/list/media`, { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ prefix: "_sync/", limit: 200 }) });
      return r.ok ? (await r.json()).map((f) => String(f.name || "").replace(/\.json$/, "")).filter(Boolean) : [];
    },
  };
}

// Synced games reuse the games.spond_id column (already unique) with an "ics:<team>:" prefix.
export async function syncTeam(env, team) {
  const q = db(env), tz = env.SPOND_TIMEZONE || "America/Los_Angeles";
  const events = parseIcs(await fetchFeed(team.ics_url));
  const from = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);
  const prefix = `ics:${team.id}:`;
  const games = events.map((e) => ({ e, g: e.uid ? toGame(e, tz, team.name || "") : null })).filter((x) => x.g && x.g.date >= from);
  const existing = await q(`games?team_id=eq.${enc(team.id)}&spond_id=like.${enc(prefix + "*")}&select=id,spond_id,status,date`);
  const byId = Object.fromEntries(existing.map((g) => [g.spond_id, g]));
  const seen = new Set();
  const live = [], dead = [];
  let added = 0, updated = 0, cancelled = 0;
  for (const { g } of games) {
    const ext = (prefix + g.spond_id).slice(0, 300); seen.add(ext);
    const had = byId[ext];
    if (had && had.status === "final") continue;
    const row = { team_id: team.id, spond_id: ext, date: g.date, time: g.time, opp: g.opp, home: g.home, loc: g.loc };
    if (g.cancelled || g.postponed) { dead.push({ ...row, status: g.cancelled ? "cancelled" : "postponed", had }); cancelled++; }
    else { live.push({ ...row, status: "scheduled" }); had ? updated++ : added++; }
  }
  const upsert = (rows) => rows.length && q("games?on_conflict=spond_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  await upsert(live);
  try { await upsert(dead.map(({ had, ...r }) => r)); }
  catch { // Older databases don't allow a "cancelled" status yet: drop those games instead.
    const ids = dead.filter((d) => d.had).map((d) => d.had.id);
    if (ids.length) await q(`games?id=in.(${ids.map(enc).join(",")})`, { method: "DELETE" });
  }
  // Upcoming games that were deleted in the other app come off the schedule too.
  const gone = existing.filter((g) => !seen.has(g.spond_id) && g.status !== "final" && g.date >= today).map((g) => g.id);
  if (gone.length) await q(`games?id=in.(${gone.map(enc).join(",")})`, { method: "DELETE" });
  await store(env).put(team.id, { url: team.ics_url, source: sourceName(team.ics_url), synced_at: new Date().toISOString() });
  return { added, updated, removed: gone.length, cancelled, skipped: events.length - games.length };
}

// Runs on the 2-hour timer.
export async function scheduled(env) {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) return;
  const q = db(env), st = store(env);
  const ids = await st.list();
  for (const id of ids) {
    try {
      const cfg = await st.get(id); if (!cfg || !cfg.url) continue;
      const name = ((await q(`teams?id=eq.${enc(id)}&select=name`))[0] || {}).name || "";
      await syncTeam(env, { id, name, ics_url: cfg.url });
    } catch (e) { console.log("Calendar sync failed for", id, e.message); }
  }
}

// GET /api/calsync?team=<id>  -> {source, synced_at} for the schedule line (never the link itself).
export async function onRequestGet({ request, env }) {
  const team = new URL(request.url).searchParams.get("team") || "";
  if (!/^[a-z0-9-]{1,60}$/.test(team) || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({});
  const cfg = await store(env).get(team);
  return new Response(JSON.stringify(cfg && cfg.url ? { source: cfg.source || sourceName(cfg.url), synced_at: cfg.synced_at || null } : {}),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

// POST /api/calsync  {action: "set" | "sync", team_id, url?}
export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "The server isn't configured yet." }, 501);
  const base = env.SUPABASE_URL.replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json({ error: "Your sign-in expired. Sign in again." }, 401);
  const caller = await who.json();
  let body; try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const q = db(env), st = store(env), team_id = String(body.team_id || "");
  const sa = (await q(`site_admins?user_id=eq.${caller.id}&select=user_id`)).length > 0;
  const mem = await q(`memberships?user_id=eq.${caller.id}&team_id=eq.${enc(team_id)}&select=role`);
  const role = sa ? "admin" : (mem[0] && mem[0].role);
  if (!["admin", "coach", "scorekeeper"].includes(role)) return json({ error: "Only coaches and scorekeepers can do this." }, 403);

  try {
    const team = (await q(`teams?id=eq.${enc(team_id)}&select=id,name`))[0];
    if (!team) return json({ error: "Team not found." }, 404);
    if (body.action === "set") {
      if (!["admin", "coach"].includes(role)) return json({ error: "Only coaches and admins can connect a calendar." }, 403);
      if (!body.url) { await st.del(team_id); return json({ ok: true }); }
      const url = cleanUrl(body.url);
      if (!url) return json({ error: "That doesn't look like a calendar link. It should start with https:// or webcal://." }, 400);
      await fetchFeed(url); // check it works before saving
      await st.put(team_id, { url, source: sourceName(url), synced_at: null });
      return json({ ok: true, source: sourceName(url), result: await syncTeam(env, { ...team, ics_url: url }) });
    }
    if (body.action === "sync") {
      const cfg = await st.get(team_id);
      if (!cfg || !cfg.url) return json({ error: "Connect a calendar link in Admin first." }, 400);
      return json({ ok: true, result: await syncTeam(env, { ...team, ics_url: cfg.url }) });
    }
  } catch (e) {
    return json({ error: String(e.message || "") || "Calendar sync failed." }, 502);
  }
  return json({ error: "Unknown action." }, 400);
}
