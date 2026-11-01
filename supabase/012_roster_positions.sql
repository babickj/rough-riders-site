-- Roster for signed-in team members only, plus primary and backup positions.
-- Run once in Supabase SQL Editor (safe to re-run).

-- Each player can have several primary and several backup positions (P, C, 1B, 2B, 3B, SS, LF, CF, RF).
alter table public.players add column if not exists pos_primary text[] not null default '{}';
alter table public.players add column if not exists pos_backup  text[] not null default '{}';

-- Who can see player names: coaches, scorekeepers and admins always; parents once the roster is posted.
-- Visitors who aren't signed in can't see the roster at all.
drop policy if exists "read players" on public.players;
create policy "read players" on public.players for select using (
  public.has_role(team_id, array['admin','coach','scorekeeper'])
  or (public.has_role(team_id, array['parent'])
      and exists (select 1 from public.teams t where t.id = players.team_id and (t.roster_reveal_at is null or t.roster_reveal_at <= now()))));
