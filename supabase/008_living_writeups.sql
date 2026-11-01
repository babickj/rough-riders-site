-- Living player write-ups: versions with coach review, edits and comments; season and team deep dives;
-- and a per-player "new data" timestamp so write-ups refresh when something changes.
-- Run once in Supabase SQL Editor (safe to re-run). Needs 007_coach_ai.sql first.

alter table public.ai_reports drop constraint if exists ai_reports_kind_check;
alter table public.ai_reports add constraint ai_reports_kind_check check (kind in ('player','clip','gameday','deepdive','team'));
alter table public.ai_reports add column if not exists status text not null default 'draft';
alter table public.ai_reports drop constraint if exists ai_reports_status_check;
alter table public.ai_reports add constraint ai_reports_status_check check (status in ('draft','reviewed','discarded'));
alter table public.ai_reports add column if not exists ai_output jsonb;            -- the AI's original, kept when a coach edits
alter table public.ai_reports add column if not exists edited boolean not null default false;
alter table public.ai_reports add column if not exists comments jsonb not null default '[]'::jsonb;
alter table public.ai_reports add column if not exists reviewed_by_name text;
alter table public.ai_reports add column if not exists reviewed_at timestamptz;
alter table public.ai_reports add column if not exists basis jsonb;               -- what data the version was built from
alter table public.ai_reports add column if not exists source text not null default 'manual'; -- manual | nightly | upload
create index if not exists ai_reports_team_kind_idx on public.ai_reports (team_id, kind, created_at desc);

drop policy if exists "coaches update ai" on public.ai_reports;
create policy "coaches update ai" on public.ai_reports for update
  using (public.has_role(team_id, array['admin','coach'])) with check (public.has_role(team_id, array['admin','coach']));

-- ---------- when did each player last get new data? ----------
alter table public.players add column if not exists data_changed_at timestamptz;

create or replace function public.touch_players(ids uuid[]) returns void
language sql security definer set search_path = public as $$
  update public.players set data_changed_at = now() where id = any(ids);
$$;

create or replace function public.trg_touch_from_lines() returns trigger
language plpgsql security definer set search_path = public as $$
declare ids uuid[];
begin
  select array_agg(distinct k::uuid) into ids from (
    select jsonb_object_keys(coalesce(new.bat,'{}'::jsonb)) k
    union select jsonb_object_keys(coalesce(new.pit,'{}'::jsonb))
    union select jsonb_object_keys(coalesce(new.fld,'{}'::jsonb))) s
  where k ~ '^[0-9a-f-]{36}$';
  if ids is not null then perform public.touch_players(ids); end if;
  return new;
end $$;
drop trigger if exists touch_from_lines on public.game_lines;
create trigger touch_from_lines after insert or update on public.game_lines for each row execute function public.trg_touch_from_lines();

create or replace function public.trg_touch_from_player_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.player_id is not null then perform public.touch_players(array[new.player_id]); end if;
  return new;
end $$;
drop trigger if exists touch_from_outside on public.player_games;
create trigger touch_from_outside after insert or update on public.player_games for each row execute function public.trg_touch_from_player_id();
drop trigger if exists touch_from_metrics on public.player_metrics;
create trigger touch_from_metrics after insert or update on public.player_metrics for each row execute function public.trg_touch_from_player_id();
drop trigger if exists touch_from_notes on public.player_notes;
create trigger touch_from_notes after insert or update on public.player_notes for each row execute function public.trg_touch_from_player_id();

create or replace function public.trg_touch_from_clip_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'clip' and new.player_id is not null then perform public.touch_players(array[new.player_id]); end if;
  return new;
end $$;
drop trigger if exists touch_from_clip_review on public.ai_reports;
create trigger touch_from_clip_review after insert on public.ai_reports for each row execute function public.trg_touch_from_clip_review();

create or replace function public.trg_touch_from_media() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(array_length(new.players,1),0) > 0 then perform public.touch_players(new.players); end if;
  return new;
end $$;
drop trigger if exists touch_from_media on public.media;
create trigger touch_from_media after insert or update of players on public.media for each row execute function public.trg_touch_from_media();
