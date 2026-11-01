// Calendar feed families subscribe to once: /cal/<team-web-name>.ics
// Their phone's calendar re-checks it on its own, so new games, time changes, rainouts and events show up.

const enc = encodeURIComponent;

function esc(s) {
  return String(s || "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}
// Fold long lines at 75 octets as the iCalendar format requires.
function fold(line) {
  const out = []; let cur = "";
  for (const ch of line) { if (new TextEncoder().encode(cur + ch).length > 74) { out.push(cur); cur = " " + ch; } else cur += ch; }
  out.push(cur); return out.join("\r\n");
}
// "3:30 PM", "15:30", "10" -> [hour, minute] or null
function parseTime(t) {
  const m = String(t || "").trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(a|p)?\.?\s*m?\.?$/i);
  if (!m) return null;
  let h = +m[1], min = +(m[2] || 0);
  const ap = (m[3] || "").toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 7) h += 12; // a bare "3:30" for a game almost always means the afternoon
  return h < 24 && min < 60 ? [h, min] : null;
}
const pad = (x) => String(x).padStart(2, "0");

export async function calendar(env, teamId) {
  if (!/^[a-z0-9-]{1,60}$/.test(teamId) || !env.SUPABASE_URL) return new Response("Not found", { status: 404 });
  const base = env.SUPABASE_URL.replace(/\/$/, ""), svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const h = { apikey: svc, ...(svc.startsWith("eyJ") ? { Authorization: `Bearer ${svc}` } : {}) };
  const get = async (p) => { const r = await fetch(`${base}/rest/v1/${p}`, { headers: h }); return r.ok ? r.json() : []; };
  const team = (await get(`teams?id=eq.${enc(teamId)}&select=name,school`))[0];
  if (!team) return new Response("Not found", { status: 404 });
  const items = await get(`games?team_id=eq.${enc(teamId)}&select=id,date,time,opp,home,loc,status,us,them,kind&order=date`);
  const tz = env.SPOND_TIMEZONE || "America/Los_Angeles";
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const seq = Math.floor(Date.now() / 60000); // always increases, so calendars take the latest version
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Team site//Schedule//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(team.name)}`, `X-WR-TIMEZONE:${tz}`, "REFRESH-INTERVAL;VALUE=DURATION:PT2H", "X-PUBLISHED-TTL:PT2H"];
  for (const g of items) {
    const isEvent = g.kind === "event";
    let summary = isEvent ? g.opp : `${team.name} ${g.home ? "vs" : "at"} ${g.opp}`;
    if (g.status === "final" && g.us != null) summary += ` (${g.us > g.them ? "W" : g.us < g.them ? "L" : "T"} ${g.us}-${g.them})`;
    if (g.status === "cancelled") summary = "CANCELLED: " + summary;
    if (g.status === "postponed") summary = "POSTPONED: " + summary;
    const d = g.date.replace(/-/g, ""), t = parseTime(g.time);
    lines.push("BEGIN:VEVENT", `UID:${g.id}@team-site`, `DTSTAMP:${stamp}`, `SEQUENCE:${seq}`);
    if (t) {
      const start = new Date(Date.UTC(+g.date.slice(0, 4), +g.date.slice(5, 7) - 1, +g.date.slice(8, 10), t[0], t[1]));
      const end = new Date(start.getTime() + (isEvent ? 90 : 120) * 60000);
      const fmt = (x) => `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}00`;
      lines.push(`DTSTART;TZID=${tz}:${fmt(start)}`, `DTEND;TZID=${tz}:${fmt(end)}`);
    } else {
      const next = new Date(Date.UTC(+g.date.slice(0, 4), +g.date.slice(5, 7) - 1, +g.date.slice(8, 10) + 1));
      lines.push(`DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next.getUTCFullYear()}${pad(next.getUTCMonth() + 1)}${pad(next.getUTCDate())}`);
    }
    lines.push(`SUMMARY:${esc(summary)}`);
    if (g.loc) lines.push(`LOCATION:${esc(g.loc)}`);
    if (g.status === "cancelled") lines.push("STATUS:CANCELLED");
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: { "content-type": "text/calendar; charset=utf-8", "cache-control": "public, max-age=900", "content-disposition": `inline; filename="${teamId}.ics"` },
  });
}
