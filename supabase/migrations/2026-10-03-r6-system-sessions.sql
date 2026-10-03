-- R6: system sessions that include rituals. Everything that changed since
-- R5.3, and nothing else.
--
-- Paste all of it into the Supabase SQL editor and click Run. It runs as one
-- transaction, only adds, and is safe to run twice.
--
--   ritual_systems   which systems a ritual can be included in (Accountability
--                    binder in Meetings). The weekly practice can be included
--                    in every system without a row here.
--   iterations       parent_id: a ritual run included in a system session
--                    points to that session. It takes the session's date, team
--                    and draft state, follows them when the session changes,
--                    and goes when the session is deleted. Every run is still
--                    of one ritual or one system.
--   behavior_coverage  counts a behavior once per session, however many of the
--                    session's runs credit it.

begin;

-- -------------------------------------------------------- rituals in systems

create table if not exists ritual_systems (
  ritual_id          uuid not null references rituals(id) on delete cascade,
  system_category_id uuid not null references system_categories(id) on delete cascade,
  primary key (ritual_id, system_category_id)
);
create index if not exists ritual_systems_system on ritual_systems (system_category_id);
alter table ritual_systems enable row level security;

drop policy if exists "members read ritual systems" on ritual_systems;
create policy "members read ritual systems" on ritual_systems for select
  using (exists (select 1 from rituals r where r.id = ritual_id and is_member(r.org_id)));

-- Editors only, and the system must be the ritual's own organization's.
drop policy if exists "editors write ritual systems" on ritual_systems;
create policy "editors write ritual systems" on ritual_systems for all
  using (exists (select 1 from rituals r where r.id = ritual_id and can_edit(r.org_id)))
  with check (exists (select 1 from rituals r join system_categories s on s.id = system_category_id
                       where r.id = ritual_id and s.org_id = r.org_id and can_edit(r.org_id)));

grant select, insert, update, delete on ritual_systems to authenticated;

-- -------------------------------------------------------- rituals in sessions

alter table iterations add column if not exists parent_id uuid references iterations(id) on delete cascade;
create index if not exists iterations_parent on iterations (parent_id);

-- A run with a parent is a ritual included in a system session: same
-- organization, a ritual the system includes, and the session's date, team
-- and draft state. Which rituals a system includes is checked when the run is
-- added, not again later, so taking a ritual out of a system does not stop
-- its past sessions from being edited.
create or replace function guard_iteration_parent()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p iterations%rowtype;
begin
  if new.parent_id is null then return new; end if;
  select * into p from iterations where id = new.parent_id;
  if p.id is null then raise exception 'That session is no longer here'; end if;
  if p.org_id <> new.org_id then raise exception 'That session belongs to another organization'; end if;
  if p.system_category_id is null or p.parent_id is not null then
    raise exception 'Rituals can only be included in a system session';
  end if;
  if new.ritual_id is null then raise exception 'Only a ritual can be included in a system session'; end if;
  if tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id or new.ritual_id is distinct from old.ritual_id then
    if not exists (select 1 from rituals r
                    where r.id = new.ritual_id and r.org_id = new.org_id
                      and (r.applies_to_all or exists (select 1 from ritual_systems rs
                             where rs.ritual_id = r.id and rs.system_category_id = p.system_category_id))) then
      raise exception 'That ritual is not one this system includes';
    end if;
  end if;
  new.held_at := p.held_at;
  new.team_id := p.team_id;
  new.is_draft := p.is_draft;
  return new;
end $$;

drop trigger if exists iterations_guard_parent on iterations;
create trigger iterations_guard_parent before insert or update on iterations
  for each row execute function guard_iteration_parent();

-- When a session's date, team or draft state changes, its rituals follow.
create or replace function sync_iteration_children()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.held_at is distinct from old.held_at or new.team_id is distinct from old.team_id
     or new.is_draft is distinct from old.is_draft then
    update iterations set held_at = new.held_at, team_id = new.team_id, is_draft = new.is_draft
     where parent_id = new.id;
  end if;
  return null;
end $$;

drop trigger if exists iterations_sync_children on iterations;
create trigger iterations_sync_children after update on iterations
  for each row when (new.parent_id is null) execute function sync_iteration_children();

-- -------------------------------------------------------- coverage

-- As in R3, except that a behavior credited by a session and by a ritual
-- inside it counts once. Still runs as the caller (R5).
create or replace view behavior_coverage with (security_invoker = true) as
select
  b.id as behavior_id, b.org_id, b.number, b.title,
  count(p.id) as placement_count,
  count(p.id) filter (where p.template is not null) as template_count,
  (select count(*) from behavior_rituals br where br.behavior_id = b.id) as ritual_count,
  (select count(distinct coalesce(it.parent_id, it.id)) from iterations it
    where b.id = any(it.behavior_ids) and not it.is_draft) as iteration_count,
  (select max(it.held_at) from iterations it where b.id = any(it.behavior_ids) and not it.is_draft) as last_run,
  (count(p.id) < 2) as is_gap
from behaviors b
left join placements p on p.behavior_id = b.id
where b.archived = false
group by b.id, b.org_id, b.number, b.title;

commit;
