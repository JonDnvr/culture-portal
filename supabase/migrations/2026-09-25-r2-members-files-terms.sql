-- ============================================================================
-- R2: any member records a practice, Value awards carry files, and each
-- organization names its own behaviors.
--
-- Run after 2026-09-25-r1-gamification.sql. Additive and guarded, so a second
-- run changes nothing.
-- ============================================================================

begin;

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

commit;
