-- Per-team pitch-count rest rules. Run once in Supabase SQL Editor (safe to re-run).
-- pitch_rest is a list of [minimum pitches, days of rest], highest first.
-- Empty means Little League rules: [[66,4],[51,3],[36,2],[21,1]].
alter table public.teams add column if not exists pitch_rest jsonb;
