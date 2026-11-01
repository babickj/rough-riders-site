// Public settings for the site. Every visitor downloads this file.
// Use ONLY the "anon public" key (Supabase > Project Settings > API Keys). Never the service_role key:
// that one goes in Cloudflare as SUPABASE_SERVICE_ROLE_KEY and must stay secret.
window.RR_CONFIG = {
  supabaseUrl: "https://yukrkkinhswqbviyhmwx.supabase.co",
  supabaseAnonKey: "PASTE_SUPABASE_ANON_KEY",
  // Later, map your own web addresses to teams, e.g.
  // hostTeams: { "riders.example.com": "rough-riders", "team2.example.com": "team-two" },
  hostTeams: {}
};
