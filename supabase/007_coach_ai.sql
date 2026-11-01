-- Coach role, who-sees-what, and AI reports. Run once in Supabase SQL Editor (safe to re-run).
--
-- Who sees what after this:
--   Anyone:      schedule, scores, live line score, team stat totals, roster names/numbers, team photos
--   Scorekeeper: enters games, lineups, live scoring (sees the stat lines they enter)
--   Coach:       everything about players: individual stats, player pages, video, notes, AI, uploads
--   Admin:       coach, plus people, team settings, Spond

-- ---------- roles ----------
alter table public.memberships drop constraint if exists memberships_role_check;
alter table public.memberships add constraint memberships_role_check check (role in ('admin','coach','scorekeeper','parent'));
alter table public.access_requests drop constraint if exists access_requests_role_check;
alter table public.access_requests add constraint access_requests_role_check check (role in ('parent','scorekeeper','coach'));

-- ---------- new columns ----------
alter table public.games   add column if not exists live jsonb;                       -- public live summary (line score, inning, outs)
alter table public.players add column if not exists ai_ok boolean not null default false; -- family agreed to AI review of photos/video

-- ---------- individual stats: staff only ----------
drop policy if exists "read lines" on public.game_lines;
create policy "read lines" on public.game_lines for select using (public.has_role(team_id, array['admin','coach','scorekeeper']));
drop policy if exists "staff writes lines" on public.game_lines;
create policy "staff writes lines" on public.game_lines for all using (public.has_role(team_id, array['admin','coach','scorekeeper'])) with check (public.has_role(team_id, array['admin','coach','scorekeeper']));

drop policy if exists "read plays" on public.plays;
create policy "read plays" on public.plays for select using (public.has_role(team_id, array['admin','coach','scorekeeper']));
drop policy if exists "staff writes plays" on public.plays;
create policy "staff writes plays" on public.plays for all using (public.has_role(team_id, array['admin','coach','scorekeeper'])) with check (public.has_role(team_id, array['admin','coach','scorekeeper']));

drop policy if exists "staff writes players" on public.players;
create policy "staff writes players" on public.players for all using (public.has_role(team_id, array['admin','coach','scorekeeper'])) with check (public.has_role(team_id, array['admin','coach','scorekeeper']));
drop policy if exists "staff writes games" on public.games;
create policy "staff writes games" on public.games for all using (public.has_role(team_id, array['admin','coach','scorekeeper'])) with check (public.has_role(team_id, array['admin','coach','scorekeeper']));

drop policy if exists "read player games" on public.player_games;
create policy "read player games" on public.player_games for select using (public.has_role(team_id, array['admin','coach']));
drop policy if exists "staff write player games" on public.player_games;
create policy "staff write player games" on public.player_games for all using (public.has_role(team_id, array['admin','coach'])) with check (public.has_role(team_id, array['admin','coach']));

drop policy if exists "members read metrics" on public.player_metrics;
create policy "members read metrics" on public.player_metrics for select using (public.has_role(team_id, array['admin','coach']));
drop policy if exists "staff write metrics" on public.player_metrics;
create policy "staff write metrics" on public.player_metrics for all using (public.has_role(team_id, array['admin','coach'])) with check (public.has_role(team_id, array['admin','coach']));

drop policy if exists "coaches read notes" on public.player_notes;
create policy "coaches read notes" on public.player_notes for select using (public.has_role(team_id, array['admin','coach']));
drop policy if exists "coaches add notes" on public.player_notes;
create policy "coaches add notes" on public.player_notes for insert with check (public.has_role(team_id, array['admin','coach']) and created_by = auth.uid());
drop policy if exists "coaches edit notes" on public.player_notes;
create policy "coaches edit notes" on public.player_notes for update using (public.has_role(team_id, array['admin','coach'])) with check (public.has_role(team_id, array['admin','coach']));
drop policy if exists "coaches delete notes" on public.player_notes;
create policy "coaches delete notes" on public.player_notes for delete using (public.has_role(team_id, array['admin','coach']));

drop policy if exists "staff read activity" on public.activity;
create policy "staff read activity" on public.activity for select using (public.has_role(team_id, array['admin','coach','scorekeeper']));
drop policy if exists "staff log activity" on public.activity;
create policy "staff log activity" on public.activity for insert with check (public.has_role(team_id, array['admin','coach','scorekeeper']));

-- Team totals per game for the public Stats page (sums every player's line; no names).
create or replace function public.team_totals(t text)
returns table(game_id uuid, bat jsonb, pit jsonb, fld jsonb)
language sql stable security definer set search_path = public as $$
  select gl.game_id,
    (select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) from (select kv.key k, sum(kv.value::numeric) s
       from jsonb_each(coalesce(gl.bat,'{}'::jsonb)) p, jsonb_each_text(p.value) kv where kv.value ~ '^-?[0-9.]+$' group by kv.key) x),
    (select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) from (select kv.key k, sum(kv.value::numeric) s
       from jsonb_each(coalesce(gl.pit,'{}'::jsonb)) p, jsonb_each_text(p.value) kv where kv.value ~ '^-?[0-9.]+$' group by kv.key) x),
    (select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) from (select kv.key k, sum(kv.value::numeric) s
       from jsonb_each(coalesce(gl.fld,'{}'::jsonb)) p, jsonb_each_text(p.value) kv where kv.value ~ '^-?[0-9.]+$' group by kv.key) x)
  from public.game_lines gl where gl.team_id = t;
$$;
grant execute on function public.team_totals(text) to anon, authenticated;

-- ---------- photos and video ----------
-- Anyone sees photos tagged Team. Coaches and admins see and manage everything.
drop policy if exists "members read media" on public.media;
create policy "members read media" on public.media for select using ((kind = 'photo' and team_tag) or public.has_role(team_id, array['admin','coach']));
drop policy if exists "members add media" on public.media;
create policy "members add media" on public.media for insert with check (public.has_role(team_id, array['admin','coach']) and created_by = auth.uid());
drop policy if exists "owner or admin edits media" on public.media;
create policy "owner or admin edits media" on public.media for update using (public.has_role(team_id, array['admin','coach'])) with check (public.has_role(team_id, array['admin','coach']));
drop policy if exists "owner or admin removes media" on public.media;
create policy "owner or admin removes media" on public.media for delete using (public.has_role(team_id, array['admin','coach']));

drop policy if exists "members read media files" on storage.objects;
create policy "members read media files" on storage.objects for select using (
  bucket_id = 'media' and (
    public.has_role((storage.foldername(name))[1], array['admin','coach'])
    or exists (select 1 from public.media m where m.path = storage.objects.name and m.kind = 'photo' and m.team_tag)));
drop policy if exists "members upload media files" on storage.objects;
create policy "members upload media files" on storage.objects for insert
  with check (bucket_id = 'media' and public.has_role((storage.foldername(name))[1], array['admin','coach']));
drop policy if exists "owner or admin deletes media files" on storage.objects;
create policy "owner or admin deletes media files" on storage.objects for delete
  using (bucket_id = 'media' and public.has_role((storage.foldername(name))[1], array['admin','coach']));

-- ---------- AI reports (coaches and admins only) ----------
create table if not exists public.ai_reports (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references public.teams on delete cascade,
  kind       text not null check (kind in ('player','clip','gameday')),
  player_id  uuid references public.players on delete cascade,
  game_id    uuid references public.games on delete set null,
  media_id   uuid references public.media on delete set null,
  output     jsonb not null,
  created_by uuid default auth.uid(),
  by_name    text default '',
  created_at timestamptz default now()
);
create index if not exists ai_reports_player_idx on public.ai_reports (player_id, created_at desc);
alter table public.ai_reports enable row level security;
drop policy if exists "coaches read ai" on public.ai_reports;
create policy "coaches read ai" on public.ai_reports for select using (public.has_role(team_id, array['admin','coach']));
drop policy if exists "coaches write ai" on public.ai_reports;
create policy "coaches write ai" on public.ai_reports for insert with check (public.has_role(team_id, array['admin','coach']));
drop policy if exists "coaches delete ai" on public.ai_reports;
create policy "coaches delete ai" on public.ai_reports for delete using (public.has_role(team_id, array['admin','coach']));
