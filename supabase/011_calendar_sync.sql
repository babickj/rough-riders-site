-- Schedule sync from a calendar link (TeamSnap, GameChanger, SportsEngine, Google Calendar...).
-- Run once in Supabase SQL Editor (safe to re-run).

-- Where the link came from and when it last synced (shown on the schedule; fine to be public).
alter table public.teams add column if not exists ics_source text;
alter table public.teams add column if not exists ics_synced_at timestamptz;

-- The link itself. Only the server (secret key) can read it: RLS on with no policies.
create table if not exists public.team_sync (
  team_id    text primary key references public.teams(id) on delete cascade,
  ics_url    text,
  updated_at timestamptz not null default now()
);
alter table public.team_sync enable row level security;
revoke all on public.team_sync from anon, authenticated;

-- Games that came from a calendar link carry its id so a re-sync updates instead of duplicating.
alter table public.games add column if not exists ext_id text;
create unique index if not exists games_ext_id_key on public.games (ext_id);
