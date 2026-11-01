-- Lets visitors ask for a login from the Sign in page. Run once in Supabase SQL Editor (safe to re-run).
create table if not exists public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  team_id    text not null references public.teams on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  email      text not null check (char_length(email) between 3 and 200),
  player     text default '' check (char_length(player) <= 80),
  role       text not null default 'parent' check (role in ('parent','scorekeeper')),
  note       text default '' check (char_length(note) <= 300),
  status     text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz default now()
);
alter table public.access_requests enable row level security;
-- Anyone can send a request; nobody but the team's admins can read or change them.
drop policy if exists "anyone can request" on public.access_requests;
create policy "anyone can request" on public.access_requests for insert with check (status = 'pending');
drop policy if exists "admins read requests" on public.access_requests;
create policy "admins read requests" on public.access_requests for select using (public.has_role(team_id, array['admin']));
drop policy if exists "admins update requests" on public.access_requests;
create policy "admins update requests" on public.access_requests for update using (public.has_role(team_id, array['admin']));
drop policy if exists "admins delete requests" on public.access_requests;
create policy "admins delete requests" on public.access_requests for delete using (public.has_role(team_id, array['admin']));
