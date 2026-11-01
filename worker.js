// Cloudflare Worker entry: /api/* goes to the server code, everything else is the static site in public/.
import * as admin from "./src/admin.js";
import * as ai from "./src/ai.js";
import * as spond from "./src/spond.js";
import * as icsync from "./src/icsync.js";
import * as reports from "./src/reports.js";
import * as recruit from "./src/recruit.js";
import * as mine from "./src/mine.js";
import { calendar } from "./src/calendar.js";

// Nightly write-up refresh: 10:23 UTC is about 2:23 AM Pacific (3:23 in summer).
const NIGHTLY = "23 10 * * *";
const routes = { "/api/admin": admin, "/api/ai": ai, "/api/spond": spond, "/api/calsync": icsync, "/api/report": reports, "/api/recruit": recruit, "/api/mine": mine };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const mod = routes[url.pathname];
    if (mod) {
      const fn = request.method === "POST" ? mod.onRequestPost : request.method === "GET" ? mod.onRequestGet : null;
      if (!fn) return new Response("Method not allowed", { status: 405 });
      try { return await fn({ request, env, ctx }); }
      catch (e) { return new Response(JSON.stringify({ error: "Server error. Try again." }), { status: 500, headers: { "content-type": "application/json" } }); }
    }
    if (url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
    // Calendar feed: /cal/<team>.ics
    const cal = url.pathname.match(/^\/cal\/([a-z0-9-]+)\.ics$/);
    if (cal) return calendar(env, cal[1]);
    // Recruiting profile share link: /r/<token> serves the profile page, which loads /api/recruit.
    if (/^\/r\/[A-Za-z0-9_-]{16,64}\/?$/.test(url.pathname)) return env.ASSETS.fetch(new Request(new URL("/profile.html", url), request));
    return env.ASSETS.fetch(request);
  },
  // Timers set in wrangler.jsonc: Spond and calendar-link (TeamSnap etc.) sync every 2 hours, write-up refresh nightly.
  async scheduled(event, env, ctx) {
    if (event.cron === NIGHTLY) ctx.waitUntil(reports.nightly(env));
    else ctx.waitUntil(Promise.allSettled([spond.scheduled(env), icsync.scheduled(env)]));
  },
};
