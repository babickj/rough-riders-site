// Team admin API: add people, change roles, reset passwords, remove people, create teams.
// Runs on Cloudflare Pages Functions. Needs these environment variables (Pages > Settings > Variables):
//   SUPABASE_URL               https://<project>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  the service_role key (keep secret; set as an encrypted variable)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function onRequestPost({ request, env }) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
    return json({ error: "The admin service isn't configured yet. Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Cloudflare." }, 501);

  const base = env.SUPABASE_URL.replace(/\/$/, "");
  const svc = env.SUPABASE_SERVICE_ROLE_KEY;
  const sh = { apikey: svc, Authorization: `Bearer ${svc}`, "content-type": "application/json" };
  const rest = (path, init = {}) => fetch(`${base}/rest/v1/${path}`, { ...init, headers: { ...sh, Prefer: "return=representation", ...(init.headers || {}) } });
  const authAdmin = (path, init = {}) => fetch(`${base}/auth/v1/admin/${path}`, { ...init, headers: { ...sh, ...(init.headers || {}) } });

  // Who is calling?
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "Sign in first." }, 401);
  const who = await fetch(`${base}/auth/v1/user`, { headers: { apikey: svc, Authorization: `Bearer ${token}` } });
  if (!who.ok) return json({ error: "Your sign-in expired. Sign in again." }, 401);
  const caller = await who.json();

  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }
  const { action, team_id } = body;

  const siteAdmin = (await (await rest(`site_admins?user_id=eq.${caller.id}&select=user_id`)).json()).length > 0;
  const isTeamAdmin = async (t) => siteAdmin ||
    (await (await rest(`memberships?user_id=eq.${caller.id}&team_id=eq.${encodeURIComponent(t)}&role=eq.admin&select=user_id`)).json()).length > 0;

  if (action === "create_team") {
    if (!siteAdmin) return json({ error: "Only the site owner can add teams." }, 403);
    const id = String(body.id || "").toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    if (!id || !body.name) return json({ error: "Give the team a name and a short web name." }, 400);
    const r = await rest("teams", { method: "POST", body: JSON.stringify({ id, name: body.name, season: body.season || "", league: body.league || "" }) });
    if (!r.ok) return json({ error: r.status === 409 ? "That web name is taken. Pick another." : "Couldn't create the team." }, 400);
    return json({ ok: true, team: (await r.json())[0] });
  }

  if (!team_id || !(await isTeamAdmin(team_id))) return json({ error: "Only this team's admins can manage people." }, 403);

  const findUserByEmail = async (email) => {
    for (let page = 1; page <= 20; page++) {
      const r = await authAdmin(`users?page=${page}&per_page=200`);
      if (!r.ok) return null;
      const { users = [] } = await r.json();
      const u = users.find((x) => (x.email || "").toLowerCase() === email);
      if (u) return u;
      if (users.length < 200) return null;
    }
    return null;
  };

  if (action === "list") {
    const r = await rest(`memberships?team_id=eq.${encodeURIComponent(team_id)}&select=user_id,role,display_name,email,created_at&order=role.asc,display_name.asc`);
    return json({ members: await r.json() });
  }

  if (action === "add") {
    const email = String(body.email || "").trim().toLowerCase();
    const role = body.role;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "Enter a valid email address." }, 400);
    if (!["admin", "scorekeeper", "parent"].includes(role)) return json({ error: "Pick a role." }, 400);
    let user = await findUserByEmail(email), created = false;
    if (!user) {
      if (!body.password || String(body.password).length < 8) return json({ error: "Set a temporary password of at least 8 characters." }, 400);
      const r = await authAdmin("users", { method: "POST", body: JSON.stringify({ email, password: body.password, email_confirm: true, user_metadata: { name: body.name || "" } }) });
      if (!r.ok) { const e = await r.json().catch(() => ({})); return json({ error: e.msg || e.message || "Couldn't create the account." }, 400); }
      user = await r.json(); created = true;
    }
    const m = await rest("memberships", {
      method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ user_id: user.id, team_id, role, display_name: body.name || "", email }),
    });
    if (!m.ok) return json({ error: "Couldn't add them to the team." }, 400);
    return json({ ok: true, created });
  }

  const target = String(body.user_id || "");
  if (!/^[0-9a-f-]{36}$/.test(target)) return json({ error: "Pick a person." }, 400);

  if (action === "set_role") {
    if (!["admin", "scorekeeper", "parent"].includes(body.role)) return json({ error: "Pick a role." }, 400);
    if (target === caller.id && body.role !== "admin" && !siteAdmin) return json({ error: "You can't remove your own admin access." }, 400);
    const r = await rest(`memberships?user_id=eq.${target}&team_id=eq.${encodeURIComponent(team_id)}`, { method: "PATCH", body: JSON.stringify({ role: body.role }) });
    return r.ok ? json({ ok: true }) : json({ error: "Couldn't change the role." }, 400);
  }

  if (action === "reset_password") {
    const inTeam = (await (await rest(`memberships?user_id=eq.${target}&team_id=eq.${encodeURIComponent(team_id)}&select=user_id`)).json()).length > 0;
    if (!inTeam) return json({ error: "That person isn't on this team." }, 400);
    if (!body.password || String(body.password).length < 8) return json({ error: "Use at least 8 characters." }, 400);
    const r = await authAdmin(`users/${target}`, { method: "PUT", body: JSON.stringify({ password: body.password }) });
    return r.ok ? json({ ok: true }) : json({ error: "Couldn't reset the password." }, 400);
  }

  if (action === "remove") {
    if (target === caller.id) return json({ error: "You can't remove yourself." }, 400);
    const r = await rest(`memberships?user_id=eq.${target}&team_id=eq.${encodeURIComponent(team_id)}`, { method: "DELETE" });
    return r.ok ? json({ ok: true }) : json({ error: "Couldn't remove them." }, 400);
  }

  return json({ error: "Unknown action." }, 400);
}
