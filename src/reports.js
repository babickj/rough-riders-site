// Living player write-ups, season deep dives, and team reviews.
// POST /api/report {action: "refresh" | "deep_dive" | "team", team_id, player_id?}   (coaches and admins)
// Also runs nightly (see wrangler.jsonc) to refresh write-ups for players with new data.
import { runAI } from "./ai.js";

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

// ---------- stat helpers (same math as the site) ----------
const BAT = ["ab", "r", "h", "d", "t", "hr", "rbi", "bb", "so", "hbp", "sb"];
const n = (x) => +x || 0;
const r3 = (x) => (typeof x === "number" && isFinite(x) ? +x.toFixed(3) : null);
const outsToIp = (o) => Math.floor(o / 3) + "." + (o % 3);
function aggBat(rows) {
  const x = { g: 0 }; for (const k of BAT) x[k] = 0;
  for (const r of rows) if (r.bat) { x.g++; for (const k of BAT) x[k] += n(r.bat[k]); }
  if (!x.g) return null;
  const pa = x.ab + x.bb + x.hbp, tb = x.h + x.d + 2 * x.t + 3 * x.hr;
  return { ...x, pa, avg: r3(x.ab ? x.h / x.ab : NaN), obp: r3(pa ? (x.h + x.bb + x.hbp) / pa : NaN), slg: r3(x.ab ? tb / x.ab : NaN) };
}
function aggPit(rows, innings) {
  const x = { g: 0, outs: 0, pc: 0, h: 0, r: 0, er: 0, bb: 0, so: 0 };
  for (const r of rows) if (r.pit) { x.g++; for (const k of Object.keys(x)) if (k !== "g") x[k] += n(r.pit[k]); }
  if (!x.g) return null;
  const ip = x.outs / 3;
  return { ...x, ip: outsToIp(x.outs), era: r3(ip ? (x.er * innings) / ip : NaN), whip: r3(ip ? (x.bb + x.h) / ip : NaN) };
}
function aggFld(rows) {
  const x = { g: 0, po: 0, a: 0, e: 0 };
  for (const r of rows) if (r.fld) { x.g++; for (const k of ["po", "a", "e"]) x[k] += n(r.fld[k]); }
  return x.g ? x : null;
}
const LL_REST = [[66, 4], [51, 3], [36, 2], [21, 1]];
const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "focus";

const COACH_RULES = `Rules: Base every point on the data provided and cite numbers where you can. Say plainly when there is too little data to judge. This is a young athlete, so be specific, encouraging, and constructive. Never comment on body shape, weight, or appearance, and make no medical or injury claims. Respect the team's pitch-count limits and rest rules; never suggest exceeding them. Drills must be safe, age-appropriate, and doable at a normal practice. Coach edits and coach comments are ground truth: never contradict a coach's correction; build on it.`;

// ---------- gather everything about one player ----------
async function playerBundle(env, teamId, playerId) {
  const q = db(env), t = enc(teamId), p = enc(playerId);
  const [teams, players, games, lines, outside, metrics, notes, clips, versions, media] = await Promise.all([
    q(`teams?id=eq.${t}&select=*`),
    q(`players?id=eq.${p}&team_id=eq.${t}&select=*`),
    q(`games?team_id=eq.${t}&select=id,date,opp,home,us,them,status`),
    q(`game_lines?team_id=eq.${t}&select=game_id,bat,pit,fld`),
    q(`player_games?player_id=eq.${p}&select=date,event,bat,pit,fld&order=date`),
    q(`player_metrics?player_id=eq.${p}&select=metric,unit,value,date,note&order=date`),
    q(`player_notes?player_id=eq.${p}&select=topic,body,created_at&order=created_at.desc&limit=30`),
    q(`ai_reports?player_id=eq.${p}&kind=eq.clip&select=id,media_id,output,comments,created_at&order=created_at.desc&limit=12`),
    q(`ai_reports?player_id=eq.${p}&kind=eq.player&status=neq.discarded&select=id,output,status,edited,comments,created_at,reviewed_at&order=created_at.desc&limit=40`),
    q(`media?team_id=eq.${t}&players=cs.%7B${p}%7D&select=id,kind,created_at`),
  ]);
  const team = teams[0], player = players[0];
  if (!team || !player) throw Object.assign(new Error("Player not found."), { status: 404 });
  const gById = Object.fromEntries(games.map((g) => [g.id, g]));
  const rows = [];
  for (const l of lines) {
    const g = gById[l.game_id]; if (!g) continue;
    const bat = (l.bat || {})[playerId], pit = (l.pit || {})[playerId], fld = (l.fld || {})[playerId];
    if (bat || pit || fld) rows.push({ kind: "team", date: g.date, game: `${g.home ? "vs" : "at"} ${g.opp}`, result: g.us != null ? `${g.us > g.them ? "W" : g.us < g.them ? "L" : "T"} ${g.us}-${g.them}` : null, bat, pit, fld });
  }
  for (const o of outside) rows.push({ kind: "outside", date: o.date, game: o.event, result: null, bat: o.bat, pit: o.pit, fld: o.fld });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const teamRows = rows.filter((r) => r.kind === "team"), innings = team.innings || 6;
  const months = {};
  for (const r of rows) (months[r.date.slice(0, 7)] = months[r.date.slice(0, 7)] || []).push(r);
  const tiers = Array.isArray(team.pitch_rest) && team.pitch_rest.length ? team.pitch_rest : LL_REST;
  const reviewed = versions.find((v) => v.status === "reviewed") || null;
  const ctx = {
    team: { name: team.name, league: team.league || "", season: team.season || "", innings_per_game: innings, daily_pitch_limit: team.pitch_max || 85, rest_rules: tiers.map(([a, b]) => `${a}+ pitches: ${b} days rest`) },
    today: new Date().toISOString().slice(0, 10),
    player: { first_name: player.name, jersey: player.num, primary_positions: player.pos_primary || [], backup_positions: player.pos_backup || [] },
    batting_team_games: aggBat(teamRows), batting_all_games: aggBat(rows),
    pitching_all_games: aggPit(rows, innings), fielding_all_games: aggFld(rows),
    by_month: Object.entries(months).map(([m, rs]) => ({ month: m, batting: aggBat(rs), pitching: aggPit(rs, innings) })),
    game_log: rows.slice(-20).map((r) => ({ date: r.date, game: r.game, outside_team: r.kind === "outside", result: r.result, batting: r.bat || null, pitching: r.pit ? { ...r.pit, ip: outsToIp(n(r.pit.outs)) } : null, fielding: r.fld || null })),
    measurements: metrics.map((m) => ({ metric: m.metric, unit: m.unit, value: +m.value, date: m.date, note: m.note || undefined })),
    coach_notes: notes.map((x) => ({ date: x.created_at.slice(0, 10), topic: x.topic, note: x.body })),
    clip_reviews: clips.map((c) => ({ clip_id: c.media_id, date: c.created_at.slice(0, 10), focus_area: c.output.focus_area, what_it_shows: c.output.what_it_shows, positives: c.output.positives, fixes: (c.output.focus || []).map((f) => f.title + ": " + (f.why || "")), confidence: c.output.confidence, coach_comments: (c.comments || []).map((k) => k.text) })),
    photos_and_clips_tagged: media.length,
  };
  const basis = { team_games: teamRows.length, outside_games: rows.length - teamRows.length, clip_reviews: clips.length, notes: notes.length, measurements: metrics.length, media: media.length, data_through: rows.length ? rows[rows.length - 1].date : null };
  return { team, player, ctx, basis, versions, reviewed, clips, hasData: rows.length + notes.length + clips.length + metrics.length > 0 };
}

const versionForPrompt = (v) => v && { date: v.created_at.slice(0, 10), status: v.status, coach_edited: !!v.edited, write_up: v.output, coach_comments: (v.comments || []).map((c) => c.text) };

// ---------- the three AI jobs ----------
async function writeUp(env, b) {
  const draft = b.versions[0] && b.versions[0].status === "draft" && (!b.reviewed || b.versions[0].created_at > b.reviewed.created_at) ? b.versions[0] : null;
  const out = await runAI(env, `You are an experienced youth baseball coach and player-development specialist helping a volunteer coaching staff keep a living development write-up for one player. Write the new version of the write-up using all of the data below.
${COACH_RULES}
Track focus areas across versions: reuse the exact "id" of every focus area in the current write-up. Give each open focus area a status of "new", "improving", or "still" (no clear change). Move finished ones to "resolved". Keep at most 3 open focus areas.
Use clip reviews as evidence: when a point comes from a clip review, add it to that item's "evidence" with the clip_id and date.
Return ONLY JSON with this shape: {"summary":"2-3 sentences","strengths":[{"title":"","detail":""}],"focus":[{"id":"short-id","title":"","status":"new|improving|still","why":"","drill":"","evidence":[{"date":"YYYY-MM-DD","clip_id":null,"note":""}]}],"resolved":[{"id":"","title":"","note":""}],"watch":[""],"changes":"what changed since the current write-up, or null if there isn't one","data_note":"one sentence on how much data this is based on"}. At most 3 strengths and 3 watch items.

CURRENT WRITE-UP (coach-reviewed): ${JSON.stringify(versionForPrompt(b.reviewed))}
UNREVIEWED DRAFT SINCE THEN: ${JSON.stringify(versionForPrompt(draft))}
DATA: ${JSON.stringify(b.ctx)}`);
  // Keep the structure tidy whatever the model returns.
  const clipIds = new Set(b.clips.map((c) => c.media_id));
  const st = new Set(["new", "improving", "still"]);
  out.focus = (Array.isArray(out.focus) ? out.focus : []).slice(0, 3).map((f) => ({
    id: slug(f.id || f.title), title: String(f.title || ""), status: st.has(f.status) ? f.status : "new", why: String(f.why || ""), drill: String(f.drill || ""),
    evidence: (Array.isArray(f.evidence) ? f.evidence : []).slice(0, 4).map((e) => ({ date: e.date || null, clip_id: clipIds.has(e.clip_id) ? e.clip_id : null, note: String(e.note || "") })),
  }));
  out.resolved = (Array.isArray(out.resolved) ? out.resolved : []).map((r) => ({ id: slug(r.id || r.title), title: String(r.title || ""), note: String(r.note || "") }));
  if (!out.summary) throw Object.assign(new Error("The AI's answer was incomplete. Try again."), { status: 502 });
  return out;
}

async function deepDive(env, b) {
  const versions = b.versions.slice().reverse().map(versionForPrompt);
  if (!versions.length) throw Object.assign(new Error("There are no write-ups to look back on yet. Make one first."), { status: 400 });
  return runAI(env, `You are an experienced youth baseball coach doing a season look-back for one player. Below is every version of the player's development write-up in date order (coach-reviewed ones are the most reliable), the clip reviews, and stats by month. Explain how each focus area has moved over time, what clearly worked, what hasn't budged despite the work, and what to try next.
${COACH_RULES}
Return ONLY JSON with this shape: {"headline":"one sentence","progress":[{"id":"","title":"","trajectory":"improved|steady|worse|resolved","detail":""}],"what_worked":[""],"not_moving":[{"title":"","try_instead":""}],"next_month":[""],"data_note":"one sentence"}. At most 6 progress items and 3 of each list.

WRITE-UP HISTORY: ${JSON.stringify(versions)}
CLIP REVIEWS: ${JSON.stringify(b.ctx.clip_reviews)}
STATS BY MONTH: ${JSON.stringify(b.ctx.by_month)}
MEASUREMENTS: ${JSON.stringify(b.ctx.measurements)}
PLAYER: ${JSON.stringify(b.ctx.player)} TEAM: ${JSON.stringify(b.ctx.team)}`);
}

async function teamReview(env, teamId) {
  const q = db(env), t = enc(teamId);
  const [teams, players, lines, reports] = await Promise.all([
    q(`teams?id=eq.${t}&select=*`),
    q(`players?team_id=eq.${t}&active=eq.true&select=id,name,num`),
    q(`game_lines?team_id=eq.${t}&select=bat,pit,fld`),
    q(`ai_reports?team_id=eq.${t}&kind=eq.player&status=neq.discarded&select=player_id,output,status,created_at&order=created_at.desc&limit=400`),
  ]);
  const team = teams[0];
  const latest = {};
  for (const r of reports) { const cur = latest[r.player_id]; if (!cur || (cur.status !== "reviewed" && r.status === "reviewed")) latest[r.player_id] = cur && cur.status === "reviewed" ? cur : r; }
  const sum = (key) => { const x = {}; for (const l of lines) for (const v of Object.values(l[key] || {})) for (const [k, val] of Object.entries(v)) x[k] = (x[k] || 0) + n(val); return x; };
  const write_ups = players.map((p) => { const r = latest[p.id]; return r ? { first_name: p.name, jersey: p.num, reviewed: r.status === "reviewed", summary: r.output.summary, focus: (r.output.focus || []).map((f) => `${f.title} (${f.status})`), resolved: (r.output.resolved || []).map((f) => f.title) } : { first_name: p.name, jersey: p.num, no_write_up_yet: true }; });
  if (!write_ups.some((w) => !w.no_write_up_yet)) throw Object.assign(new Error("Make a few player write-ups first; the team review reads them."), { status: 400 });
  return runAI(env, `You are an experienced youth baseball coach reviewing a whole team from the coaching staff's player write-ups and team totals. Find patterns that show up across several players and turn them into a practical plan for the next week of practice.
${COACH_RULES}
Return ONLY JSON with this shape: {"headline":"one sentence","strengths":[""],"weaknesses":[{"title":"","why":"","drill":""}],"practice_plan":[{"block":"","minutes":0,"what":""}],"spotlights":[{"first_name":"","note":""}],"data_note":"one sentence"}. At most 3 strengths, 3 weaknesses, 6 practice blocks for a 90-minute practice, and 4 spotlights.

TEAM: ${JSON.stringify({ name: team.name, league: team.league, season: team.season, innings_per_game: team.innings })}
TEAM BATTING TOTALS: ${JSON.stringify(sum("bat"))} TEAM PITCHING TOTALS: ${JSON.stringify(sum("pit"))} TEAM FIELDING TOTALS: ${JSON.stringify(sum("fld"))}
PLAYER WRITE-UPS: ${JSON.stringify(write_ups)}`);
}

async function save(env, row) {
  const rows = await db(env)("ai_reports", { method: "POST", headers: { Prefer: "return=representation" }, body: JSON.stringify(row) });
  return rows[0];
}

// ---------- HTTP ----------
export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "The server isn't configured yet." }, 501);
  const base = env.SUPABASE_URL.replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json({ error: "Your sign-in expired. Sign in again." }, 401);
  const caller = await who.json();
  let body; try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const q = db(env), teamId = String(body.team_id || "");
  const sa = (await q(`site_admins?user_id=eq.${caller.id}&select=user_id`)).length > 0;
  const mem = await q(`memberships?user_id=eq.${caller.id}&team_id=eq.${enc(teamId)}&select=role,display_name`);
  const role = sa ? "admin" : mem[0] && mem[0].role;
  if (role !== "admin" && role !== "coach") return json({ error: "Only coaches and admins can do this." }, 403);
  const by_name = (mem[0] && mem[0].display_name) || caller.email || "Coach";
  try {
    if (body.action === "team") {
      const out = await teamReview(env, teamId);
      return json({ report: await save(env, { team_id: teamId, kind: "team", output: out, ai_output: out, status: "reviewed", by_name, created_by: caller.id, source: "manual" }) });
    }
    const b = await playerBundle(env, teamId, String(body.player_id || ""));
    if (body.action === "refresh") {
      if (!b.hasData) return json({ error: "There's no data for this player yet. Enter a game, a note, or a clip first." }, 400);
      const out = await writeUp(env, b);
      return json({ report: await save(env, { team_id: teamId, kind: "player", player_id: b.player.id, output: out, ai_output: out, status: "draft", basis: b.basis, by_name, created_by: caller.id, source: "manual" }) });
    }
    if (body.action === "deep_dive") {
      const out = await deepDive(env, b);
      return json({ report: await save(env, { team_id: teamId, kind: "deepdive", player_id: b.player.id, output: out, ai_output: out, status: "reviewed", basis: b.basis, by_name, created_by: caller.id, source: "manual" }) });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: e.status ? e.message : "Couldn't make the write-up. Try again in a minute." }, e.status || 502);
  }
}

// ---------- nightly: refresh write-ups for players with new data ----------
export async function nightly(env, limit = 20) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return;
  const q = db(env);
  const players = await q("players?data_changed_at=not.is.null&active=eq.true&select=id,team_id,data_changed_at");
  if (!players.length) return;
  const reports = await q("ai_reports?kind=eq.player&status=neq.discarded&select=player_id,created_at&order=created_at.desc&limit=2000");
  const last = {};
  for (const r of reports) if (!last[r.player_id]) last[r.player_id] = r.created_at;
  const due = players.filter((p) => !last[p.id] || new Date(p.data_changed_at) > new Date(last[p.id])).slice(0, limit);
  const work = due.slice();
  const runOne = async () => {
    for (let p = work.shift(); p; p = work.shift()) {
      try {
        const b = await playerBundle(env, p.team_id, p.id);
        if (!b.hasData) continue;
        const out = await writeUp(env, b);
        await save(env, { team_id: p.team_id, kind: "player", player_id: p.id, output: out, ai_output: out, status: "draft", basis: b.basis, by_name: "Nightly update", source: "nightly" });
      } catch (e) {
        console.log("Nightly write-up failed for", p.id, e.message);
        if (e.status === 429) { work.length = 0; return; } // free allowance used up; try again tomorrow
      }
    }
  };
  await Promise.all([runOne(), runOne(), runOne()]);
}
