-- Player logins, private roster, and positions. Run once in Supabase SQL Editor (safe to re-run).
-- This includes everything in 012_roster_positions.sql, so you only need this file.

-- ---------- positions (kids can have several primary and backup spots) ----------
alter table public.players add column if not exists pos_primary text[] not null default '{}';
alter table public.players add column if not exists pos_backup  text[] not null default '{}';

-- ---------- player role, linked to a roster spot ----------
alter table public.memberships add column if not exists player_id uuid references public.players on delete set null;
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in ('admin','coach','scorekeeper','parent','player'));
alter table public.access_requests drop constraint if exists access_requests_role_check;
alter table public.access_requests add constraint access_requests_role_check check (role in ('parent','scorekeeper','coach','player'));

-- The roster spot(s) the signed-in person is linked to on a team (a player, or a parent linked to their kid).
create or replace function public.my_players(t text) returns setof uuid
language sql stable security definer set search_path = public as $$
  select m.player_id from public.memberships m
  where m.user_id = auth.uid() and m.team_id = t and m.player_id is not null and m.role in ('player','parent');
$$;
grant execute on function public.my_players(text) to authenticated;

-- ---------- roster: signed-in team members only ----------
drop policy if exists "read players" on public.players;
create policy "read players" on public.players for select using (
  public.has_role(team_id, array['admin','coach','scorekeeper'])
  or id in (select public.my_players(team_id))
  or (public.has_role(team_id, array['parent','player'])
      and exists (select 1 from public.teams t where t.id = players.team_id and (t.roster_reveal_at is null or t.roster_reveal_at <= now()))));

-- ---------- a player (or their linked parent) sees their own stats and info ----------
-- Game stats: only that player's numbers from each game, never teammates'.
create or replace function public.my_lines(t text)
returns table (game_id uuid, player_id uuid, bat jsonb, pit jsonb, fld jsonb)
language sql stable security definer set search_path = public as $$
  select gl.game_id, mp.id, gl.bat -> mp.id::text, gl.pit -> mp.id::text, gl.fld -> mp.id::text
  from public.game_lines gl
  join (select public.my_players(t) as id) mp on true
  where gl.team_id = t;
$$;
grant execute on function public.my_lines(text) to authenticated;

drop policy if exists "own player games" on public.player_games;
create policy "own player games" on public.player_games for select using (player_id in (select public.my_players(team_id)));
drop policy if exists "own metrics" on public.player_metrics;
create policy "own metrics" on public.player_metrics for select using (player_id in (select public.my_players(team_id)));

-- Coach notes stay private unless a coach marks one "share with player".
alter table public.player_notes add column if not exists shared boolean not null default false;
drop policy if exists "own shared notes" on public.player_notes;
create policy "own shared notes" on public.player_notes for select using (shared and player_id in (select public.my_players(team_id)));

-- Development write-ups a coach has reviewed.
drop policy if exists "own reviewed write-ups" on public.ai_reports;
create policy "own reviewed write-ups" on public.ai_reports for select using (kind = 'player' and status = 'reviewed' and player_id in (select public.my_players(team_id)));

-- Tryout placement for that player.
drop policy if exists "own tryout result" on public.tryout_players;
create policy "own tryout result" on public.tryout_players for select using (placed_player_id is not null and placed_player_id in (select public.my_players(placed_team_id)));
