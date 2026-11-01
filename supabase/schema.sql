-- Rough Riders team site: database schema, access rules, and storage.
-- Run once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
-- Safe to re-run: it uses IF NOT EXISTS / OR REPLACE where it can.

-- ---------- tables ----------
create table if not exists public.teams (
  id          text primary key,                 -- short slug, e.g. 'rough-riders'
  name        text not null,
  season      text default '',
  league      text default '',
  innings     int  default 6,
  pitch_max   int  default 85,
  logo_path   text,                              -- path in the public 'logos' bucket
  created_at  timestamptz default now()
);

create table if not exists public.site_admins (
  user_id uuid primary key references auth.users on delete cascade
);

create table if not exists public.memberships (
  user_id      uuid references auth.users on delete cascade,
  team_id      text references public.teams on delete cascade,
  role         text not null check (role in ('admin','scorekeeper','parent')),
  display_name text default '',
  email        text default '',
  created_at   timestamptz default now(),
  primary key (user_id, team_id)
);

create table if not exists public.players (
  id       uuid primary key default gen_random_uuid(),
  team_id  text not null references public.teams on delete cascade,
  name     text not null,
  num      int  default 0,
  active   boolean default true
);

create table if not exists public.games (
  id       uuid primary key default gen_random_uuid(),
  team_id  text not null references public.teams on delete cascade,
  date     date not null,
  time     text default '',
  opp      text not null,
  home     boolean default true,
  loc      text default '',
  status   text default 'scheduled' check (status in ('scheduled','final')),
  us       int,
  them     int,
  lineup   jsonb
);

create table if not exists public.game_lines (
  game_id    uuid primary key references public.games on delete cascade,
  team_id    text not null references public.teams on delete cascade,
  bat        jsonb default '{}'::jsonb,
  pit        jsonb default '{}'::jsonb,
  fld        jsonb default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz default now()
);

create table if not exists public.plays (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games on delete cascade,
  team_id    text not null references public.teams on delete cascade,
  t          bigint not null,
  ev         jsonb not null,
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);
create index if not exists plays_game_idx on public.plays (game_id, t);

create table if not exists public.media (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references public.teams on delete cascade,
  kind       text not null check (kind in ('photo','video')),
  path       text,          -- storage path for photos
  url        text,          -- YouTube link for videos
  caption    text default '',
  game_id    uuid references public.games on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz default now()
);

create table if not exists public.activity (
  id       bigint generated always as identity primary key,
  team_id  text not null references public.teams on delete cascade,
  by_user  uuid default auth.uid(),
  by_name  text default '',
  what     text not null,
  at       timestamptz default now()
);

-- ---------- helper: does the signed-in user hold one of these roles on a team? ----------
create or replace function public.has_role(t text, roles text[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.site_admins where user_id = auth.uid())
      or exists (select 1 from public.memberships
                 where user_id = auth.uid() and team_id = t and role = any(roles));
$$;

-- ---------- row level security ----------
alter table public.teams       enable row level security;
alter table public.site_admins enable row level security;
alter table public.memberships enable row level security;
alter table public.players     enable row level security;
alter table public.games       enable row level security;
alter table public.game_lines  enable row level security;
alter table public.plays       enable row level security;
alter table public.media       enable row level security;
alter table public.activity    enable row level security;

-- Public: anyone can read schedule, results, stats, roster (first names and numbers only) and live plays.
drop policy if exists "read teams" on public.teams;            create policy "read teams" on public.teams for select using (true);
drop policy if exists "read players" on public.players;        create policy "read players" on public.players for select using (true);
drop policy if exists "read games" on public.games;            create policy "read games" on public.games for select using (true);
drop policy if exists "read lines" on public.game_lines;       create policy "read lines" on public.game_lines for select using (true);
drop policy if exists "read plays" on public.plays;            create policy "read plays" on public.plays for select using (true);

-- Team admins change team settings.
drop policy if exists "admin edits team" on public.teams;
create policy "admin edits team" on public.teams for update using (public.has_role(id, array['admin'])) with check (public.has_role(id, array['admin']));

-- Admins and scorekeepers change roster, schedule, stats, and live plays.
drop policy if exists "staff writes players" on public.players;
create policy "staff writes players" on public.players for all using (public.has_role(team_id, array['admin','scorekeeper'])) with check (public.has_role(team_id, array['admin','scorekeeper']));
drop policy if exists "staff writes games" on public.games;
create policy "staff writes games" on public.games for all using (public.has_role(team_id, array['admin','scorekeeper'])) with check (public.has_role(team_id, array['admin','scorekeeper']));
drop policy if exists "staff writes lines" on public.game_lines;
create policy "staff writes lines" on public.game_lines for all using (public.has_role(team_id, array['admin','scorekeeper'])) with check (public.has_role(team_id, array['admin','scorekeeper']));
drop policy if exists "staff writes plays" on public.plays;
create policy "staff writes plays" on public.plays for all using (public.has_role(team_id, array['admin','scorekeeper'])) with check (public.has_role(team_id, array['admin','scorekeeper']));

-- Photos and videos: only signed-in team members (parents included) can see or add them.
drop policy if exists "members read media" on public.media;
create policy "members read media" on public.media for select using (public.has_role(team_id, array['admin','scorekeeper','parent']));
drop policy if exists "members add media" on public.media;
create policy "members add media" on public.media for insert with check (public.has_role(team_id, array['admin','scorekeeper','parent']) and created_by = auth.uid());
drop policy if exists "owner or admin removes media" on public.media;
create policy "owner or admin removes media" on public.media for delete using (created_by = auth.uid() or public.has_role(team_id, array['admin']));

-- Memberships: people see their own; team admins see their team's. Changes go through the admin API (service key).
drop policy if exists "see memberships" on public.memberships;
create policy "see memberships" on public.memberships for select using (user_id = auth.uid() or public.has_role(team_id, array['admin']));

drop policy if exists "see self admin" on public.site_admins;
create policy "see self admin" on public.site_admins for select using (user_id = auth.uid());

-- Activity log: staff read and write.
drop policy if exists "staff read activity" on public.activity;
create policy "staff read activity" on public.activity for select using (public.has_role(team_id, array['admin','scorekeeper']));
drop policy if exists "staff log activity" on public.activity;
create policy "staff log activity" on public.activity for insert with check (public.has_role(team_id, array['admin','scorekeeper']));

-- ---------- live updates for the Live tab ----------
do $$ begin
  alter publication supabase_realtime add table public.plays;
exception when duplicate_object then null; end $$;

-- ---------- storage ----------
insert into storage.buckets (id, name, public) values ('media','media', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('logos','logos', true)  on conflict (id) do nothing;

-- media/<team_id>/<file>: members read and upload; uploader or team admin deletes.
drop policy if exists "members read media files" on storage.objects;
create policy "members read media files" on storage.objects for select
  using (bucket_id = 'media' and public.has_role((storage.foldername(name))[1], array['admin','scorekeeper','parent']));
drop policy if exists "members upload media files" on storage.objects;
create policy "members upload media files" on storage.objects for insert
  with check (bucket_id = 'media' and public.has_role((storage.foldername(name))[1], array['admin','scorekeeper','parent']));
drop policy if exists "owner or admin deletes media files" on storage.objects;
create policy "owner or admin deletes media files" on storage.objects for delete
  using (bucket_id = 'media' and (owner = auth.uid() or public.has_role((storage.foldername(name))[1], array['admin'])));

-- logos/<team_id>/<file>: public read, team admins upload.
drop policy if exists "admins upload logos" on storage.objects;
create policy "admins upload logos" on storage.objects for insert
  with check (bucket_id = 'logos' and public.has_role((storage.foldername(name))[1], array['admin']));
drop policy if exists "admins replace logos" on storage.objects;
create policy "admins replace logos" on storage.objects for update
  using (bucket_id = 'logos' and public.has_role((storage.foldername(name))[1], array['admin']));
