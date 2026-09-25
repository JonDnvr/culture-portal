-- ============================================================================
-- R3: drafts, and who may change or remove a record.
--
-- - Stories, recognition, iterations (ritual and system runs) and Value awards
--   can be saved as a draft. A draft is visible only to the person who wrote
--   it and counts toward nothing until it is published. Once published, a
--   record stays published.
-- - The person who made a record can edit or delete it. Culture champions,
--   admins and the super admin can edit or delete anyone's published record.
-- - Who wrote a record, and which organization it belongs to, can never be
--   changed by an edit. A Value award keeps its award and its recipient; the
--   citation and files are what change.
--
-- Run after R1 and R2. Additive and guarded, so a second run changes nothing.
-- ============================================================================

begin;

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

commit;

-- ---------------------------------------------------------------- check
-- After running, this should return four rows.
-- select table_name from information_schema.columns
--  where table_schema = 'public' and column_name = 'is_draft'
--    and table_name in ('stories','recognitions','iterations','award_grants');
