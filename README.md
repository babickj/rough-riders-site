# Rough Riders team site

Schedule, live scoring, stats, lineups, printable scoresheets, photos and videos for youth baseball teams.
Static site on Cloudflare Pages, data and logins in Supabase.

## What's where

- `index.html`, `app.css`, `app.js`: the site
- `config.js`: your Supabase address and public key
- `functions/api/admin.js`: adding people, roles, password resets (runs on Cloudflare)
- `functions/api/ai.js`: optional scoresheet photo and Spond reading with Claude
- `supabase/schema.sql`: database tables and access rules
- `supabase/seed.sql`: creates the team and makes you the owner
- `logos/rough-riders.jpg`: team logo (a second team's logo goes in `logos/<team-web-name>.jpg`, or upload it in Admin)

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
Paste the Project URL and anon key into `config.js` and commit it. Both are safe to publish.

### 3. Cloudflare Pages
1. **Workers & Pages > Create > Pages > Connect to Git**, pick this repository.
2. Build settings: Framework **None**, build command blank, output directory `/`.
3. **Settings > Variables and Secrets**, add (type **Secret** for the keys):
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key
   - `ANTHROPIC_API_KEY` = optional, turns on scoresheet photo and Spond reading
4. Redeploy. The site is live at `https://<project>.pages.dev`.

### Later: your own web address
In the Pages project, **Custom domains > Set up a domain**. For one address per team, add each one and map it in `config.js`:
```js
hostTeams: { "riders.example.com": "rough-riders", "team2.example.com": "team-two" }
```
Without that, each team is reachable at `/?team=<web-name>`.

## Notes
- Free tiers: Supabase pauses a project after a week with no activity. Opening the site counts as activity; in the off-season, restore it from the Supabase dashboard if it pauses.
- Photos are resized to 2048px before upload to save space. Videos are YouTube links (upload as Unlisted).
- Pitch-count rest days follow Little League rules: 66+ pitches 4 days, 51–65 3, 36–50 2, 21–35 1.
