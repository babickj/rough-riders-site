-- Player pages: coach notes, and tagging photos/videos with players or "Team".
-- Run once in Supabase SQL Editor (safe to re-run).

-- Tags on photos and videos. players holds player ids; team_tag marks a whole-team shot.
alter table public.media add column if not exists players uuid[] not null default '{}';
alter table public.media add column if not exists team_tag boolean not null default false;
alter table public.media add column if not exists mime text;
create index if not exists media_players_idx on public.media using gin (players);
drop policy if exists "owner or admin edits media" on public.media;
create policy "owner or admin edits media" on public.media for update
  using (created_by = auth.uid() or public.has_role(team_id, array['admin','scorekeeper']))
  with check (created_by = auth.uid() or public.has_role(team_id, array['admin','scorekeeper']));

-- Coach notes. Only the team's admins (coaches) can read or write them.
create table if not exists public.player_notes (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references public.teams on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  topic      text not null default 'general' check (topic in ('general','hitting','pitching','fielding','baserunning','effort')),
  body       text not null check (char_length(body) between 1 and 4000),
  created_by uuid default auth.uid(),
  by_name    text default '',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists player_notes_player_idx on public.player_notes (player_id, created_at desc);
alter table public.player_notes enable row level security;
drop policy if exists "coaches read notes" on public.player_notes;
create policy "coaches read notes" on public.player_notes for select using (public.has_role(team_id, array['admin']));
drop policy if exists "coaches add notes" on public.player_notes;
create policy "coaches add notes" on public.player_notes for insert with check (public.has_role(team_id, array['admin']) and created_by = auth.uid());
drop policy if exists "coaches edit notes" on public.player_notes;
create policy "coaches edit notes" on public.player_notes for update using (public.has_role(team_id, array['admin'])) with check (public.has_role(team_id, array['admin']));
drop policy if exists "coaches delete notes" on public.player_notes;
create policy "coaches delete notes" on public.player_notes for delete using (public.has_role(team_id, array['admin']));
