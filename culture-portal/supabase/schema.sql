-- Culture Portal schema for Supabase / Postgres
-- Run in the Supabase SQL editor, or: supabase db push

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- organizations

create table organizations (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  subtitle      text,
  initials      text,
  accent        text default '#9C7A3C',
  vision        text,
  mission       text,
  creed         text,
  -- Billing. Two paid tiers plus a free one; rates are per organization and
  -- set by the super user, so a client can be quoted their own price.
  plan          text default 'free' check (plan in ('free','small','unlimited')),
  billing_cycle text check (billing_cycle in ('monthly','yearly')),
  rate_small_monthly     numeric default 49,
  rate_small_yearly      numeric default 490,
  rate_unlimited_monthly numeric default 149,
  rate_unlimited_yearly  numeric default 1490,
  paid_through   date,
  -- A plan the organization has chosen but that is not yet paid for. Cleared
  -- when a payment is recorded, by the super user or by the Stripe webhook.
  pending_change jsonb,
  has_example_content boolean default false,
  cancel_at_period_end boolean default false,
  stripe_customer_id     text,
  stripe_subscription_id text,
  -- How far back "recent" reaches on behavior pages and in Conviction.
  recent_days   int default 45,
  -- How many behaviors a person is asked to rate when they sign in.
  pulse_per_signin int default 2,
  -- When on, the behavior of the week steps through the rotation with the
  -- calendar instead of being set by hand.
  auto_advance  boolean default false,
  weekly_behavior_id uuid,
  weekly_set_at timestamptz,
  created_at    timestamptz default now()
);

-- Several people can be admin; exactly one is the culture champion, whose
-- seat is the free tier and survives a lapsed subscription.
create type member_role as enum ('member','leader','admin','champion','owner');

-- One membership per person: a user belongs to exactly one organization and
-- can only ever see that organization's data. The super user is handled
-- separately, through platform_admins.
create table memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade unique,
  role       member_role not null default 'member',
  display_name text,
  email      text,
  created_at timestamptz default now()
);
create index on memberships (org_id);
create unique index one_champion_per_org on memberships (org_id) where role = 'champion';

-- Horizon Line staff: access to every organization.
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade
);

create table billing_events (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  kind       text not null,
  stripe_id  text,
  detail     jsonb,
  created_at timestamptz default now()
);

-- Someone asking to join. The account exists but has no membership, so it
-- cannot sign in until an admin turns the request into one.
create table access_requests (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  name       text not null,
  email      text not null,
  note       text,
  status     text not null default 'pending' check (status in ('pending','approved','declined')),
  created_at timestamptz default now()
);
create index on access_requests (org_id, status);

-- ---------------------------------------------------------------- helpers
-- security definer so policies can read memberships without recursing through RLS

-- Exposed to the client as an rpc so the app can tell whether to show the
-- organization switcher.
create or replace function is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from platform_admins where user_id = auth.uid());
$$;

create or replace function org_role(p_org uuid)
returns member_role language sql stable security definer set search_path = public as $$
  select case when is_platform_admin() then 'owner'::member_role
    else (select role from memberships where org_id = p_org and user_id = auth.uid()) end;
$$;

create or replace function is_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select org_role(p_org) is not null;
$$;

-- Seats by tier. The free tier is the culture champion's own access, which
-- never lapses; an organization that stops paying keeps its content and its
-- champion, and everyone else is locked out.
create or replace function plan_seats(p_plan text)
returns int language sql immutable as $$
  select case p_plan when 'unlimited' then 2147483647 when 'small' then 9 else 1 end;
$$;

-- Current is worked out from the paid-through date. There is no separate flag
-- to fall out of step with it.
create or replace function billing_is_current(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select paid_through is not null and paid_through >= current_date
    from organizations where id = p_org;
$$;

create or replace function effective_plan(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when (select plan from organizations where id = p_org) = 'free' then 'free'
    when billing_is_current(p_org) then (select plan from organizations where id = p_org)
    else 'free'
  end;
$$;

create or replace function billing_status(p_org uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'plan', o.plan,
    'cycle', o.billing_cycle,
    'paid_through', o.paid_through,
    'current', billing_is_current(p_org),
    'lapsed', o.plan <> 'free' and not billing_is_current(p_org),
    'cancel_at_period_end', coalesce(o.cancel_at_period_end, false),
    'expiring', coalesce(o.cancel_at_period_end, false) and billing_is_current(p_org),
    'pending_change', o.pending_change,
    'seats_used', (select count(*) from memberships m where m.org_id = o.id),
    'seats_allowed', case when effective_plan(p_org) = 'unlimited' then null
                          else plan_seats(effective_plan(p_org)) end,
    'rates', json_build_object(
      'small', json_build_object('monthly', o.rate_small_monthly, 'yearly', o.rate_small_yearly),
      'unlimited', json_build_object('monthly', o.rate_unlimited_monthly, 'yearly', o.rate_unlimited_yearly))
  )
  from organizations o where o.id = p_org and is_member(p_org);
$$;

-- Seats are enforced in the database, not only in the interface.
create or replace function guard_seats()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  used int;
  allowed int;
begin
  if tg_op = 'UPDATE' and new.org_id = old.org_id then return new; end if;
  select count(*) into used from memberships where org_id = new.org_id;
  allowed := plan_seats(effective_plan(new.org_id));
  if used >= allowed and not is_platform_admin() then
    raise exception 'That plan covers % people and % are in use', allowed, used;
  end if;
  return new;
end $$;

create trigger memberships_guard_seats
  before insert or update on memberships
  for each row execute function guard_seats();

create or replace function can_edit(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select org_role(p_org) in ('admin','champion','owner');
$$;

create or replace function can_lead(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select org_role(p_org) in ('leader','admin','champion','owner');
$$;

-- ---------------------------------------------------------------- content

-- The five categories are shared across every organization.
create table categories (
  name           text primary key,
  question       text not null,
  considerations text,
  position       int  not null
);

create table values_ (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  description text,
  position    int default 0,
  is_example  boolean default false,
  unique (org_id, name)
);

create table system_categories (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete cascade,
  name     text not null,
  position int default 0,
  is_example boolean default false,
  unique (org_id, name)
);

create table behaviors (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  number      int  not null,
  title       text not null,
  description text not null,
  category    text references categories(name),
  quick_tip   text,
  coaching_tips  text[] default '{}',
  teaching_points text[] default '{}',
  questions   text[] default '{}',
  failure_state text,
  hard_rule   text,
  archived    boolean default false,
  is_example  boolean default false,
  created_at  timestamptz default now(),
  unique (org_id, number)
);
create index on behaviors (org_id);

alter table organizations
  add constraint organizations_weekly_fk
  foreign key (weekly_behavior_id) references behaviors(id) on delete set null;

create table behavior_values (
  behavior_id uuid references behaviors(id) on delete cascade,
  value_id    uuid references values_(id) on delete cascade,
  primary key (behavior_id, value_id)
);

-- A behavior applied to a system category, with the artifact that makes it real.
create table placements (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  behavior_id  uuid not null references behaviors(id) on delete cascade,
  system_category_id uuid not null references system_categories(id) on delete cascade,
  owner        text not null,
  cadence      text not null,
  artifact     text not null,
  template     text,
  created_at   timestamptz default now(),
  unique (behavior_id, system_category_id)
);

-- Rituals are written once and shared across behaviors.
create table rituals (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  -- A ritual that applies to every behavior rather than to a list of them:
  -- the weekly practice session is one of these.
  applies_to_all boolean default false,
  name        text not null,
  cadence     text not null,
  owner       text not null,
  description text,
  practice    text,
  created_at  timestamptz default now()
);

create table behavior_rituals (
  behavior_id uuid references behaviors(id) on delete cascade,
  ritual_id   uuid references rituals(id) on delete cascade,
  primary key (behavior_id, ritual_id)
);

-- ---------------------------------------------------------------- activity

create table stories (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  behavior_id uuid not null references behaviors(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  body        text not null,
  created_at  timestamptz default now()
);
create index on stories (org_id, created_at desc);

create table story_attachments (
  id           uuid primary key default gen_random_uuid(),
  story_id     uuid not null references stories(id) on delete cascade,
  storage_path text not null,          -- bucket: story-media, key: {org_id}/{story_id}/{filename}
  file_name    text not null,
  mime_type    text,
  byte_size    bigint,
  kind         text check (kind in ('image','video','file')) default 'file',
  created_at   timestamptz default now()
);

create table story_shares (
  id         uuid primary key default gen_random_uuid(),
  story_id   uuid not null references stories(id) on delete cascade,
  sent_by    uuid not null references auth.users(id),
  recipients text[] not null,
  note       text,
  sent_at    timestamptz default now(),
  status     text default 'sent'
);

create table recognitions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  behavior_id uuid not null references behaviors(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  recipient   text not null,
  body        text not null,
  created_at  timestamptz default now()
);
create index on recognitions (org_id, created_at desc);

-- One recorded run of a ritual. Recency and count on Conviction come from here.
create table iterations (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  ritual_id    uuid not null references rituals(id) on delete cascade,
  behavior_ids uuid[] default '{}',
  recorded_by  uuid references auth.users(id),
  recorded_by_name text,
  held_at      timestamptz not null default now(),
  notes        text,
  created_at   timestamptz default now()
);
create index on iterations (org_id, held_at desc);
create index on iterations using gin (behavior_ids);

create table iteration_attachments (
  id           uuid primary key default gen_random_uuid(),
  iteration_id uuid not null references iterations(id) on delete cascade,
  storage_path text not null,
  file_name    text not null,
  mime_type    text,
  byte_size    bigint,
  kind         text check (kind in ('image','video','file')) default 'file'
);

create table recognition_attachments (
  id             uuid primary key default gen_random_uuid(),
  recognition_id uuid not null references recognitions(id) on delete cascade,
  storage_path   text not null,
  file_name      text not null,
  mime_type      text,
  byte_size      bigint,
  kind           text check (kind in ('image','video','file')) default 'file'
);

-- Measures are defined once; a value is recorded per period.
create table measures (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references organizations(id) on delete cascade,
  name     text not null,
  note     text,
  position int default 0
);

create table measure_entries (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  period      text not null,
  values      jsonb not null default '{}'::jsonb,   -- { measure_id: "64%" }
  recorded_by_name text,
  recorded_at timestamptz default now()
);

-- ---------------------------------------------------------------- measurement

-- Two behaviors per sign-in. A round closes once every behavior has been
-- scored by a quarter of the organization; then the next round opens.
create table pulse_responses (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  behavior_id uuid not null references behaviors(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  round       int not null default 1,
  score       int not null check (score between 1 and 5),
  created_at  timestamptz default now(),
  unique (round, behavior_id, user_id)
);

create or replace function pulse_status(p_org uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  members int;
  target  int;
  r       int;
  covered int;
  total   int;
begin
  if not is_member(p_org) then raise exception 'Not a member of that organization'; end if;

  select count(*) into members from memberships where org_id = p_org;
  target := greatest(1, ceil(coalesce(members,1) * 0.25));
  select coalesce(max(round),1) into r from pulse_responses where org_id = p_org;
  -- Example content is not rated, so it does not count toward a round.
  select count(*) into total from behaviors
   where org_id = p_org and archived = false and not is_example;

  select count(*) into covered from behaviors b
   where b.org_id = p_org and b.archived = false and not b.is_example
     and (select count(*) from pulse_responses p
           where p.behavior_id = b.id and p.round = r) >= target;

  -- Every behavior covered means the round is finished; the next one opens.
  if total > 0 and covered >= total then
    r := r + 1;
    covered := 0;
  end if;

  return json_build_object('round', r, 'target', target, 'scored', covered, 'total', total);
end $$;

-- The two behaviors to put in front of the caller: the least-answered ones
-- they have not scored in this round.
create or replace function pulse_assignment(p_org uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  st json;
  r int;
  target int;
begin
  st := pulse_status(p_org);
  r := (st->>'round')::int;
  target := (st->>'target')::int;

  return json_build_object(
    'round', r,
    'target', target,
    'behaviors', coalesce((
      select json_agg(x) from (
        select b.id, b.number, b.title, b.description, b.category
          from behaviors b
         where b.org_id = p_org and b.archived = false
           and not exists (select 1 from pulse_responses p
                            where p.behavior_id = b.id and p.round = r and p.user_id = auth.uid())
           and not b.is_example
           and (select count(*) from pulse_responses p
                 where p.behavior_id = b.id and p.round = r) < target
         order by (select count(*) from pulse_responses p
                    where p.behavior_id = b.id and p.round = r), b.number
         limit (select coalesce(pulse_per_signin, 2) from organizations where id = p_org)
      ) x), '[]'::json)
  );
end $$;

-- Average and spread per behavior. Spread is the diagnostic, not the average.
create or replace view behavior_pulse as
select
  b.id as behavior_id,
  b.org_id,
  b.number,
  b.title,
  round(avg(r.score)::numeric, 2)          as avg_score,
  round(coalesce(stddev_samp(r.score),0)::numeric, 2) as spread,
  count(r.id)                              as responses
from behaviors b
left join pulse_responses r on r.behavior_id = b.id
group by b.id, b.org_id, b.number, b.title;

-- Behaviors reinforced in fewer than two systems: the coverage gap report.
create or replace view behavior_coverage as
select
  b.id as behavior_id, b.org_id, b.number, b.title,
  count(p.id) as placement_count,
  count(p.id) filter (where p.template is not null) as template_count,
  (select count(*) from behavior_rituals br where br.behavior_id = b.id) as ritual_count,
  (select count(*) from iterations it where b.id = any(it.behavior_ids)) as iteration_count,
  (select max(it.held_at) from iterations it where b.id = any(it.behavior_ids)) as last_run,
  (count(p.id) < 2) as is_gap
from behaviors b
left join placements p on p.behavior_id = b.id
where b.archived = false
group by b.id, b.org_id, b.number, b.title;

-- ---------------------------------------------------------------- row level security

alter table organizations    enable row level security;
alter table memberships      enable row level security;
alter table platform_admins  enable row level security;
alter table billing_events   enable row level security;
alter table categories       enable row level security;
alter table values_          enable row level security;
alter table system_categories enable row level security;
alter table behaviors        enable row level security;
alter table behavior_values  enable row level security;
alter table placements       enable row level security;
alter table rituals          enable row level security;
alter table behavior_rituals enable row level security;
alter table stories          enable row level security;
alter table story_attachments enable row level security;
alter table story_shares     enable row level security;
alter table recognitions     enable row level security;
alter table ritual_logs      enable row level security;
alter table iterations       enable row level security;
alter table iteration_attachments enable row level security;
alter table recognition_attachments enable row level security;
alter table measures         enable row level security;
alter table measure_entries  enable row level security;
alter table pulse_responses  enable row level security;

create policy "read own orgs" on organizations for select using (is_member(id));
create policy "champions edit org" on organizations for update using (can_edit(id));

create policy "read memberships in my org" on memberships for select using (is_member(org_id));
create policy "champions manage memberships" on memberships for all
  using (can_edit(org_id)) with check (can_edit(org_id));

-- Roles are assigned, never self-selected, and only the super user can mint
-- another owner. Enforced in a trigger so it holds for the edge function too.
create or replace function guard_role_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.role = 'owner' and not is_platform_admin() then
    raise exception 'Only the super user can assign the owner role';
  end if;

  if tg_op = 'UPDATE'
     and new.user_id = auth.uid()
     and new.role is distinct from old.role
     and not is_platform_admin() then
    raise exception 'You cannot change your own role';
  end if;

  return new;
end $$;

create trigger memberships_guard_role
  before insert or update on memberships
  for each row execute function guard_role_assignment();

-- Only the super user creates organizations.
create policy "super user creates orgs" on organizations for insert
  with check (is_platform_admin());

-- Rates and payment state are the super user's to set; a champion changes the
-- rest of the organization record but not what it is charged.
create or replace function guard_billing_fields()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if is_platform_admin() then return new; end if;
  if new.plan is distinct from old.plan
     or new.paid_through is distinct from old.paid_through
     or new.rate_small_monthly is distinct from old.rate_small_monthly
     or new.rate_small_yearly is distinct from old.rate_small_yearly
     or new.rate_unlimited_monthly is distinct from old.rate_unlimited_monthly
     or new.rate_unlimited_yearly is distinct from old.rate_unlimited_yearly then
    raise exception 'Billing is set by the super user or by Stripe, not from the app';
  end if;
  return new;
end $$;

create trigger organizations_guard_billing
  before update on organizations
  for each row execute function guard_billing_fields();

create policy "members read billing events" on billing_events for select using (is_member(org_id));

create policy "read platform admins" on platform_admins for select using (is_platform_admin());

alter table access_requests enable row level security;
create policy "admins read requests" on access_requests for select using (can_edit(org_id));
create policy "admins update requests" on access_requests for update
  using (can_edit(org_id)) with check (can_edit(org_id));

-- The join form needs organization names and nothing else, so it gets a
-- function rather than read access to the table.
create or replace function organization_names()
returns table (id uuid, name text) language sql stable security definer set search_path = public as $$
  select id, name from organizations order by name;
$$;
grant execute on function organization_names() to anon, authenticated;
create policy "categories readable" on categories for select using (auth.role() = 'authenticated');

-- Content: everyone in the org reads, champions and owners write.
do $$
declare t text;
begin
  foreach t in array array['values_','system_categories','behaviors','placements','rituals','measures']
  loop
    execute format($f$
      create policy "members read %1$s" on %1$I for select using (is_member(org_id));
      create policy "champions write %1$s" on %1$I for all
        using (can_edit(org_id)) with check (can_edit(org_id));
    $f$, t);
  end loop;
end $$;

-- Join tables inherit the behavior's organization.
create policy "members read behavior_values" on behavior_values for select
  using (exists (select 1 from behaviors b where b.id = behavior_id and is_member(b.org_id)));
create policy "champions write behavior_values" on behavior_values for all
  using (exists (select 1 from behaviors b where b.id = behavior_id and can_edit(b.org_id)))
  with check (exists (select 1 from behaviors b where b.id = behavior_id and can_edit(b.org_id)));

create policy "members read behavior_rituals" on behavior_rituals for select
  using (exists (select 1 from behaviors b where b.id = behavior_id and is_member(b.org_id)));
create policy "champions write behavior_rituals" on behavior_rituals for all
  using (exists (select 1 from behaviors b where b.id = behavior_id and can_edit(b.org_id)))
  with check (exists (select 1 from behaviors b where b.id = behavior_id and can_edit(b.org_id)));

-- Stories and recognition: every member posts, authors edit their own,
-- champions can remove anything.
create policy "members read stories" on stories for select using (is_member(org_id));
create policy "members write stories" on stories for insert
  with check (is_member(org_id) and author_id = auth.uid());
create policy "authors edit stories" on stories for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "authors or champions delete stories" on stories for delete
  using (author_id = auth.uid() or can_edit(org_id));

create policy "members read recognitions" on recognitions for select using (is_member(org_id));
create policy "members write recognitions" on recognitions for insert
  with check (is_member(org_id) and author_id = auth.uid());
create policy "authors edit recognitions" on recognitions for update
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "authors or champions delete recognitions" on recognitions for delete
  using (author_id = auth.uid() or can_edit(org_id));

create policy "members read attachments" on story_attachments for select
  using (exists (select 1 from stories s where s.id = story_id and is_member(s.org_id)));
create policy "authors write attachments" on story_attachments for all
  using (exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()))
  with check (exists (select 1 from stories s where s.id = story_id and s.author_id = auth.uid()));

create policy "members read shares" on story_shares for select
  using (exists (select 1 from stories s where s.id = story_id and is_member(s.org_id)));
create policy "members create shares" on story_shares for insert
  with check (sent_by = auth.uid()
    and exists (select 1 from stories s where s.id = story_id and is_member(s.org_id)));

create policy "members read iterations" on iterations for select using (is_member(org_id));
create policy "leaders record iterations" on iterations for insert
  with check (can_lead(org_id) and recorded_by = auth.uid());
create policy "recorder or champion edits iterations" on iterations for all
  using (recorded_by = auth.uid() or can_edit(org_id))
  with check (recorded_by = auth.uid() or can_edit(org_id));

create policy "members read iteration files" on iteration_attachments for select
  using (exists (select 1 from iterations i where i.id = iteration_id and is_member(i.org_id)));
create policy "recorder writes iteration files" on iteration_attachments for all
  using (exists (select 1 from iterations i where i.id = iteration_id and i.recorded_by = auth.uid()))
  with check (exists (select 1 from iterations i where i.id = iteration_id and i.recorded_by = auth.uid()));

create policy "members read recognition files" on recognition_attachments for select
  using (exists (select 1 from recognitions r where r.id = recognition_id and is_member(r.org_id)));
create policy "authors write recognition files" on recognition_attachments for all
  using (exists (select 1 from recognitions r where r.id = recognition_id and r.author_id = auth.uid()))
  with check (exists (select 1 from recognitions r where r.id = recognition_id and r.author_id = auth.uid()));

-- Measure definitions are champion-only (covered by the loop above);
-- recording a period is open to anyone leading.
create policy "members read measure entries" on measure_entries for select using (is_member(org_id));
create policy "leaders record measure entries" on measure_entries for insert
  with check (can_lead(org_id));

-- Pulse: you write your own answers, leaders read the aggregate.
create policy "own pulse responses" on pulse_responses for all
  using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(org_id));
create policy "leaders read pulse" on pulse_responses for select using (can_lead(org_id));

-- ---------------------------------------------------------------- storage

insert into storage.buckets (id, name, public)
values ('story-media','story-media', false)
on conflict (id) do nothing;

-- Keys are {org_id}/{story_id}/{filename}, so the first path segment carries the tenant.
create policy "members read story media" on storage.objects for select
  using (bucket_id = 'story-media' and is_member(((storage.foldername(name))[1])::uuid));
create policy "members upload story media" on storage.objects for insert
  with check (bucket_id = 'story-media' and is_member(((storage.foldername(name))[1])::uuid));
create policy "owners delete story media" on storage.objects for delete
  using (bucket_id = 'story-media' and owner = auth.uid());

-- ---------------------------------------------------------------- seed the shared categories

insert into categories (name, question, considerations, position) values
 ('Character','Who are we when it costs us?','Integrity, trust, accountability, courage, results-focused, candor, transparency, humility, persistence',1),
 ('Connection','How do we treat people?','Care, teamwork, flourishing, belonging, inclusion, respect, safety, wellbeing, fun, spirit',2),
 ('Craft','How do we make decisions and do our work?','Excellence, high standards, speed, bias for action, rigor, stewardship, value delivery, truth-seeking, simplicity',3),
 ('Cause','Who is this for? What impact will we make?','Customer devotion, broader responsibility, long-term orientation, mattering, intrinsic motivation',4),
 ('Change','How do we adapt, grow, and accept to stay significant?','Innovation, creativity, learning, growth, continuous improvement, facing loss, limits, surrender versus ownership',5)
on conflict (name) do nothing;
