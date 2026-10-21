-- R7: the 6Cs, on behaviors. Everything that changed since R6, and nothing else.
--
-- Paste all of it into the Supabase SQL editor and click Run. It runs as one
-- transaction, only adds, and is safe to run twice.
--
--   categories          Cheer joins as the sixth C; all six take their latest
--                       question and definition
--   behavior_categories which Cs each behavior carries, any number of them.
--                       Filled once from what each behavior shows today (its
--                       own category plus its values' categories), so nothing
--                       changes on screen. behaviors.category and
--                       values_.category stay in place but are no longer read
--                       or written; a later release drops them.

begin;

-- -------------------------------------------------------- the six Cs

insert into categories (name, question, position) values ('Cheer', 'What brings us joy?', 6)
on conflict (name) do nothing;

update categories set position = 1, question = 'Who are we when it costs us?',
  definition = 'Acting on our values when it costs us something. What we say and what we do match, so people can trust both.'
  where name = 'Character';
update categories set position = 2, question = 'How do we treat people?',
  definition = 'Making people feel belonging, seen, safe, and supported, so they speak up, take risks, and bring their best.'
  where name = 'Connection';
update categories set position = 3, question = 'How do we create clarity and build capability?',
  definition = 'Clear decisions, high standards, improving work, and the discipline to build capability in all.'
  where name = 'Craft';
update categories set position = 4, question = 'Who is this for and why does it matter?',
  definition = 'Everyone sees who the work serves, why it matters, and how they contribute. It aligns direction and keeps setbacks in perspective.'
  where name = 'Cause';
update categories set position = 5, question = 'How do we stay significant?',
  definition = 'Facing reality, letting go of what no longer works, accepting what we cannot control, and acting boldly on what we own to grow impact.'
  where name = 'Change';
update categories set position = 6, question = 'What brings us joy?',
  definition = 'Celebrating people: noticing what''s good, encouraging effort, enjoying the work together, and recharging so we keep mattering.'
  where name = 'Cheer';

-- -------------------------------------------------------- Cs on behaviors

create table if not exists behavior_categories (
  behavior_id uuid not null references behaviors(id) on delete cascade,
  category    text not null references categories(name) on update cascade,
  primary key (behavior_id, category)
);
create index if not exists behavior_categories_category on behavior_categories (category);
alter table behavior_categories enable row level security;

drop policy if exists "members read behavior categories" on behavior_categories;
create policy "members read behavior categories" on behavior_categories for select
  using (exists (select 1 from behaviors b where b.id = behavior_id and is_member(b.org_id)));
drop policy if exists "editors write behavior categories" on behavior_categories;
create policy "editors write behavior categories" on behavior_categories for all
  using (exists (select 1 from behaviors b where b.id = behavior_id and can_edit(b.org_id)))
  with check (exists (select 1 from behaviors b where b.id = behavior_id and can_edit(b.org_id)));

grant select, insert, update, delete on behavior_categories to authenticated;

-- Filled once, on the first run only: a second run must not bring back a C
-- someone has since taken off a behavior.
do $$
begin
  if not exists (select 1 from behavior_categories) then
    insert into behavior_categories (behavior_id, category)
    select b.id, b.category from behaviors b
     where b.category is not null
    union
    select bv.behavior_id, v.category
      from behavior_values bv join values_ v on v.id = bv.value_id
     where v.category is not null
    on conflict do nothing;
  end if;
end $$;

commit;
