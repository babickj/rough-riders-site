// Public settings for the site. Every visitor downloads this file.
// Use ONLY the publishable key (starts with sb_publishable_; Supabase > Project Settings > API Keys).
// Never a secret key (sb_secret_...) or the old service_role key: those go in Cloudflare as
// SUPABASE_SERVICE_ROLE_KEY and must stay secret.
window.RR_CONFIG = {
  supabaseUrl: "https://yukrkkinhswqbviyhmwx.supabase.co",
  supabaseAnonKey: "sb_publishable_MlCpoccZftsBpSnqku7jmw_NQOW-1n9",
  // Later, map your own web addresses to teams, e.g.
  // hostTeams: { "riders.example.com": "rough-riders", "team2.example.com": "team-two" },
  hostTeams: {},
  // Show only one school's squads on an address, e.g.
  // hostSchools: { "otayranchbaseball.com": "Otay Ranch HS" },
  hostSchools: {}
};
