-- Adds Spond schedule sync. Run once in Supabase SQL Editor (safe to re-run).
alter table public.teams add column if not exists spond_group text;
alter table public.teams add column if not exists spond_group_name text;
alter table public.teams add column if not exists spond_synced_at timestamptz;
alter table public.games add column if not exists spond_id text;
create unique index if not exists games_spond_id_key on public.games (spond_id);
