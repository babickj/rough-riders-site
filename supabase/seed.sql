-- Run after schema.sql. Creates the Rough Riders team and makes you the site owner.
-- 1) First create your own login: Dashboard > Authentication > Users > Add user > Create new user
--    (enter your email and a password, and tick "Auto Confirm User").
-- 2) Replace YOUR_EMAIL below with that same email, then run this whole file.

insert into public.teams (id, name, season, league, innings, pitch_max)
values ('rough-riders', 'Rough Riders', 'Spring 2027', 'Majors (ages 11–12)', 6, 85)
on conflict (id) do nothing;

insert into public.site_admins (user_id)
select id from auth.users where lower(email) = lower('YOUR_EMAIL')
on conflict do nothing;

insert into public.memberships (user_id, team_id, role, display_name, email)
select id, 'rough-riders', 'admin', 'John', email from auth.users where lower(email) = lower('YOUR_EMAIL')
on conflict (user_id, team_id) do update set role = 'admin';

-- Check: this should return one row with your email.
select u.email, m.role from public.memberships m join auth.users u on u.id = m.user_id;
