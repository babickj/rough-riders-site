# Rough Riders team site

Schedule, live scoring, stats, lineups, printable scoresheets, photos and videos for youth baseball teams.
Static site and a small Worker on Cloudflare, data and logins in Supabase.

## What's where

- `public/`: the site (`index.html`, `app.css`, `app.js`, `config.js`, `logos/`)
- `public/config.js`: your Supabase address and public key
- `worker.js` and `wrangler.jsonc`: the Cloudflare Worker that serves the site and the `/api` routes
- `src/admin.js`: adding people, roles, password resets
- `src/ai.js`: optional scoresheet photo and Spond reading with Claude
- `src/spond.js`: Spond schedule sync (every 2 hours, plus a Sync button)
- `supabase/schema.sql`: database tables and access rules
- `supabase/seed.sql`: creates the team and makes you the owner
- `public/logos/rough-riders.jpg`: team logo (a second team's logo goes in `public/logos/<team-web-name>.jpg`, or upload it in Admin)

## Who can do what (after supabase/007_coach_ai.sql)

- Anyone: schedule, scores, live line score, team stat totals, roster (first names and numbers), photos tagged Team
- Scorekeepers: plus entering games, lineups, live scoring, roster and schedule changes
- Coaches: plus individual stats, player pages, all photos and video, uploads, coach notes, measurements, AI tools
- Admins: plus adding people, changing roles, resetting passwords, team settings, Spond

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
   - `ANTHROPIC_API_KEY` = optional, switches the AI from Cloudflare's free models to Claude (type Secret)
4. Every push to `main` redeploys. The site is live at `https://rough-riders-site.<your-subdomain>.workers.dev`.

### 4. Spond schedule sync (optional)
1. In Supabase **SQL Editor**, run `supabase/002_spond.sql` once.
2. In the Worker's **Settings > Variables and Secrets**, add `SPOND_EMAIL` and `SPOND_PASSWORD` (type **Secret**) for a Spond login that belongs to the team's group.
3. On the site, **Admin > Spond schedule sync > Show my Spond groups**, pick the group, press **Use this group**.

Spond has no official public API; this uses the same calls as the open-source Spond library, so it may need updating if Spond changes them. Only games sync (practices and similar events are skipped). Name games like "vs Cardinals" or "@ Padres".

### 5. More teams
1. In Supabase **SQL Editor**, run `supabase/004_multi_team.sql` once (per-team pitch rules).
2. Signed in as the site owner, go to **Admin > Teams**, enter the team name, a web name (e.g. `eastlake`), and the level, then **Add team**.
3. The team lives at `/<web-name>` (e.g. `/eastlake`). Upload its logo in that team's Admin, set its season, and connect its Spond group if it has one.
4. People, roles, photos, stats and access requests are separate per team. The site owner is admin on every team; other coaches can be added to every team at once with **Add to every team**.

### 6. Player pages, coach notes, photo tags
Run `supabase/005_players_media.sql` once. Player pages are at `/<team>#player-<id>` (tap a name on Roster or Stats).
Coach notes are visible only to the team's admins. Photos and clips are tagged with players or Team when uploaded,
and can be re-tagged with the Tag button. Clips up to 50 MB upload directly (the Supabase free plan's file limit);
longer video goes on YouTube as a link.

### 7. Trends, outside games, measurements
Run `supabase/006_player_extras.sql` once. On a player page, coaches and scorekeepers can add a game the player
played outside the team (shown only on that page; pitches count toward rest days) and measurements such as exit
velocity. Trends chart batting average, on-base percentage, pitches per outing, and each measurement over time.

### 8. Coach role and AI
Run `supabase/007_coach_ai.sql` once. AI runs on Cloudflare Workers AI by default (free daily allowance,
the `ai` binding in `wrangler.jsonc`, no key needed). To use Claude instead, add `ANTHROPIC_API_KEY` (type Secret).
- Player page > **Write a new report**: development report from stats, trends, measurements and coach notes.
- Photos > **AI review** on a clip or photo: about 10 frames are pulled in the browser and reviewed. Every tagged
  player needs **Family has OK'd AI review** checked on their page first.
- Enter game > lineup > **Suggest with AI**: batting order and pitching plan that respects rest days and the pitch limit.
Reports are saved per player and visible to coaches and admins only.

### 9. Living write-ups
Run `supabase/008_living_writeups.sql` once.
- Each player has one development write-up with every version kept. New versions arrive as drafts; a coach marks
  them reviewed, edits them, or comments. Coach edits and comments are treated as fact by the next version.
- Focus areas keep an id across versions with a status (new, improving, still working, resolved) and cite clip reviews.
- Database triggers stamp `players.data_changed_at` when stats, outside games, notes, measurements, tagged media or clip
  reviews change. A nightly job (10:23 UTC) drafts updates for up to 20 players with new data. **Update now** does it on demand.
- **Season review** looks back over every version; **Team review** (Stats tab) reads all write-ups and suggests a practice plan.
- Uploads can be AI-reviewed automatically (only for players whose family OK box is checked).

### Later: your own web address
In the Worker, **Settings > Domains & Routes > Add > Custom domain**. For one address per team, add each one and map it in `config.js`:
```js
hostTeams: { "riders.example.com": "rough-riders", "team2.example.com": "team-two" }
```
Without that, each team is reachable at `/<web-name>`.

## Notes
- Free tiers: Supabase pauses a project after a week with no activity. Opening the site counts as activity; in the off-season, restore it from the Supabase dashboard if it pauses.
- Photos are resized to 2048px before upload to save space. Videos are YouTube links (upload as Unlisted).
- Pitch-count rest days follow Little League rules: 66+ pitches 4 days, 51–65 3, 36–50 2, 21–35 1.
