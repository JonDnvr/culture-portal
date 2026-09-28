-- R5.2: example awards for new portals. Everything that changed since R5.1,
-- and nothing else.
--
-- Paste all of it into the Supabase SQL editor and click Run. It runs as one
-- transaction, only adds, and is safe to run twice.
--
--   examples   award types, awards given and teams can be marked as examples,
--              so "Clear example content" removes a new portal's example award,
--              the award given with it, and the example team it went to

begin;

alter table award_types  add column if not exists is_example boolean not null default false;
alter table award_grants add column if not exists is_example boolean not null default false;
alter table teams        add column if not exists is_example boolean not null default false;

commit;
