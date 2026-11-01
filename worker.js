// Cloudflare Worker entry: /api/* goes to the server code, everything else is the static site in public/.
import * as admin from "./src/admin.js";
import * as ai from "./src/ai.js";
import * as spond from "./src/spond.js";

const routes = { "/api/admin": admin, "/api/ai": ai, "/api/spond": spond };

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
    return env.ASSETS.fetch(request);
  },
  // Pulls the schedule from Spond on the timer set in wrangler.jsonc.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(spond.scheduled(env));
  },
};
