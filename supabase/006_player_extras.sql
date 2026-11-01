-- Player trends: games a player plays outside the team (tournaments, guest spots),
-- and measurements over time (exit velocity, 60-yard dash, ...).
-- Run once in Supabase SQL Editor (safe to re-run).

create table if not exists public.player_games (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references public.teams on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  date       date not null,
  event      text not null check (char_length(event) between 1 and 120),
  bat        jsonb,
  pit        jsonb,
  fld        jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists player_games_player_idx on public.player_games (player_id, date);
alter table public.player_games enable row level security;
-- Same visibility as team stats: anyone can read; coaches and scorekeepers write.
drop policy if exists "read player games" on public.player_games;
create policy "read player games" on public.player_games for select using (true);
drop policy if exists "staff write player games" on public.player_games;
create policy "staff write player games" on public.player_games for all
  using (public.has_role(team_id, array['admin','scorekeeper'])) with check (public.has_role(team_id, array['admin','scorekeeper']));

create table if not exists public.player_metrics (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references public.teams on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  metric     text not null check (char_length(metric) between 1 and 60),
  unit       text default '',
  value      numeric not null,
  date       date not null,
  note       text default '' check (char_length(note) <= 200),
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists player_metrics_player_idx on public.player_metrics (player_id, metric, date);
alter table public.player_metrics enable row level security;
-- Measurements are for signed-in team members only; coaches and scorekeepers write.
drop policy if exists "members read metrics" on public.player_metrics;
create policy "members read metrics" on public.player_metrics for select using (public.has_role(team_id, array['admin','scorekeeper','parent']));
drop policy if exists "staff write metrics" on public.player_metrics;
create policy "staff write metrics" on public.player_metrics for all
  using (public.has_role(team_id, array['admin','scorekeeper'])) with check (public.has_role(team_id, array['admin','scorekeeper']));
