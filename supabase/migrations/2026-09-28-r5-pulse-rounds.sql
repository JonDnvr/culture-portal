-- R5: pulse rounds that close on participation or by hand, reports per round,
-- and two security fixes. Everything that changed since R4, and nothing else.
--
-- Paste all of it into the Supabase SQL editor and click Run. It runs as one
-- transaction, only adds, and is safe to run twice. No existing answers are
-- removed.
--
--   organizations   pulse_close_pct: the share of active members who must
--                   rate every behavior before a round closes (default 80)
--   pulse_rounds    one row per closed round, dated when it closed; the open
--                   round has no row and no date
--   rules           a round closes when participation reaches the setting,
--                   or when an admin closes it; answers are written only
--                   through submit_pulse, which stamps the round itself
--   reports         pulse_results (one round) and pulse_round_history (all)
--   security        behavior_pulse and behavior_coverage respect row level
--                   security; nobody writes pulse_responses directly
--   history         rounds answered before this update are recorded as closed

begin;

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

commit;
