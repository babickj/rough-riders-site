// Public recruiting profile data for a share link: GET /api/recruit?t=<token>
// Only returns a profile a coach has turned on (family agreed). Nothing else about the team is exposed.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const enc = encodeURIComponent;
const n = (x) => +x || 0;
const r3 = (x) => (isFinite(x) ? +x.toFixed(3) : null);
const outsToIp = (o) => Math.floor(o / 3) + "." + (o % 3);

function db(env) {
  const base = env.SUPABASE_URL.replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: svc, ...(svc.startsWith("eyJ") ? { Authorization: `Bearer ${svc}` } : {}), "content-type": "application/json" };
  return {
    base, h,
    q: async (path) => {
      const r = await fetch(`${base}/rest/v1/${path}`, { headers: h });
      if (!r.ok) throw new Error(`Database error ${r.status}`);
      return r.json();
    },
  };
}

export async function onRequestGet({ request, env }) {
  const t = new URL(request.url).searchParams.get("t") || "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(t)) return json({ error: "This profile link isn't valid." }, 404);
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return json({ error: "The site isn't configured yet." }, 501);
  const { base, h, q } = db(env);
  const prof = (await q(`recruit_profiles?share_token=eq.${enc(t)}&enabled=eq.true&select=*`))[0];
  if (!prof) return json({ error: "This profile isn't available. The link may have been turned off." }, 404);
  const pid = prof.player_id, team = (await q(`teams?id=eq.${enc(prof.team_id)}&select=name,school,season,league,innings`))[0] || {};
  const player = (await q(`players?id=eq.${enc(pid)}&select=name,num`))[0] || {};

  let stats = null;
  if (prof.show_stats) {
    const [lines, outside] = await Promise.all([
      q(`game_lines?team_id=eq.${enc(prof.team_id)}&select=bat,pit,fld`),
      q(`player_games?player_id=eq.${enc(pid)}&select=bat,pit,fld`),
    ]);
    const rows = [...lines.map((l) => ({ bat: (l.bat || {})[pid], pit: (l.pit || {})[pid], fld: (l.fld || {})[pid] })), ...outside];
    const b = { g: 0, ab: 0, h: 0, d: 0, t: 0, hr: 0, rbi: 0, r: 0, bb: 0, so: 0, hbp: 0, sb: 0 };
    const p = { g: 0, outs: 0, pc: 0, h: 0, er: 0, bb: 0, so: 0 };
    const f = { g: 0, po: 0, a: 0, e: 0 };
    for (const r of rows) {
      if (r.bat) { b.g++; for (const k of Object.keys(b)) if (k !== "g") b[k] += n(r.bat[k]); }
      if (r.pit) { p.g++; for (const k of Object.keys(p)) if (k !== "g") p[k] += n(r.pit[k]); }
      if (r.fld) { f.g++; for (const k of ["po", "a", "e"]) f[k] += n(r.fld[k]); }
    }
    const pa = b.ab + b.bb + b.hbp, ip = p.outs / 3, inn = team.innings || 7;
    stats = {
      batting: b.g ? { ...b, avg: r3(b.ab ? b.h / b.ab : NaN), obp: r3(pa ? (b.h + b.bb + b.hbp) / pa : NaN), slg: r3(b.ab ? (b.h + b.d + 2 * b.t + 3 * b.hr) / b.ab : NaN) } : null,
      pitching: p.g ? { ...p, ip: outsToIp(p.outs), era: r3(ip ? (p.er * inn) / ip : NaN), whip: r3(ip ? (p.bb + p.h) / ip : NaN) } : null,
      fielding: f.g ? { ...f, pct: r3(f.po + f.a + f.e ? (f.po + f.a) / (f.po + f.a + f.e) : NaN) } : null,
    };
  }

  let measurements = [];
  if (prof.show_measurements) {
    const ms = await q(`player_metrics?player_id=eq.${enc(pid)}&select=metric,unit,value,date&order=date`);
    const best = {};
    const lowerIsBetter = (m) => /dash|home to first|pop|time/i.test(m);
    for (const m of ms) {
      const cur = best[m.metric];
      if (!cur || (lowerIsBetter(m.metric) ? +m.value < +cur.value : +m.value > +cur.value)) best[m.metric] = { ...m, value: +m.value };
    }
    measurements = Object.values(best);
  }

  const today = new Date().toISOString().slice(0, 10);
  const events = await q(`player_events?player_id=eq.${enc(pid)}&date=gte.${today}&select=date,title,location&order=date&limit=10`);

  let highlight = null;
  if (prof.highlight_media_id) {
    const m = (await q(`media?id=eq.${enc(prof.highlight_media_id)}&select=kind,path,mime,players`))[0];
    if (m && m.path && (m.players || []).includes(pid)) {
      const r = await fetch(`${base}/storage/v1/object/sign/media/${m.path.split("/").map(enc).join("/")}`, { method: "POST", headers: h, body: JSON.stringify({ expiresIn: 3600 }) });
      if (r.ok) { const j = await r.json(); const u = j.signedURL || j.signedUrl; if (u) highlight = { kind: m.kind, mime: m.mime, url: `${base}/storage/v1${u.startsWith("/") ? u : "/" + u}` }; }
    }
  }
  const yt = String(prof.highlight_url || "").match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/);

  return json({
    name: prof.full_name || player.name || "", jersey: player.num,
    team: team.name, school: prof.school || team.school || "", season: team.season || "",
    grad_year: prof.grad_year, positions: prof.positions, bats: prof.bats, throws: prof.throws,
    height: prof.height, weight: prof.weight, gpa: prof.gpa, bio: prof.bio,
    contact_name: prof.contact_name, contact_email: prof.contact_email,
    stats, measurements, events, highlight, youtube: yt ? yt[1] : null, updated_at: prof.updated_at,
  });
}
