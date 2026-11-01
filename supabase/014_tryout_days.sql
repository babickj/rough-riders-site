-- Tryout day tools: check-in numbers, multi-day scoring, makeup and home-to-first, scoring guide, hidden scores.
-- Needs 010_hs_tools.sql first. Run once in Supabase SQL Editor (safe to re-run).

alter table public.tryout_players add column if not exists tryout_no int;
alter table public.tryout_players add column if not exists checked_in_days date[] not null default '{}';

alter table public.tryout_scores add column if not exists makeup int check (makeup between 1 and 5);
alter table public.tryout_scores add column if not exists h2f numeric;
-- One score row per coach, per player, per tryout day (tryouts run several days).
alter table public.tryout_scores add column if not exists day date not null default current_date;
alter table public.tryout_scores drop constraint if exists tryout_scores_tryout_player_id_coach_id_key;
create unique index if not exists tryout_scores_day_key on public.tryout_scores (tryout_player_id, coach_id, day);

alter table public.tryouts add column if not exists rubric jsonb;
alter table public.tryouts add column if not exists blind boolean not null default true;
alter table public.tryouts add column if not exists revealed boolean not null default false;
