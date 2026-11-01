# Rough Riders team site

Schedule, live scoring, stats, lineups, printable scoresheets, photos and videos for youth baseball teams.
Static site and a small Worker on Cloudflare, data and logins in Supabase.

## What's where

- `public/`: the site (`index.html`, `app.css`, `app.js`, `config.js`, `logos/`)
- `public/config.js`: your Supabase address and public key
- `worker.js` and `wrangler.jsonc`: the Cloudflare Worker that serves the site and the `/api` routes
- `src/admin.js`: adding people, roles, password resets
- `src/ai.js`: optional scoresheet photo and Spond reading with Claude
- `supabase/schema.sql`: database tables and access rules
- `supabase/seed.sql`: creates the team and makes you the owner
- `public/logos/rough-riders.jpg`: team logo (a second team's logo goes in `public/logos/<team-web-name>.jpg`, or upload it in Admin)

## Who can do what

- Anyone: schedule, results, live score, stats, roster (first names and numbers only)
- Parents (signed in): plus photos and videos, and can add their own
- Scorekeepers: plus entering games, lineups, live scoring, roster and schedule changes
- Admins: plus adding people, changing roles, resetting passwords, team settings

## Setup

### 1. Supabase
1. Open your project. In **SQL Editor**, paste all of `supabase/schema.sql` and click **Run**.
2. In **Authentication > Users**, click **Add user > Create new user** with your email and a password. Tick **Auto Confirm User**.
3. In **SQL Editor**, paste `supabase/seed.sql`, replace `YOUR_EMAIL` (twice) with that email, and click **Run**. The last line should show your email with role `admin`.
4. In **Authentication > Sign In / Providers > Email**, turn **off** "Allow new users to sign up". Only admins add people.
5. In **Project Settings > API**, copy the **Project URL**, the **anon public** key, and the **service_role** key (keep this one secret).

### 2. config.js
Paste the Project URL and anon key into `public/config.js` and commit it. Both are safe to publish.

### 3. Cloudflare Worker
1. **Workers & Pages > Create > Import a repository**, pick this repository. Leave the build and deploy commands as they are (`npx wrangler deploy`).
2. The Worker's name must match `name` in `wrangler.jsonc` (`rough-riders-site`).
3. In the Worker, **Settings > Variables and Secrets**, add:
   - `SUPABASE_URL` = Project URL (type Text)
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key (type Secret)
   - `ANTHROPIC_API_KEY` = optional, turns on scoresheet photo and Spond reading (type Secret)
4. Every push to `main` redeploys. The site is live at `https://rough-riders-site.<your-subdomain>.workers.dev`.

### Later: your own web address
In the Worker, **Settings > Domains & Routes > Add > Custom domain**. For one address per team, add each one and map it in `config.js`:
```js
hostTeams: { "riders.example.com": "rough-riders", "team2.example.com": "team-two" }
```
Without that, each team is reachable at `/?team=<web-name>`.

## Notes
- Free tiers: Supabase pauses a project after a week with no activity. Opening the site counts as activity; in the off-season, restore it from the Supabase dashboard if it pauses.
- Photos are resized to 2048px before upload to save space. Videos are YouTube links (upload as Unlisted).
- Pitch-count rest days follow Little League rules: 66+ pitches 4 days, 51–65 3, 36–50 2, 21–35 1.
