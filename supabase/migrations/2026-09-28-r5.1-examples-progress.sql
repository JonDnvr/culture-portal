-- R5.1: example activity for new portals, and pulse progress. Everything that
-- changed since R5, and nothing else.
--
-- Paste all of it into the Supabase SQL editor and click Run. It runs as one
-- transaction, only adds, and is safe to run twice.
--
--   examples   rituals, runs, recognition and stories can be marked as
--              examples, so "Clear example content" removes them with the
--              example behaviors, values and systems
--   values     the example Trust value belongs to Change
--   pulse      pulse_status also returns how many ratings are in for the open
--              round, against every active member rating every behavior

begin;

-- -------------------------------------------------------- example flags

alter table rituals      add column if not exists is_example boolean not null default false;
alter table iterations   add column if not exists is_example boolean not null default false;
alter table recognitions add column if not exists is_example boolean not null default false;
alter table stories      add column if not exists is_example boolean not null default false;

-- New portals give their example values a 5C home. Ones already made got a
-- first guess in R4; only example Trust differs, and only while it is still
-- an example (editing a value clears the flag).
update values_ set category = case name
    when 'Trust' then 'Change' when 'Candor' then 'Character' when 'Care' then 'Connection' end
 where is_example and name in ('Trust', 'Candor', 'Care');

-- -------------------------------------------------------- pulse progress

-- As in R5, plus rated and possible: ratings in for the open round from active
-- members on current behaviors, against every active member rating every one.
create or replace function pulse_status(p_org uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  r      int;
  c      record;
  pct    int;
  target int;
  mine   int;
  answers int;
  rated  int;
begin
  if not is_member(p_org) then raise exception 'Not a member of that organization'; end if;
  perform pulse_sync(p_org);

  r := pulse_open_round(p_org);
  select * into c from pulse_counts(p_org, r);
  select coalesce(pulse_close_pct, 80) into pct from organizations where id = p_org;
  target := greatest(1, ceil(c.members * pct / 100.0));
  select count(*) into answers from pulse_responses where org_id = p_org and round = r;
  select count(*) into rated
    from pulse_responses p
    join behaviors b on b.id = p.behavior_id and b.archived = false and not b.is_example
    join memberships m on m.user_id = p.user_id and m.org_id = p_org and not m.inactive
   where p.org_id = p_org and p.round = r;

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
    'rated', rated, 'possible', c.members * c.total,
    'complete', case when c.members * c.total > 0 then round(100.0 * rated / (c.members * c.total)) else 0 end,
    'closed', (select count(*) from pulse_rounds where org_id = p_org));
end $$;

grant execute on function pulse_status(uuid) to authenticated;

commit;
