-- ============================================================================
-- R1: teams, avatars, system iterations, member recognition, value awards,
-- fluency, and the pulse history the Gap Closed badge reads.
--
-- Run once in the Supabase SQL editor against the live project. Everything
-- here is additive and guarded (if not exists / drop policy if exists), so a
-- second run changes nothing. No existing row is modified except that
-- iterations.ritual_id stops being required.
-- ============================================================================

begin;

-- ---------------------------------------------------------------- teams

-- Every member belongs to one team. Teams are chosen when a member is added
-- and changed from the same dropdown in Admin.
create table if not exists teams (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  name       text not null,
  archived   boolean default false,
  created_at timestamptz default now()
);
create unique index if not exists teams_org_name on teams (org_id, lower(name));
alter table teams enable row level security;

drop policy if exists "members read teams" on teams;
create policy "members read teams" on teams for select using (is_member(org_id));
drop policy if exists "editors write teams" on teams;
create policy "editors write teams" on teams for all
  using (can_edit(org_id)) with check (can_edit(org_id));

alter table memberships add column if not exists team_id uuid references teams(id) on delete set null;
create index if not exists memberships_team on memberships (team_id);

-- ---------------------------------------------------------------- avatars

-- The picture lives in storage; the membership row holds its path. A member
-- changes their own picture and nothing else about their membership, so this
-- goes through a function rather than opening updates on memberships.
alter table memberships     add column if not exists avatar_path text;
alter table platform_admins add column if not exists avatar_path text;

create or replace function set_my_avatar(p_path text)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- Keys are {org_id}/{user_id}/{file}; the second segment must be the caller.
  if p_path is not null and split_part(p_path, '/', 2) <> auth.uid()::text then
    raise exception 'That picture belongs to someone else';
  end if;
  update memberships     set avatar_path = p_path where user_id = auth.uid();
  update platform_admins set avatar_path = p_path where user_id = auth.uid();
end $$;
grant execute on function set_my_avatar(text) to authenticated;

-- Everyone who can appear on this organization's pages, with name, team and
-- picture: the members, plus the super user, who authors content without
-- holding a membership.
-- in_org is false for the super user, who can author but cannot be recognized.
drop function if exists org_people(uuid);
create or replace function org_people(p_org uuid)
returns table (user_id uuid, display_name text, role text, team_id uuid, avatar_path text, in_org boolean)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(m.display_name, m.email), m.role::text, m.team_id, m.avatar_path, true
    from memberships m
   where m.org_id = p_org and is_member(p_org)
  union all
  select pa.user_id,
         coalesce(u.raw_user_meta_data->>'display_name', u.email),
         'owner', null::uuid, pa.avatar_path, false
    from platform_admins pa
    join auth.users u on u.id = pa.user_id
   where is_member(p_org)
     and not exists (select 1 from memberships m2 where m2.user_id = pa.user_id and m2.org_id = p_org);
$$;
grant execute on function org_people(uuid) to authenticated;

-- Pictures are small and not sensitive, so the bucket is public-read: one
-- plain URL per face instead of a signed link per page load. The path carries
-- two random ids, so it cannot be guessed.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "members upload own avatar" on storage.objects;
create policy "members upload own avatar" on storage.objects for insert
  with check (bucket_id = 'avatars'
    and (storage.foldername(name))[2] = auth.uid()::text
    and is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists "members replace own avatar" on storage.objects;
create policy "members replace own avatar" on storage.objects for update
  using (bucket_id = 'avatars' and owner = auth.uid());
drop policy if exists "members delete own avatar" on storage.objects;
create policy "members delete own avatar" on storage.objects for delete
  using (bucket_id = 'avatars' and owner = auth.uid());

-- ---------------------------------------------------------------- iterations

-- An iteration is now a run of a ritual OR an execution of a system, never
-- both, and it can be credited to a team.
alter table iterations alter column ritual_id drop not null;
alter table iterations add column if not exists system_category_id uuid
  references system_categories(id) on delete cascade;
alter table iterations add column if not exists team_id uuid
  references teams(id) on delete set null;
create index if not exists iterations_team on iterations (team_id);
create index if not exists iterations_system on iterations (system_category_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'iterations_one_source') then
    alter table iterations add constraint iterations_one_source
      check (num_nonnulls(ritual_id, system_category_id) = 1);
  end if;
end $$;

-- A team tagged on an iteration must belong to the same organization.
drop policy if exists "leaders record iterations" on iterations;
create policy "leaders record iterations" on iterations for insert
  with check (can_lead(org_id) and recorded_by = auth.uid()
    and (team_id is null or exists (select 1 from teams t where t.id = team_id and t.org_id = iterations.org_id)));

-- The old edit policy was FOR ALL, which also admitted inserts from any member
-- recording as themselves and skipped the check above. Edits and deletes
-- keep their old rule; inserts now go through the leader policy only.
drop policy if exists "recorder or champion edits iterations" on iterations;
drop policy if exists "recorder or champion updates iterations" on iterations;
create policy "recorder or champion updates iterations" on iterations for update
  using (recorded_by = auth.uid() or can_edit(org_id))
  with check (recorded_by = auth.uid() or can_edit(org_id));
drop policy if exists "recorder or champion deletes iterations" on iterations;
create policy "recorder or champion deletes iterations" on iterations for delete
  using (recorded_by = auth.uid() or can_edit(org_id));

-- ---------------------------------------------------------------- recognition

-- New recognitions name a member, so the gold star lands on that person's
-- trophy wall. Older ones keep their typed name and earn no star.
alter table recognitions add column if not exists recipient_user_id uuid
  references auth.users(id) on delete set null;
alter table recognitions add column if not exists title text;
create index if not exists recognitions_recipient on recognitions (recipient_user_id);

drop policy if exists "members write recognitions" on recognitions;
create policy "members write recognitions" on recognitions for insert
  with check (is_member(org_id) and author_id = auth.uid()
    and (recipient_user_id is null
         or (recipient_user_id <> auth.uid()
             and exists (select 1 from memberships m
                          where m.user_id = recipient_user_id and m.org_id = recognitions.org_id))));

-- ---------------------------------------------------------------- value awards

-- The award catalog: each organization names its own awards and the Values
-- each one stands for. The crest shows one pip per Value.
create table if not exists award_types (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null,
  description  text,
  grantable_to text not null default 'both' check (grantable_to in ('member','team','both')),
  grant_cap    int check (grant_cap is null or grant_cap > 0),
  cap_period   text check (cap_period in ('month','quarter','year')),
  active       boolean default true,
  created_at   timestamptz default now()
);
create index if not exists award_types_org on award_types (org_id);

create table if not exists award_type_values (
  award_type_id uuid references award_types(id) on delete cascade,
  value_id      uuid references values_(id) on delete cascade,
  primary key (award_type_id, value_id)
);

create table if not exists award_grants (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  award_type_id     uuid not null references award_types(id) on delete cascade,
  recipient_user_id uuid references auth.users(id) on delete cascade,
  team_id           uuid references teams(id) on delete cascade,
  recipient_name    text not null,
  granted_by        uuid not null references auth.users(id),
  granted_by_name   text,
  citation          text not null,
  granted_at        timestamptz default now(),
  check (num_nonnulls(recipient_user_id, team_id) = 1)
);
create index if not exists award_grants_org on award_grants (org_id, granted_at desc);

-- Who was on the team when a team award was given. The award stays on each
-- person's wall after they move teams.
create table if not exists award_grant_recipients (
  grant_id uuid references award_grants(id) on delete cascade,
  user_id  uuid references auth.users(id) on delete cascade,
  primary key (grant_id, user_id)
);

-- Scarcity is enforced here, not only in the form: the recipient kind must
-- match the award, and a grantor stays under the cap for the period.
create or replace function guard_award_grant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t award_types%rowtype;
  used int;
  since timestamptz;
begin
  select * into t from award_types where id = new.award_type_id;
  if t.org_id <> new.org_id then raise exception 'That award belongs to another organization'; end if;
  if not t.active then raise exception 'That award is retired'; end if;
  if t.grantable_to = 'member' and new.team_id is not null then
    raise exception '% goes to a person, not a team', t.name;
  end if;
  if t.grantable_to = 'team' and new.recipient_user_id is not null then
    raise exception '% goes to a team, not a person', t.name;
  end if;
  if t.grant_cap is not null and t.cap_period is not null then
    since := date_trunc(t.cap_period, now());
    select count(*) into used from award_grants
     where award_type_id = t.id and granted_by = new.granted_by and granted_at >= since;
    if used >= t.grant_cap then
      raise exception 'You have given % % this %, the limit for this award', used, t.name, t.cap_period;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists award_grants_guard on award_grants;
create trigger award_grants_guard before insert on award_grants
  for each row execute function guard_award_grant();

create or replace function snapshot_award_recipients()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.team_id is not null then
    insert into award_grant_recipients (grant_id, user_id)
    select new.id, m.user_id from memberships m where m.team_id = new.team_id
    on conflict do nothing;
  else
    insert into award_grant_recipients (grant_id, user_id) values (new.id, new.recipient_user_id)
    on conflict do nothing;
  end if;
  return new;
end $$;

drop trigger if exists award_grants_snapshot on award_grants;
create trigger award_grants_snapshot after insert on award_grants
  for each row execute function snapshot_award_recipients();

alter table award_types            enable row level security;
alter table award_type_values      enable row level security;
alter table award_grants           enable row level security;
alter table award_grant_recipients enable row level security;

drop policy if exists "members read award types" on award_types;
create policy "members read award types" on award_types for select using (is_member(org_id));
drop policy if exists "editors write award types" on award_types;
create policy "editors write award types" on award_types for all
  using (can_edit(org_id)) with check (can_edit(org_id));

drop policy if exists "members read award values" on award_type_values;
create policy "members read award values" on award_type_values for select
  using (exists (select 1 from award_types t where t.id = award_type_id and is_member(t.org_id)));
drop policy if exists "editors write award values" on award_type_values;
create policy "editors write award values" on award_type_values for all
  using (exists (select 1 from award_types t where t.id = award_type_id and can_edit(t.org_id)))
  with check (exists (select 1 from award_types t where t.id = award_type_id and can_edit(t.org_id)));

-- Leaders give Value awards. This is the first write in the portal gated on
-- role rather than membership.
drop policy if exists "members read grants" on award_grants;
create policy "members read grants" on award_grants for select using (is_member(org_id));
drop policy if exists "leaders give awards" on award_grants;
create policy "leaders give awards" on award_grants for insert
  with check (can_lead(org_id) and granted_by = auth.uid()
    and (recipient_user_id is null or recipient_user_id <> auth.uid()));
drop policy if exists "editors remove grants" on award_grants;
create policy "editors remove grants" on award_grants for delete using (can_edit(org_id));

drop policy if exists "members read grant recipients" on award_grant_recipients;
create policy "members read grant recipients" on award_grant_recipients for select
  using (exists (select 1 from award_grants g where g.id = grant_id and is_member(g.org_id)));

-- ---------------------------------------------------------------- fluency

-- The two fluency steps that are reading rather than doing. The other two
-- come from iterations, and Fully Fluent from recognition and stories.
create table if not exists fluency_marks (
  user_id     uuid not null references auth.users(id) on delete cascade,
  behavior_id uuid not null references behaviors(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  step        text not null check (step in ('description','template')),
  marked_at   timestamptz default now(),
  primary key (user_id, behavior_id, step)
);
alter table fluency_marks enable row level security;

-- Private to the person. Nobody else, including admins, reads it.
drop policy if exists "own fluency" on fluency_marks;
create policy "own fluency" on fluency_marks for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and is_member(org_id));

-- ---------------------------------------------------------------- pulse history

-- Average spread per round, for the Gap Closed badge. Spread only, never an
-- individual's answer, so every member can read it.
create or replace function pulse_spread_by_round(p_org uuid)
returns table (round int, spread numeric, responses bigint)
language sql stable security definer set search_path = public as $$
  select x.round, round(avg(x.sd)::numeric, 3), sum(x.n)::bigint
    from (select p.round, p.behavior_id,
                 coalesce(stddev_samp(p.score), 0) as sd, count(*) as n
            from pulse_responses p
           where p.org_id = p_org
           group by p.round, p.behavior_id) x
   where is_member(p_org)
   group by x.round
   order by x.round;
$$;
grant execute on function pulse_spread_by_round(uuid) to authenticated;

-- ---------------------------------------------------------------- access
-- Supabase normally grants these on its own; stating them makes the migration
-- work the same on a project where default privileges were changed. Row level
-- security above still decides which rows anyone sees.
grant select, insert, update, delete on
  teams, award_types, award_type_values, award_grants, award_grant_recipients, fluency_marks
  to authenticated;

commit;

-- ---------------------------------------------------------------- check
-- After running, this should return eight rows.
-- select table_name from information_schema.tables
--  where table_schema = 'public'
--    and table_name in ('teams','award_types','award_type_values','award_grants',
--                       'award_grant_recipients','fluency_marks','iterations','recognitions');
