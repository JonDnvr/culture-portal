-- R5.3: an award's date can be changed when the award is edited. Everything
-- that changed since R5.2, and nothing else.
--
-- Paste all of it into the Supabase SQL editor and click Run. It runs as one
-- transaction and is safe to run twice.
--
--   award_grants  granted_at was fixed once given; now whoever may edit the
--                 award may set its date, as long as it is not in the future.
--                 Publishing a draft still stamps it with today unless a date
--                 was chosen in the same edit.

begin;

-- As in R3, except for granted_at on award_grants.
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
    -- The date may be edited. A draft being published takes today's date,
    -- unless the same edit chose one.
    if old.is_draft and not new.is_draft and new.granted_at is not distinct from old.granted_at then
      new.granted_at := now();
    end if;
    if new.granted_at is null then new.granted_at := old.granted_at; end if;
    if new.granted_at > now() + interval '1 day' then
      raise exception 'An award date cannot be in the future';
    end if;
  end if;
  return new;
end $$;

commit;
