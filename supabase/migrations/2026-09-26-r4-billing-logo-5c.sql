-- R4: self-serve plans with a 30-day trial, Stripe billing with tax, renewal
-- and expiry notices, super user overrides, organization logos, and the 5C
-- category switch.
--
-- Additive and safe to run twice. Runs as one transaction. Run it in the
-- Supabase SQL editor BEFORE the new code reaches Cloudflare.

begin;

-- ------------------------------------------------------------ organizations

alter table organizations add column if not exists show_categories boolean not null default true;
alter table organizations add column if not exists logo_url text;
alter table organizations add column if not exists trial_ends_at date;
alter table organizations add column if not exists trial_used boolean not null default false;
alter table organizations add column if not exists has_payment_method boolean not null default false;
alter table organizations add column if not exists card_last4 text;
alter table organizations add column if not exists subscription_status text;
-- An arrangement set by the super user. It wins over anything Stripe reports
-- until override_until.
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

-- Notices already emailed, so each goes out once.
create table if not exists billing_notices (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references organizations(id) on delete cascade,
  notice_key text not null,
  kind       text not null,
  sent_to    text,
  sent_at    timestamptz default now(),
  unique (org_id, notice_key)
);
alter table billing_notices enable row level security;
drop policy if exists "super user reads notices" on billing_notices;
create policy "super user reads notices" on billing_notices for select using (is_platform_admin());

-- ------------------------------------------------------------ access rules
-- The same rules as src/lib/billing.js. Change one, change both.

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

-- Kept for anything still calling it: current now means everyone has access.
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
    else o.plan
  end
  from organizations o where o.id = p_org;
$$;

-- When the plan is not current, everyone but the culture champion reads
-- nothing: their role resolves to none, and every policy is written against
-- it. The data stays exactly where it is.
create or replace function org_role(p_org uuid)
returns member_role language sql stable security definer set search_path = public as $$
  select case when is_platform_admin() then 'owner'::member_role
    else (select m.role from memberships m
          where m.org_id = p_org and m.user_id = auth.uid()
            and (m.role = 'champion' or access_full(p_org))) end;
$$;

-- What a locked-out member is told instead of "no organization".
create or replace function my_paused_org()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'org_name', o.name,
    'champion', (select c.display_name from memberships c where c.org_id = o.id and c.role = 'champion'))
  from memberships m join organizations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.role <> 'champion' and not access_full(o.id)
  limit 1;
$$;
grant execute on function my_paused_org() to authenticated;

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
    'seats_used', (select count(*) from memberships m where m.org_id = o.id),
    'seats_allowed', case when effective_plan(p_org) = 'unlimited' then null
                          else plan_seats(effective_plan(p_org)) end,
    'rates', json_build_object(
      'small', json_build_object('monthly', o.rate_small_monthly, 'yearly', o.rate_small_yearly),
      'unlimited', json_build_object('monthly', o.rate_unlimited_monthly, 'yearly', o.rate_unlimited_yearly))
  )
  from organizations o where o.id = p_org and is_member(p_org);
$$;

-- Billing fields are set by the super user, by Stripe (through the service
-- role), or from the SQL editor. Never by a champion editing the org record.
-- Runs as the caller (not security definer), so current_user is the real
-- role: service_role for the Stripe webhook, postgres in the SQL editor.
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

drop trigger if exists organizations_guard_billing on organizations;
create trigger organizations_guard_billing
  before update on organizations
  for each row execute function guard_billing_fields();

-- The super user writes billing history by hand too (overrides, dates).
drop policy if exists "super user writes billing events" on billing_events;
create policy "super user writes billing events" on billing_events for insert with check (is_platform_admin());

-- ------------------------------------------------------------ logos

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

drop policy if exists "editors upload logo" on storage.objects;
create policy "editors upload logo" on storage.objects for insert
  with check (bucket_id = 'logos' and can_edit(((storage.foldername(name))[1])::uuid));
drop policy if exists "editors replace logo" on storage.objects;
create policy "editors replace logo" on storage.objects for update
  using (bucket_id = 'logos' and can_edit(((storage.foldername(name))[1])::uuid));
drop policy if exists "editors delete logo" on storage.objects;
create policy "editors delete logo" on storage.objects for delete
  using (bucket_id = 'logos' and can_edit(((storage.foldername(name))[1])::uuid));

-- ------------------------------------------------------------ 5C categories

alter table categories add column if not exists definition text;
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

-- ------------------------------------------------------------ the two pilots
-- Invoiced outside Stripe until Jon resets them. Only set if nothing is there.

update organizations set
  plan = case when plan = 'free' then 'unlimited' else plan end,
  override_kind = 'invoiced', override_plan = 'unlimited', override_until = date '2099-12-12',
  override_note = 'Pilot. Invoiced outside Stripe until reset.'
where (slug in ('mv', 'vd') or name in ('Mountain Vistage', 'Vail Daily'))
  and override_kind is null;

-- ------------------------------------------------------------ R4.1 additions

-- Each value can sit in one of the 5Cs.
alter table values_ add column if not exists category text;
do $$ begin
  alter table values_ add constraint values_category_check
    check (category in ('Character','Connection','Craft','Cause','Change'));
exception when duplicate_object then null; end $$;
-- A first guess for the pilots' existing values; edit any of them in Admin.
update values_ set category = case name
  when 'Trust' then 'Character' when 'Commitment' then 'Character' when 'Humility' then 'Character'
  when 'Candor' then 'Character' when 'Care' then 'Connection' when 'Vulnerability' then 'Connection'
  when 'Challenge' then 'Craft' when 'Leadership Excellence' then 'Craft' when 'Growth' then 'Change' end
where category is null;

-- How often the featured behavior turns over: each weekday, each Monday, or
-- monthly on a chosen day. Streaks count in the same unit.
alter table organizations add column if not exists botw_cadence text not null default 'weekly';
alter table organizations add column if not exists botw_day int not null default 1;
do $$ begin
  alter table organizations add constraint organizations_botw_cadence_check check (botw_cadence in ('daily','weekly','monthly'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table organizations add constraint organizations_botw_day_check check (botw_day between 1 and 28);
exception when duplicate_object then null; end $$;

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

-- Moves the featured behavior on when the calendar has, if the organization
-- asked for that. Called when behaviors load, so nothing needs scheduling.
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
grant execute on function maybe_advance_weekly(uuid) to authenticated;

-- Anyone can stop portal email (weekly prompts, shares). Account email and
-- the champion's billing notices still go out.
alter table memberships add column if not exists email_opt_out boolean not null default false;
create or replace function set_my_email_opt_out(p_opt_out boolean)
returns void language sql security definer set search_path = public as $$
  update memberships set email_opt_out = p_opt_out where user_id = auth.uid();
$$;
grant execute on function set_my_email_opt_out(boolean) to authenticated;
drop policy if exists "read own membership" on memberships;
create policy "read own membership" on memberships for select using (user_id = auth.uid());

-- The pulse: a round is complete once 80% of members have each rated every
-- behavior. Replaces the quarter-per-behavior rule.
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

-- ------------------------------------------------------------ R4.2 additions

-- Prices Horizon Line quotes: shown on the sign-in page (signed out too) and
-- copied onto each new organization. The super user edits them.
create table if not exists platform_settings (
  id    int primary key default 1 check (id = 1),
  rates jsonb not null
);
insert into platform_settings (id, rates)
values (1, '{"small":{"monthly":15,"yearly":159},"unlimited":{"monthly":49,"yearly":499}}')
on conflict (id) do nothing;
alter table platform_settings enable row level security;
drop policy if exists "super user edits platform settings" on platform_settings;
create policy "super user edits platform settings" on platform_settings for update
  using (is_platform_admin()) with check (is_platform_admin());
drop policy if exists "anyone reads platform settings" on platform_settings;
create policy "anyone reads platform settings" on platform_settings for select using (true);

create or replace function get_platform_pricing()
returns jsonb language sql stable security definer set search_path = public as $$
  select rates from platform_settings where id = 1;
$$;
grant execute on function get_platform_pricing() to anon, authenticated;

-- New defaults for new organizations, and organizations still on the first
-- R4 prices move to them. Each organization's own prices stay editable.
alter table organizations alter column rate_small_monthly set default 15;
alter table organizations alter column rate_small_yearly set default 159;
alter table organizations alter column rate_unlimited_monthly set default 49;
alter table organizations alter column rate_unlimited_yearly set default 499;
update organizations set rate_small_monthly = 15, rate_small_yearly = 159,
                         rate_unlimited_monthly = 49, rate_unlimited_yearly = 499
 where rate_small_monthly = 49 and rate_small_yearly = 490
   and rate_unlimited_monthly = 149 and rate_unlimited_yearly = 1490
   -- the two pilots keep the prices they were quoted
   and slug not in ('mv', 'vd') and name not in ('Mountain Vistage', 'Vail Daily');

-- People over a plan's seat limit go inactive (most recently added first),
-- never deleted. Moving to a bigger plan brings them back.
alter table memberships add column if not exists inactive boolean not null default false;

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

-- Seats count active people only. Reactivating someone counts as adding them.
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
grant execute on function enforce_seats(uuid) to authenticated;

-- billing_status counts active seats and says how many people there are in all.
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

-- During the trial everyone gets the unlimited plan, whatever they pick to keep.
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

commit;

-- Check (remove the leading dashes and run):
-- select name, access_status(id), effective_plan(id), override_kind, override_until, show_categories
--   from organizations order by name;
