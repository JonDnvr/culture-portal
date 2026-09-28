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

-- ================================================================ R1
-- Teams, avatars, system iterations, member recognition, value awards and
-- fluency. Identical to migrations/2026-09-25-r1-gamification.sql, which is
-- what an existing project runs instead of this whole file.

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

-- ================================================================ R2
-- Identical to migrations/2026-09-25-r2-members-files-terms.sql.

-- ---------------------------------------------------------------- recording

-- Recording a ritual or system run is now open to every member, not only
-- leaders. The team check from R1 stays.
drop policy if exists "leaders record iterations" on iterations;
drop policy if exists "members record iterations" on iterations;
create policy "members record iterations" on iterations for insert
  with check (is_member(org_id) and recorded_by = auth.uid()
    and (team_id is null or exists (select 1 from teams t where t.id = team_id and t.org_id = iterations.org_id)));

-- Their files follow the same rule: whoever recorded the run attaches to it.
-- (Unchanged from before; restated so the two stay visibly in step.)

-- ---------------------------------------------------------------- award files

create table if not exists award_grant_attachments (
  id           uuid primary key default gen_random_uuid(),
  grant_id     uuid not null references award_grants(id) on delete cascade,
  storage_path text not null,          -- bucket: story-media, key: {org_id}/awards/{grant_id}/{file}
  file_name    text not null,
  mime_type    text,
  byte_size    bigint,
  kind         text check (kind in ('image','video','file')) default 'file',
  created_at   timestamptz default now()
);
alter table award_grant_attachments enable row level security;

drop policy if exists "members read award files" on award_grant_attachments;
create policy "members read award files" on award_grant_attachments for select
  using (exists (select 1 from award_grants g where g.id = grant_id and is_member(g.org_id)));
drop policy if exists "giver writes award files" on award_grant_attachments;
create policy "giver writes award files" on award_grant_attachments for all
  using (exists (select 1 from award_grants g where g.id = grant_id and g.granted_by = auth.uid()))
  with check (exists (select 1 from award_grants g where g.id = grant_id and g.granted_by = auth.uid()));

grant select, insert, update, delete on award_grant_attachments to authenticated;

-- ---------------------------------------------------------------- the word

-- What this organization calls its behaviors: Foundations, Fundamentals,
-- Behaviors. Empty means the default.
alter table organizations add column if not exists behavior_label text;
alter table organizations add column if not exists behavior_label_plural text;

-- ================================================================ R3
-- Identical to migrations/2026-09-26-r3-edit-drafts.sql.

-- ---------------------------------------------------------------- drafts

alter table stories      add column if not exists is_draft boolean not null default false;
alter table recognitions add column if not exists is_draft boolean not null default false;
alter table iterations   add column if not exists is_draft boolean not null default false;
alter table award_grants add column if not exists is_draft boolean not null default false;

alter table stories      add column if not exists updated_at timestamptz;
alter table recognitions add column if not exists updated_at timestamptz;
alter table iterations   add column if not exists updated_at timestamptz;
alter table award_grants add column if not exists updated_at timestamptz;

-- Everyone in the organization reads published records; a draft only its author.
drop policy if exists "members read stories" on stories;
create policy "members read stories" on stories for select
  using (is_member(org_id) and (not is_draft or author_id = auth.uid()));

drop policy if exists "members read recognitions" on recognitions;
create policy "members read recognitions" on recognitions for select
  using (is_member(org_id) and (not is_draft or author_id = auth.uid()));

drop policy if exists "members read iterations" on iterations;
create policy "members read iterations" on iterations for select
  using (is_member(org_id) and (not is_draft or recorded_by = auth.uid()));

drop policy if exists "members read grants" on award_grants;
create policy "members read grants" on award_grants for select
  using (is_member(org_id) and (not is_draft or granted_by = auth.uid()));

-- ---------------------------------------------------------------- edit and delete

drop policy if exists "authors edit stories" on stories;
drop policy if exists "authors or editors edit stories" on stories;
create policy "authors or editors edit stories" on stories for update
  using (author_id = auth.uid() or can_edit(org_id))
  with check (author_id = auth.uid() or can_edit(org_id));
drop policy if exists "authors or champions delete stories" on stories;
create policy "authors or champions delete stories" on stories for delete
  using (author_id = auth.uid() or can_edit(org_id));

drop policy if exists "authors edit recognitions" on recognitions;
drop policy if exists "authors or editors edit recognitions" on recognitions;
create policy "authors or editors edit recognitions" on recognitions for update
  using (author_id = auth.uid() or can_edit(org_id))
  with check (author_id = auth.uid() or can_edit(org_id));
drop policy if exists "authors or champions delete recognitions" on recognitions;
create policy "authors or champions delete recognitions" on recognitions for delete
  using (author_id = auth.uid() or can_edit(org_id));

drop policy if exists "recorder or champion updates iterations" on iterations;
create policy "recorder or champion updates iterations" on iterations for update
  using (recorded_by = auth.uid() or can_edit(org_id))
  with check ((recorded_by = auth.uid() or can_edit(org_id))
    and (team_id is null or exists (select 1 from teams t where t.id = team_id and t.org_id = iterations.org_id)));
drop policy if exists "recorder or champion deletes iterations" on iterations;
create policy "recorder or champion deletes iterations" on iterations for delete
  using (recorded_by = auth.uid() or can_edit(org_id));

drop policy if exists "givers or editors edit grants" on award_grants;
create policy "givers or editors edit grants" on award_grants for update
  using (granted_by = auth.uid() or can_edit(org_id))
  with check (granted_by = auth.uid() or can_edit(org_id));
drop policy if exists "editors remove grants" on award_grants;
drop policy if exists "givers or editors remove grants" on award_grants;
create policy "givers or editors remove grants" on award_grants for delete
  using (granted_by = auth.uid() or can_edit(org_id));

-- ---------------------------------------------------------------- what an edit cannot change

-- One function for all four tables. Authorship and organization are fixed;
-- a published record cannot go back to draft; publishing stamps the time, so
-- a draft written last week appears as new when it goes out.
create or replace function guard_record_edit()
returns trigger language plpgsql set search_path = public as $$
begin
  new.org_id := old.org_id;
  if old.is_draft = false and new.is_draft = true then
    raise exception 'A published record cannot go back to draft';
  end if;
  new.updated_at := now();

  if tg_table_name in ('stories', 'recognitions') then
    new.author_id := old.author_id;
    new.author_name := old.author_name;
    new.created_at := case when old.is_draft and not new.is_draft then now() else old.created_at end;
  end if;

  -- Nested, not joined with AND: a row from another table has no recipient.
  if tg_table_name = 'recognitions' then
    if new.recipient_user_id is not null then
      if new.recipient_user_id = new.author_id then
        raise exception 'Recognition goes to someone else';
      end if;
      if not exists (select 1 from memberships m
                      where m.user_id = new.recipient_user_id and m.org_id = new.org_id) then
        raise exception 'That person is not in this organization';
      end if;
    end if;
  end if;

  if tg_table_name = 'iterations' then
    new.recorded_by := old.recorded_by;
    new.recorded_by_name := old.recorded_by_name;
  end if;

  if tg_table_name = 'award_grants' then
    new.granted_by := old.granted_by;
    new.granted_by_name := old.granted_by_name;
    new.award_type_id := old.award_type_id;
    new.recipient_user_id := old.recipient_user_id;
    new.team_id := old.team_id;
    new.recipient_name := old.recipient_name;
    new.granted_at := case when old.is_draft and not new.is_draft then now() else old.granted_at end;
  end if;
  return new;
end $$;

drop trigger if exists stories_edit_guard on stories;
create trigger stories_edit_guard before update on stories
  for each row execute function guard_record_edit();
drop trigger if exists recognitions_edit_guard on recognitions;
create trigger recognitions_edit_guard before update on recognitions
  for each row execute function guard_record_edit();
drop trigger if exists iterations_edit_guard on iterations;
create trigger iterations_edit_guard before update on iterations
  for each row execute function guard_record_edit();
drop trigger if exists award_grants_edit_guard on award_grants;
create trigger award_grants_edit_guard before update on award_grants
  for each row execute function guard_record_edit();

-- ---------------------------------------------------------------- award limits count published awards

-- A draft does not use up one of the leader's awards for the period; the
-- limit is checked when it is published.
create or replace function guard_award_grant()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  t award_types%rowtype;
  used int;
  since timestamptz;
begin
  if tg_op = 'UPDATE' and not (old.is_draft and not new.is_draft) then
    return new;
  end if;
  select * into t from award_types where id = new.award_type_id;
  if t.org_id <> new.org_id then raise exception 'That award belongs to another organization'; end if;
  if not t.active then raise exception 'That award is retired'; end if;
  if t.grantable_to = 'member' and new.team_id is not null then
    raise exception '% goes to a person, not a team', t.name;
  end if;
  if t.grantable_to = 'team' and new.recipient_user_id is not null then
    raise exception '% goes to a team, not a person', t.name;
  end if;
  if new.is_draft then return new; end if;
  if t.grant_cap is not null and t.cap_period is not null then
    since := date_trunc(t.cap_period, now());
    select count(*) into used from award_grants
     where award_type_id = t.id and granted_by = new.granted_by and granted_at >= since
       and not is_draft and id <> new.id;
    if used >= t.grant_cap then
      raise exception 'You have given % % this %, the limit for this award', used, t.name, t.cap_period;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists award_grants_guard on award_grants;
create trigger award_grants_guard before insert or update on award_grants
  for each row execute function guard_award_grant();

-- A team award lands on the walls of whoever is on the team when it is
-- published, not when the draft was started.
create or replace function snapshot_award_recipients()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if not (old.is_draft and not new.is_draft) then return new; end if;
    delete from award_grant_recipients where grant_id = new.id;
  end if;
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
create trigger award_grants_snapshot after insert or update on award_grants
  for each row execute function snapshot_award_recipients();

-- ---------------------------------------------------------------- files on a record

-- Whoever may edit a record may add or remove its files.
drop policy if exists "authors write attachments" on story_attachments;
drop policy if exists "authors or editors write story files" on story_attachments;
create policy "authors or editors write story files" on story_attachments for all
  using (exists (select 1 from stories s where s.id = story_id and (s.author_id = auth.uid() or can_edit(s.org_id))))
  with check (exists (select 1 from stories s where s.id = story_id and (s.author_id = auth.uid() or can_edit(s.org_id))));

drop policy if exists "authors write recognition files" on recognition_attachments;
drop policy if exists "authors or editors write recognition files" on recognition_attachments;
create policy "authors or editors write recognition files" on recognition_attachments for all
  using (exists (select 1 from recognitions r where r.id = recognition_id and (r.author_id = auth.uid() or can_edit(r.org_id))))
  with check (exists (select 1 from recognitions r where r.id = recognition_id and (r.author_id = auth.uid() or can_edit(r.org_id))));

drop policy if exists "recorder writes iteration files" on iteration_attachments;
drop policy if exists "recorder or editors write iteration files" on iteration_attachments;
create policy "recorder or editors write iteration files" on iteration_attachments for all
  using (exists (select 1 from iterations i where i.id = iteration_id and (i.recorded_by = auth.uid() or can_edit(i.org_id))))
  with check (exists (select 1 from iterations i where i.id = iteration_id and (i.recorded_by = auth.uid() or can_edit(i.org_id))));

drop policy if exists "giver writes award files" on award_grant_attachments;
drop policy if exists "giver or editors write award files" on award_grant_attachments;
create policy "giver or editors write award files" on award_grant_attachments for all
  using (exists (select 1 from award_grants g where g.id = grant_id and (g.granted_by = auth.uid() or can_edit(g.org_id))))
  with check (exists (select 1 from award_grants g where g.id = grant_id and (g.granted_by = auth.uid() or can_edit(g.org_id))));

-- Editors may remove any file in their organization's folder; everyone else
-- keeps the old rule of removing only what they uploaded.
drop policy if exists "editors delete org media" on storage.objects;
create policy "editors delete org media" on storage.objects for delete
  using (bucket_id = 'story-media' and can_edit(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------- reports ignore drafts

create or replace view behavior_coverage as
select
  b.id as behavior_id, b.org_id, b.number, b.title,
  count(p.id) as placement_count,
  count(p.id) filter (where p.template is not null) as template_count,
  (select count(*) from behavior_rituals br where br.behavior_id = b.id) as ritual_count,
  (select count(*) from iterations it where b.id = any(it.behavior_ids) and not it.is_draft) as iteration_count,
  (select max(it.held_at) from iterations it where b.id = any(it.behavior_ids) and not it.is_draft) as last_run,
  (count(p.id) < 2) as is_gap
from behaviors b
left join placements p on p.behavior_id = b.id
where b.archived = false
group by b.id, b.org_id, b.number, b.title;


-- ================================================================ R4
-- Identical to migrations/2026-09-26-r4.sql.


-- -------------------------------------------------------- new columns

alter table organizations add column if not exists show_categories boolean not null default true;

alter table organizations add column if not exists logo_url text;

alter table organizations add column if not exists trial_ends_at date;

alter table organizations add column if not exists trial_used boolean not null default false;

alter table organizations add column if not exists has_payment_method boolean not null default false;

alter table organizations add column if not exists card_last4 text;

alter table organizations add column if not exists subscription_status text;

alter table organizations add column if not exists override_kind text;

alter table organizations add column if not exists override_plan text;

alter table organizations add column if not exists override_until date;

alter table organizations add column if not exists override_note text;

do $$ begin
  alter table organizations add constraint organizations_override_kind_check
    check (override_kind in ('invoiced','extension'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table organizations add constraint organizations_override_plan_check
    check (override_plan in ('small','unlimited'));
exception when duplicate_object then null; end $$;

alter table categories add column if not exists definition text;

alter table values_ add column if not exists category text;

do $$ begin
  alter table values_ add constraint values_category_check
    check (category in ('Character','Connection','Craft','Cause','Change'));
exception when duplicate_object then null; end $$;

alter table organizations add column if not exists botw_cadence text not null default 'weekly';

alter table organizations add column if not exists botw_day int not null default 1;

do $$ begin
  alter table organizations add constraint organizations_botw_cadence_check check (botw_cadence in ('daily','weekly','monthly'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table organizations add constraint organizations_botw_day_check check (botw_day between 1 and 28);
exception when duplicate_object then null; end $$;

alter table memberships add column if not exists email_opt_out boolean not null default false;

alter table organizations alter column rate_small_monthly set default 15;

alter table organizations alter column rate_small_yearly set default 159;

alter table organizations alter column rate_unlimited_monthly set default 49;

alter table organizations alter column rate_unlimited_yearly set default 499;

alter table memberships add column if not exists inactive boolean not null default false;

-- -------------------------------------------------------- new tables

create table if not exists billing_notices (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  notice_key text not null,
  kind       text not null,
  sent_to    text,
  sent_at    timestamptz default now(),
  unique (org_id, notice_key)
);

create table if not exists platform_settings (
  id    int primary key default 1 check (id = 1),
  rates jsonb not null
);

insert into platform_settings (id, rates)
values (1, '{"small":{"monthly":15,"yearly":159},"unlimited":{"monthly":49,"yearly":499}}')
on conflict (id) do nothing;

-- -------------------------------------------------------- access rules and functions

create or replace function portal_today()
returns date language sql stable as $$
  select (now() at time zone 'America/Denver')::date;
$$;

create or replace function access_status(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when o.override_kind is not null and o.override_until >= portal_today() then 'override'
    when coalesce(o.plan, 'free') = 'free' then 'free'
    when o.paid_through >= portal_today() then
      case when coalesce(o.cancel_at_period_end, false) then 'cancelling' else 'active' end
    when o.trial_ends_at >= portal_today() then 'trial'
    when o.paid_through is not null and not coalesce(o.cancel_at_period_end, false)
         and o.paid_through + 7 >= portal_today() then 'grace'
    when o.paid_through is not null and not coalesce(o.cancel_at_period_end, false) then 'lapsed'
    when o.paid_through is not null then 'ended'
    when o.trial_ends_at is not null then 'trial_ended'
    else 'lapsed'
  end
  from organizations o where o.id = p_org;
$$;

create or replace function access_full(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select access_status(p_org) in ('override','active','cancelling','trial','grace');
$$;

create or replace function billing_is_current(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select access_full(p_org);
$$;

create or replace function effective_plan(p_org uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when not access_full(p_org) then 'free'
    when access_status(p_org) = 'override' then
      coalesce(o.override_plan, case when coalesce(o.plan, 'free') = 'free' then 'unlimited' else o.plan end)
    when access_status(p_org) = 'trial' then 'unlimited'
    else o.plan
  end
  from organizations o where o.id = p_org;
$$;

create or replace function org_role(p_org uuid)
returns member_role language sql stable security definer set search_path = public as $$
  select case when is_platform_admin() then 'owner'::member_role
    else (select m.role from memberships m
          where m.org_id = p_org and m.user_id = auth.uid()
            and (m.role = 'champion' or (access_full(p_org) and not m.inactive))) end;
$$;

create or replace function my_paused_org()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'org_name', o.name,
    'inactive', m.inactive and access_full(o.id),
    'champion', (select c.display_name from memberships c where c.org_id = o.id and c.role = 'champion'))
  from memberships m join organizations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.role <> 'champion' and (m.inactive or not access_full(o.id))
  limit 1;
$$;

create or replace function billing_status(p_org uuid)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'org', json_build_object(
      'id', o.id, 'name', o.name, 'plan', o.plan, 'billing_cycle', o.billing_cycle,
      'paid_through', o.paid_through, 'cancel_at_period_end', coalesce(o.cancel_at_period_end, false),
      'trial_ends_at', o.trial_ends_at, 'trial_used', o.trial_used,
      'has_payment_method', o.has_payment_method, 'card_last4', o.card_last4,
      'subscription_status', o.subscription_status,
      'override_kind', o.override_kind, 'override_plan', o.override_plan,
      'override_until', o.override_until, 'override_note', o.override_note,
      'rate_small_monthly', o.rate_small_monthly, 'rate_small_yearly', o.rate_small_yearly,
      'rate_unlimited_monthly', o.rate_unlimited_monthly, 'rate_unlimited_yearly', o.rate_unlimited_yearly),
    'plan', o.plan,
    'cycle', o.billing_cycle,
    'paid_through', o.paid_through,
    'status', access_status(p_org),
    'current', access_full(p_org),
    'lapsed', o.plan <> 'free' and not access_full(p_org),
    'cancel_at_period_end', coalesce(o.cancel_at_period_end, false),
    'expiring', access_status(p_org) = 'cancelling',
    'pending_change', o.pending_change,
    'seats_used', (select count(*) from memberships m where m.org_id = o.id and not m.inactive),
    'total_people', (select count(*) from memberships m where m.org_id = o.id),
    'seats_allowed', case when effective_plan(p_org) = 'unlimited' then null
                          else plan_seats(effective_plan(p_org)) end,
    'rates', json_build_object(
      'small', json_build_object('monthly', o.rate_small_monthly, 'yearly', o.rate_small_yearly),
      'unlimited', json_build_object('monthly', o.rate_unlimited_monthly, 'yearly', o.rate_unlimited_yearly))
  )
  from organizations o where o.id = p_org and is_member(p_org);
$$;

create or replace function guard_billing_fields()
returns trigger language plpgsql set search_path = public as $$
begin
  if is_platform_admin() or current_user in ('service_role', 'postgres', 'supabase_admin') then
    return new;
  end if;
  if new.plan is distinct from old.plan
     or new.billing_cycle is distinct from old.billing_cycle
     or new.paid_through is distinct from old.paid_through
     or new.rate_small_monthly is distinct from old.rate_small_monthly
     or new.rate_small_yearly is distinct from old.rate_small_yearly
     or new.rate_unlimited_monthly is distinct from old.rate_unlimited_monthly
     or new.rate_unlimited_yearly is distinct from old.rate_unlimited_yearly
     or new.trial_ends_at is distinct from old.trial_ends_at
     or new.trial_used is distinct from old.trial_used
     or new.has_payment_method is distinct from old.has_payment_method
     or new.card_last4 is distinct from old.card_last4
     or new.subscription_status is distinct from old.subscription_status
     or new.cancel_at_period_end is distinct from old.cancel_at_period_end
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.override_kind is distinct from old.override_kind
     or new.override_plan is distinct from old.override_plan
     or new.override_until is distinct from old.override_until
     or new.override_note is distinct from old.override_note then
    raise exception 'Billing is set by the super user or by Stripe, not from the app';
  end if;
  return new;
end $$;

create or replace function guard_seats()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  used int;
  allowed int;
begin
  if tg_op = 'UPDATE' and new.org_id = old.org_id
     and not (coalesce(old.inactive, false) and not coalesce(new.inactive, false)) then
    return new;
  end if;
  if coalesce(new.inactive, false) then return new; end if;
  select count(*) into used from memberships
   where org_id = new.org_id and not inactive and id <> new.id;
  allowed := plan_seats(effective_plan(new.org_id));
  if used >= allowed and not is_platform_admin() and auth.uid() is not null then
    raise exception 'That plan covers % people and % are in use', allowed, used;
  end if;
  return new;
end $$;

create or replace function enforce_seats(p_org uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  ep text;
  cap int;
  n_in int := 0;
  n_re int := 0;
begin
  if auth.uid() is not null and not can_edit(p_org) then
    raise exception 'Only an editor of that organization can do that';
  end if;
  ep := effective_plan(p_org);
  if ep = 'free' then return json_build_object('inactivated', 0, 'reactivated', 0); end if;
  cap := plan_seats(ep);
  with ranked as (
    select id, inactive,
           row_number() over (order by (role = 'champion') desc, created_at, id) as rn
      from memberships where org_id = p_org
  ), went as (
    update memberships m set inactive = true from ranked r
     where m.id = r.id and r.rn > cap and not r.inactive returning 1
  ), back as (
    update memberships m set inactive = false from ranked r
     where m.id = r.id and r.rn <= cap and r.inactive returning 1
  )
  select (select count(*) from went), (select count(*) from back) into n_in, n_re;
  return json_build_object('inactivated', n_in, 'reactivated', n_re);
end $$;

create or replace function botw_period_start(d date, kind text, dom int)
returns date language sql immutable as $$
  select case kind
    when 'daily' then case extract(isodow from d)::int when 6 then d - 1 when 7 then d - 2 else d end
    when 'monthly' then case
      when extract(day from d)::int >= dom then make_date(extract(year from d)::int, extract(month from d)::int, dom)
      else (make_date(extract(year from d)::int, extract(month from d)::int, dom) - interval '1 month')::date end
    else date_trunc('week', d)::date
  end;
$$;

create or replace function maybe_advance_weekly(p_org uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  o organizations;
  kind text;
  a date;
  b date;
  steps int;
  list uuid[];
  n int;
  idx int;
begin
  if not is_member(p_org) then return null; end if;
  select * into o from organizations where id = p_org;
  if not coalesce(o.auto_advance, false) then return null; end if;
  kind := coalesce(o.botw_cadence, 'weekly');
  b := botw_period_start(portal_today(), kind, coalesce(o.botw_day, 1));
  if o.weekly_set_at is null then
    steps := 1;
  else
    a := botw_period_start((o.weekly_set_at at time zone 'America/Denver')::date, kind, coalesce(o.botw_day, 1));
    steps := case kind
      when 'daily' then (select count(*)::int from generate_series(a + 1, b, interval '1 day') g
                          where extract(isodow from g) < 6)
      when 'monthly' then (extract(year from age(b, a)) * 12 + extract(month from age(b, a)))::int
      else (b - a) / 7
    end;
  end if;
  if coalesce(steps, 0) < 1 then return null; end if;

  select array_agg(id order by number) into list from behaviors where org_id = p_org and archived = false;
  n := coalesce(array_length(list, 1), 0);
  if n < 2 then return null; end if;
  idx := coalesce(array_position(list, o.weekly_behavior_id), 1);
  update organizations
     set weekly_behavior_id = list[((idx - 1 + steps) % n) + 1],
         weekly_set_at = (b::timestamp at time zone 'America/Denver')
   where id = p_org;
  return list[((idx - 1 + steps) % n) + 1];
end $$;

create or replace function set_my_email_opt_out(p_opt_out boolean)
returns void language sql security definer set search_path = public as $$
  update memberships set email_opt_out = p_opt_out where user_id = auth.uid();
$$;

create or replace function pulse_status(p_org uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  members int;
  target  int;
  r       int;
  total   int;
  done    int;
  mine    int;
begin
  if not is_member(p_org) then raise exception 'Not a member of that organization'; end if;

  select count(*) into members from memberships where org_id = p_org;
  target := greatest(1, ceil(coalesce(members, 1) * 0.8));
  select coalesce(max(round), 1) into r from pulse_responses where org_id = p_org;
  select count(*) into total from behaviors
   where org_id = p_org and archived = false and not is_example;

  select count(*) into done from (
    select p.user_id
      from pulse_responses p
      join behaviors b on b.id = p.behavior_id and b.archived = false and not b.is_example
      join memberships m on m.user_id = p.user_id and m.org_id = p_org
     where p.org_id = p_org and p.round = r
     group by p.user_id
    having count(distinct p.behavior_id) >= total) x;

  if total > 0 and done >= target then
    r := r + 1;
    done := 0;
  end if;

  select count(*) into mine from behaviors b
   where b.org_id = p_org and b.archived = false and not b.is_example
     and not exists (select 1 from pulse_responses p
                      where p.behavior_id = b.id and p.round = r and p.user_id = auth.uid());
  if is_platform_admin() then mine := 0; end if;

  return json_build_object('round', r, 'target', target, 'done', done, 'members', members,
    'total', total, 'mine_left', mine, 'scored', done);
end $$;

create or replace function pulse_assignment(p_org uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  st json;
  r int;
begin
  st := pulse_status(p_org);
  r := (st->>'round')::int;
  return json_build_object(
    'round', r,
    'target', (st->>'target')::int,
    'behaviors', coalesce((
      select json_agg(x) from (
        select b.id, b.number, b.title, b.description, b.category
          from behaviors b
         where b.org_id = p_org and b.archived = false and not b.is_example
           and not exists (select 1 from pulse_responses p
                            where p.behavior_id = b.id and p.round = r and p.user_id = auth.uid())
         order by (select count(*) from pulse_responses p where p.behavior_id = b.id and p.round = r), b.number
         limit (select coalesce(pulse_per_signin, 2) from organizations where id = p_org)
      ) x), '[]'::json)
  );
end $$;

create or replace function get_platform_pricing()
returns jsonb language sql stable security definer set search_path = public as $$
  select rates from platform_settings where id = 1;
$$;

grant execute on function my_paused_org() to authenticated;

grant execute on function maybe_advance_weekly(uuid) to authenticated;

grant execute on function set_my_email_opt_out(boolean) to authenticated;

grant execute on function get_platform_pricing() to anon, authenticated;

grant execute on function enforce_seats(uuid) to authenticated;

-- -------------------------------------------------------- triggers

drop trigger if exists organizations_guard_billing on organizations;

create trigger organizations_guard_billing
  before update on organizations
  for each row execute function guard_billing_fields();

-- -------------------------------------------------------- row level security

alter table billing_notices enable row level security;

drop policy if exists "super user reads notices" on billing_notices;

create policy "super user reads notices" on billing_notices for select using (is_platform_admin());

drop policy if exists "super user writes billing events" on billing_events;

create policy "super user writes billing events" on billing_events for insert with check (is_platform_admin());

drop policy if exists "read own membership" on memberships;

create policy "read own membership" on memberships for select using (user_id = auth.uid());

alter table platform_settings enable row level security;

drop policy if exists "super user edits platform settings" on platform_settings;

create policy "super user edits platform settings" on platform_settings for update
  using (is_platform_admin()) with check (is_platform_admin());

drop policy if exists "anyone reads platform settings" on platform_settings;

create policy "anyone reads platform settings" on platform_settings for select using (true);

-- -------------------------------------------------------- logos bucket

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

drop policy if exists "anyone reads logos" on storage.objects;

create policy "anyone reads logos" on storage.objects for select
  using (bucket_id = 'logos');

drop policy if exists "editors upload logo" on storage.objects;

create policy "editors upload logo" on storage.objects for insert
  with check (bucket_id = 'logos' and can_edit(((storage.foldername(name))[1])::uuid));

drop policy if exists "editors replace logo" on storage.objects;

create policy "editors replace logo" on storage.objects for update
  using (bucket_id = 'logos' and can_edit(((storage.foldername(name))[1])::uuid))
  with check (bucket_id = 'logos' and can_edit(((storage.foldername(name))[1])::uuid));

drop policy if exists "editors delete logo" on storage.objects;

create policy "editors delete logo" on storage.objects for delete
  using (bucket_id = 'logos' and can_edit(((storage.foldername(name))[1])::uuid));

-- -------------------------------------------------------- data

update categories set question = 'Who are we when it costs us?',
  definition = 'We keep our word when it is costly. What we say and what we do match, so people can trust both.'
  where name = 'Character';

update categories set question = 'How do we treat people?',
  definition = 'People feel safe, seen and free to speak up. Belonging is something we build on purpose.'
  where name = 'Connection';

update categories set question = 'How do we create clarity and excel?',
  definition = 'Clear decisions, high standards, and getting better at the work every week.'
  where name = 'Craft';

update categories set question = 'Who is this for and why does it matter?',
  definition = 'Everyone can see who the work serves and how their part makes a difference.'
  where name = 'Cause';

update categories set question = 'How do we stay significant?',
  definition = 'We name reality, adapt fast, and accept what we cannot control, so we keep mattering.'
  where name = 'Change';

update organizations set
  plan = case when plan = 'free' then 'unlimited' else plan end,
  override_kind = 'invoiced', override_plan = 'unlimited', override_until = date '2099-12-12',
  override_note = 'Pilot. Invoiced outside Stripe until reset.'
where (slug in ('mv', 'vd') or name in ('Mountain Vistage', 'Vail Daily'))
  and override_kind is null;

update values_ set category = case name
  when 'Trust' then 'Character' when 'Commitment' then 'Character' when 'Humility' then 'Character'
  when 'Candor' then 'Character' when 'Care' then 'Connection' when 'Vulnerability' then 'Connection'
  when 'Challenge' then 'Craft' when 'Leadership Excellence' then 'Craft' when 'Growth' then 'Change' end
where category is null;

update organizations set rate_small_monthly = 15, rate_small_yearly = 159,
                         rate_unlimited_monthly = 49, rate_unlimited_yearly = 499
 where rate_small_monthly = 49 and rate_small_yearly = 490
   and rate_unlimited_monthly = 149 and rate_unlimited_yearly = 1490
   and slug not in ('mv', 'vd') and name not in ('Mountain Vistage', 'Vail Daily');


-- ================================================================ R5
-- Identical to migrations/2026-09-28-r5-pulse-rounds.sql.


-- -------------------------------------------------------- the setting

alter table organizations add column if not exists pulse_close_pct int not null default 80;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_pulse_close_pct_check') then
    alter table organizations add constraint organizations_pulse_close_pct_check
      check (pulse_close_pct between 10 and 100);
  end if;
end $$;

-- -------------------------------------------------------- closed rounds

-- A round gets a row, and a date, only when it closes. The open round is the
-- one after the last row. finished and members are what participation was at
-- that moment; they are empty for rounds closed before R5 recorded them.
create table if not exists pulse_rounds (
  org_id         uuid not null references organizations(id) on delete cascade,
  round          int  not null,
  closed_at      timestamptz not null default now(),
  reason         text not null check (reason in ('participation', 'manual')),
  closed_by      uuid references auth.users(id) on delete set null,
  closed_by_name text,
  finished       int,
  members        int,
  close_pct      int,
  primary key (org_id, round)
);
alter table pulse_rounds enable row level security;

-- Read by anyone in the organization; written only by the functions below.
drop policy if exists "members read pulse rounds" on pulse_rounds;
create policy "members read pulse rounds" on pulse_rounds for select using (is_member(org_id));
grant select on pulse_rounds to authenticated;

-- -------------------------------------------------------- where a round stands

create or replace function pulse_open_round(p_org uuid)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(max(round), 0) + 1 from pulse_rounds where org_id = p_org;
$$;

-- Active members, real behaviors, and how many of those members have rated
-- every one of them in the round. Inactive members (over a plan's seat limit)
-- cannot sign in, so they are not counted either way.
create or replace function pulse_counts(p_org uuid, p_round int,
  out members int, out total int, out finished int)
language plpgsql stable security definer set search_path = public as $$
begin
  select count(*) into members from memberships where org_id = p_org and not inactive;
  select count(*) into total from behaviors
   where org_id = p_org and archived = false and not is_example;
  select count(*) into finished from (
    select p.user_id
      from pulse_responses p
      join behaviors b on b.id = p.behavior_id and b.archived = false and not b.is_example
      join memberships m on m.user_id = p.user_id and m.org_id = p_org and not m.inactive
     where p.org_id = p_org and p.round = p_round
     group by p.user_id
    having count(distinct p.behavior_id) >= total) x;
end $$;

-- Closes the open round if participation has reached the setting. Called by
-- everything that reads or changes the pulse, so a round closes as soon as the
-- last person needed finishes, or the setting is lowered, or someone leaves.
create or replace function pulse_sync(p_org uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  r   int := pulse_open_round(p_org);
  c   record;
  pct int;
begin
  select * into c from pulse_counts(p_org, r);
  select coalesce(pulse_close_pct, 80) into pct from organizations where id = p_org;
  if c.total > 0 and c.finished >= greatest(1, ceil(c.members * pct / 100.0)) then
    insert into pulse_rounds (org_id, round, reason, finished, members, close_pct)
    values (p_org, r, 'participation', c.finished, c.members, pct)
    on conflict do nothing;
    return true;
  end if;
  return false;
end $$;

-- Internal: callable from the functions here, not by anyone through the API.
revoke execute on function pulse_counts(uuid, int) from public, anon, authenticated;
revoke execute on function pulse_sync(uuid) from public, anon, authenticated;
revoke execute on function pulse_open_round(uuid) from public, anon, authenticated;

-- Volatile rather than stable: it may close the round before answering.
create or replace function pulse_status(p_org uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  r      int;
  c      record;
  pct    int;
  target int;
  mine   int;
  answers int;
begin
  if not is_member(p_org) then raise exception 'Not a member of that organization'; end if;
  perform pulse_sync(p_org);

  r := pulse_open_round(p_org);
  select * into c from pulse_counts(p_org, r);
  select coalesce(pulse_close_pct, 80) into pct from organizations where id = p_org;
  target := greatest(1, ceil(c.members * pct / 100.0));
  select count(*) into answers from pulse_responses where org_id = p_org and round = r;

  select count(*) into mine from behaviors b
   where b.org_id = p_org and b.archived = false and not b.is_example
     and not exists (select 1 from pulse_responses p
                      where p.behavior_id = b.id and p.round = r and p.user_id = auth.uid());
  if not exists (select 1 from memberships where org_id = p_org and user_id = auth.uid() and not inactive) then
    mine := 0;
  end if;

  return json_build_object(
    'round', r, 'target', target, 'done', c.finished, 'scored', c.finished,
    'members', c.members, 'total', c.total, 'mine_left', mine,
    'pct', pct, 'answers', answers,
    'participation', case when c.members > 0 then round(100.0 * c.finished / c.members) else 0 end,
    'closed', (select count(*) from pulse_rounds where org_id = p_org));
end $$;

-- A few of the least-answered behaviors the person has not rated this round,
-- or with p_all, every one they have left.
drop function if exists pulse_assignment(uuid);
create or replace function pulse_assignment(p_org uuid, p_all boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  st json;
  r  int;
begin
  st := pulse_status(p_org);
  r := (st->>'round')::int;
  return json_build_object(
    'round', r,
    'target', (st->>'target')::int,
    'mine_left', (st->>'mine_left')::int,
    'behaviors', case when (st->>'mine_left')::int = 0 then '[]'::json else coalesce((
      select json_agg(x) from (
        select b.id, b.number, b.title, b.description, b.category
          from behaviors b
         where b.org_id = p_org and b.archived = false and not b.is_example
           and not exists (select 1 from pulse_responses p
                            where p.behavior_id = b.id and p.round = r and p.user_id = auth.uid())
         order by (select count(*) from pulse_responses p where p.behavior_id = b.id and p.round = r), b.number
         limit case when p_all then null
                    else (select coalesce(pulse_per_signin, 2) from organizations where id = p_org) end
      ) x), '[]'::json) end
  );
end $$;

-- -------------------------------------------------------- answering

-- The only way in. The round is the open one, whatever the browser says; each
-- behavior must be one of this organization's real, current behaviors.
create or replace function submit_pulse(p_org uuid, p_answers jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare
  r int;
  k text;
  v jsonb;
  s int;
begin
  if not exists (select 1 from memberships where org_id = p_org and user_id = auth.uid() and not inactive) then
    raise exception 'Only people in this organization answer its pulse';
  end if;
  -- One answer at a time per organization, so a round cannot close between
  -- reading its number and writing to it.
  perform 1 from organizations where id = p_org for update;
  perform pulse_sync(p_org);
  r := pulse_open_round(p_org);

  for k, v in select * from jsonb_each(coalesce(p_answers, '{}'::jsonb)) loop
    s := (v #>> '{}')::int;
    if s is null or s < 1 or s > 5 then raise exception 'A rating is a whole number from 1 to 5'; end if;
    if not exists (select 1 from behaviors b where b.id = k::uuid and b.org_id = p_org
                    and b.archived = false and not b.is_example) then
      raise exception 'That is not one of this organization''s current behaviors';
    end if;
    insert into pulse_responses (org_id, behavior_id, user_id, round, score)
    values (p_org, k::uuid, auth.uid(), r, s)
    on conflict (round, behavior_id, user_id) do update set score = excluded.score, created_at = now();
  end loop;

  return pulse_status(p_org);
end $$;

-- -------------------------------------------------------- admins

create or replace function set_pulse_close_pct(p_org uuid, p_pct int)
returns json language plpgsql security definer set search_path = public as $$
begin
  if not coalesce(can_edit(p_org), false) then raise exception 'Only an admin can change when a pulse round closes'; end if;
  if p_pct is null or p_pct < 10 or p_pct > 100 then raise exception 'Choose between 10%% and 100%%'; end if;
  update organizations set pulse_close_pct = p_pct where id = p_org;
  -- Lowering it can close the round on the spot.
  return pulse_status(p_org);
end $$;

-- Closes the open round now, with whatever answers it has.
create or replace function close_pulse_round(p_org uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  r   int;
  c   record;
  pct int;
  nm  text;
begin
  if not coalesce(can_edit(p_org), false) then raise exception 'Only an admin can close a pulse round'; end if;
  perform 1 from organizations where id = p_org for update;
  r := pulse_open_round(p_org);
  if not exists (select 1 from pulse_responses where org_id = p_org and round = r) then
    raise exception 'Round % has no answers yet, so there is nothing to close', r;
  end if;

  select * into c from pulse_counts(p_org, r);
  select coalesce(pulse_close_pct, 80) into pct from organizations where id = p_org;
  select coalesce(m.display_name, m.email) into nm from memberships m
   where m.user_id = auth.uid() and m.org_id = p_org;
  if nm is null then
    select coalesce(u.raw_user_meta_data->>'display_name', u.email) into nm from auth.users u where u.id = auth.uid();
  end if;

  insert into pulse_rounds (org_id, round, reason, closed_by, closed_by_name, finished, members, close_pct)
  values (p_org, r, 'manual', auth.uid(), nm, c.finished, c.members, pct);
  return pulse_status(p_org);
end $$;

-- -------------------------------------------------------- reports

-- Average and spread per behavior for one round; the open round when none is
-- given. Leaders and up, the same people who read the answers.
create or replace function pulse_results(p_org uuid, p_round int default null)
returns table (behavior_id uuid, number int, title text, avg_score numeric, spread numeric, responses bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  r int := coalesce(p_round, pulse_open_round(p_org));
begin
  if not coalesce(can_lead(p_org), false) then raise exception 'Only leaders see pulse results'; end if;
  return query
    select b.id, b.number, b.title,
           round(avg(p.score)::numeric, 2),
           round(coalesce(stddev_samp(p.score), 0)::numeric, 2),
           count(p.id)
      from behaviors b
      left join pulse_responses p on p.behavior_id = b.id and p.round = r
     where b.org_id = p_org and not b.is_example
       and (b.archived = false or p.id is not null)
     group by b.id, b.number, b.title
     order by b.number;
end $$;

-- Every round, newest first: the open one (no date) and each closed one, with
-- how it closed and what came in.
create or replace function pulse_round_history(p_org uuid)
returns table (round int, is_open boolean, closed_at timestamptz, reason text, closed_by_name text,
               finished int, members int, close_pct int, raters bigint, responses bigint,
               avg_score numeric, spread numeric)
language plpgsql stable security definer set search_path = public as $$
declare
  r   int := pulse_open_round(p_org);
  c   record;
  pct int;
begin
  if not coalesce(can_lead(p_org), false) then raise exception 'Only leaders see pulse results'; end if;
  select * into c from pulse_counts(p_org, r);
  select coalesce(pulse_close_pct, 80) into pct from organizations where id = p_org;
  return query
    with rounds as (
      select pr.round, false as is_open, pr.closed_at, pr.reason, pr.closed_by_name,
             pr.finished, pr.members, pr.close_pct
        from pulse_rounds pr where pr.org_id = p_org
      union all
      select r, true, null::timestamptz, null::text, null::text, c.finished, c.members, pct
    )
    select x.round, x.is_open, x.closed_at, x.reason, x.closed_by_name,
           x.finished, x.members, x.close_pct,
           (select count(distinct p.user_id) from pulse_responses p where p.org_id = p_org and p.round = x.round),
           (select count(*) from pulse_responses p where p.org_id = p_org and p.round = x.round),
           (select round(avg(p.score)::numeric, 2) from pulse_responses p where p.org_id = p_org and p.round = x.round),
           (select round(coalesce(stddev_samp(p.score), 0)::numeric, 2) from pulse_responses p where p.org_id = p_org and p.round = x.round)
      from rounds x
     order by x.round desc;
end $$;

grant execute on function pulse_status(uuid) to authenticated;
grant execute on function pulse_assignment(uuid, boolean) to authenticated;
grant execute on function submit_pulse(uuid, jsonb) to authenticated;
grant execute on function set_pulse_close_pct(uuid, int) to authenticated;
grant execute on function close_pulse_round(uuid) to authenticated;
grant execute on function pulse_results(uuid, int) to authenticated;
grant execute on function pulse_round_history(uuid) to authenticated;

-- -------------------------------------------------------- security

-- Views run as their owner unless told otherwise, which skipped row level
-- security: anyone signed in could read every organization's behavior titles,
-- pulse scores and coverage through the API. Now they run as the caller.
-- A later "create or replace view" on either must keep this option.
alter view behavior_pulse set (security_invoker = true);
alter view behavior_coverage set (security_invoker = true);

-- Answers were written straight into the table with a round number the
-- browser chose, so one person could move a whole organization to round 99.
-- They now go only through submit_pulse. You still read your own answers;
-- leaders still read everyone's.
drop policy if exists "own pulse responses" on pulse_responses;
drop policy if exists "read own pulse responses" on pulse_responses;
create policy "read own pulse responses" on pulse_responses for select using (user_id = auth.uid());
revoke insert, update, delete on pulse_responses from anon, authenticated;

-- -------------------------------------------------------- history

-- Before R5 a round ended when the next one started. Every round below the
-- latest one with answers is recorded as closed on its last answer.
insert into pulse_rounds (org_id, round, closed_at, reason)
select p.org_id, p.round, max(p.created_at), 'participation'
  from pulse_responses p
 where p.round < (select max(q.round) from pulse_responses q where q.org_id = p.org_id)
 group by p.org_id, p.round
on conflict do nothing;
