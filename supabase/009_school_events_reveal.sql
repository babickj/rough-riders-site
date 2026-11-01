-- Squads grouped by school, team announcements, a scheduled roster reveal, and non-game events.
-- Run once in Supabase SQL Editor (safe to re-run).

alter table public.teams add column if not exists school text;             -- groups squads (Varsity, JV) on the team list
alter table public.teams add column if not exists announcement text;       -- banner on the team's pages
alter table public.teams add column if not exists roster_reveal_at timestamptz; -- roster hidden from the public until then

-- Games and other events (tryouts, meetings, picture day) share the schedule. Events never count in stats.
alter table public.games add column if not exists kind text not null default 'game';
alter table public.games drop constraint if exists games_kind_check;
alter table public.games add constraint games_kind_check check (kind in ('game','event'));

-- The roster stays hidden from visitors until the reveal time. Staff always see it.
drop policy if exists "read players" on public.players;
create policy "read players" on public.players for select using (
  public.has_role(team_id, array['admin','coach','scorekeeper'])
  or exists (select 1 from public.teams t where t.id = players.team_id and (t.roster_reveal_at is null or t.roster_reveal_at <= now())));
