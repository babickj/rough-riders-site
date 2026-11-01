-- High school tools: tryouts, recruiting profiles, showcases, call-ups, rainouts.
-- Run once in Supabase SQL Editor (safe to re-run). Needs 009 first.

-- ---------- call-ups: a player from another squad, recorded on the team they played for ----------
alter table public.players add column if not exists call_up_of uuid references public.players on delete set null;

-- ---------- rainouts and postponements ----------
alter table public.games drop constraint if exists games_status_check;
alter table public.games add constraint games_status_check check (status in ('scheduled','final','cancelled','postponed'));

-- ---------- tryouts ----------
create table if not exists public.tryouts (
  id            uuid primary key default gen_random_uuid(),
  team_id       text not null references public.teams on delete cascade,   -- the squad hosting it (usually Varsity)
  title         text not null check (char_length(title) between 1 and 80),
  date          date,
  location      text default '',
  signups_open  boolean not null default false,
  created_at    timestamptz default now()
);
alter table public.tryouts enable row level security;
drop policy if exists "read tryouts" on public.tryouts;
create policy "read tryouts" on public.tryouts for select using (signups_open or public.has_role(team_id, array['admin','coach']));
drop policy if exists "coaches manage tryouts" on public.tryouts;
create policy "coaches manage tryouts" on public.tryouts for all using (public.has_role(team_id, array['admin','coach'])) with check (public.has_role(team_id, array['admin','coach']));

create table if not exists public.tryout_players (
  id               uuid primary key default gen_random_uuid(),
  tryout_id        uuid not null references public.tryouts on delete cascade,
  team_id          text not null references public.teams on delete cascade,
  first_name       text not null check (char_length(first_name) between 1 and 40),
  last_name        text not null check (char_length(last_name) between 1 and 40),
  grade            text default '' check (char_length(grade) <= 10),
  positions        text default '' check (char_length(positions) <= 60),
  bats             text default '' check (char_length(bats) <= 10),
  throws           text default '' check (char_length(throws) <= 10),
  parent_name      text default '' check (char_length(parent_name) <= 80),
  parent_email     text default '' check (char_length(parent_email) <= 200),
  parent_phone     text default '' check (char_length(parent_phone) <= 30),
  family_note      text default '' check (char_length(family_note) <= 300),
  status           text not null default 'registered' check (status in ('registered','placed','not_placed')),
  placed_team_id   text references public.teams on delete set null,
  placed_player_id uuid references public.players on delete set null,
  ai_summary       text,
  created_at       timestamptz default now()
);
create index if not exists tryout_players_tryout_idx on public.tryout_players (tryout_id);
alter table public.tryout_players enable row level security;
-- Families can sign up while sign-ups are open. Only coaches can see the list.
drop policy if exists "families sign up" on public.tryout_players;
create policy "families sign up" on public.tryout_players for insert with check (
  status = 'registered' and placed_team_id is null and placed_player_id is null and ai_summary is null
  and exists (select 1 from public.tryouts t where t.id = tryout_id and t.team_id = tryout_players.team_id and t.signups_open));
drop policy if exists "coaches add tryout players" on public.tryout_players;
create policy "coaches add tryout players" on public.tryout_players for insert with check (public.has_role(team_id, array['admin','coach']));
drop policy if exists "coaches read tryout players" on public.tryout_players;
create policy "coaches read tryout players" on public.tryout_players for select using (public.has_role(team_id, array['admin','coach']));
drop policy if exists "coaches edit tryout players" on public.tryout_players;
create policy "coaches edit tryout players" on public.tryout_players for update using (public.has_role(team_id, array['admin','coach'])) with check (public.has_role(team_id, array['admin','coach']));
drop policy if exists "coaches delete tryout players" on public.tryout_players;
create policy "coaches delete tryout players" on public.tryout_players for delete using (public.has_role(team_id, array['admin','coach']));

create table if not exists public.tryout_scores (
  id               uuid primary key default gen_random_uuid(),
  tryout_player_id uuid not null references public.tryout_players on delete cascade,
  team_id          text not null references public.teams on delete cascade,
  coach_id         uuid not null default auth.uid(),
  coach_name       text default '',
  arm int check (arm between 1 and 5), speed int check (speed between 1 and 5), fielding int check (fielding between 1 and 5),
  hitting int check (hitting between 1 and 5), pitching int check (pitching between 1 and 5),
  sixty numeric, velo numeric, pop numeric,
  note             text default '' check (char_length(note) <= 500),
  updated_at       timestamptz default now(),
  unique (tryout_player_id, coach_id)
);
alter table public.tryout_scores enable row level security;
drop policy if exists "coaches read scores" on public.tryout_scores;
create policy "coaches read scores" on public.tryout_scores for select using (public.has_role(team_id, array['admin','coach']));
drop policy if exists "coaches write own scores" on public.tryout_scores;
create policy "coaches write own scores" on public.tryout_scores for insert with check (public.has_role(team_id, array['admin','coach']) and coach_id = auth.uid());
drop policy if exists "coaches update own scores" on public.tryout_scores;
create policy "coaches update own scores" on public.tryout_scores for update using (coach_id = auth.uid()) with check (coach_id = auth.uid());
drop policy if exists "coaches delete scores" on public.tryout_scores;
create policy "coaches delete scores" on public.tryout_scores for delete using (public.has_role(team_id, array['admin','coach']));

-- ---------- recruiting profiles (off unless the family agrees; shared only by secret link) ----------
create table if not exists public.recruit_profiles (
  player_id          uuid primary key references public.players on delete cascade,
  team_id            text not null references public.teams on delete cascade,
  enabled            boolean not null default false,
  share_token        text unique,
  full_name          text default '',
  grad_year          int,
  positions          text default '',
  bats               text default '',
  throws             text default '',
  height             text default '',
  weight             text default '',
  gpa                text default '',
  school             text default '',
  bio                text default '' check (char_length(bio) <= 2000),
  highlight_media_id uuid references public.media on delete set null,
  highlight_url      text default '',
  contact_name       text default '',
  contact_email      text default '',
  show_stats         boolean not null default true,
  show_measurements  boolean not null default true,
  updated_at         timestamptz default now()
);
alter table public.recruit_profiles enable row level security;
drop policy if exists "coaches manage recruiting" on public.recruit_profiles;
create policy "coaches manage recruiting" on public.recruit_profiles for all using (public.has_role(team_id, array['admin','coach'])) with check (public.has_role(team_id, array['admin','coach']));

-- ---------- showcases and camps on a player's calendar ----------
create table if not exists public.player_events (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references public.teams on delete cascade,
  player_id  uuid not null references public.players on delete cascade,
  date       date not null,
  title      text not null check (char_length(title) between 1 and 120),
  location   text default '',
  note       text default '' check (char_length(note) <= 300),
  created_at timestamptz default now()
);
create index if not exists player_events_player_idx on public.player_events (player_id, date);
alter table public.player_events enable row level security;
drop policy if exists "coaches manage player events" on public.player_events;
create policy "coaches manage player events" on public.player_events for all using (public.has_role(team_id, array['admin','coach'])) with check (public.has_role(team_id, array['admin','coach']));
