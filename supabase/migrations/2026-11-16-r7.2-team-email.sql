-- R7.2: email a story or recognition to the team when it is published.
-- Everything that changed since R7.1, and nothing else. Safe to run twice.
--
--   stories, recognitions  notify_team: whether publishing it should offer to
--                          email it to the author's team. Saved with a draft,
--                          so the offer comes when the draft is published.

begin;

alter table stories      add column if not exists notify_team boolean not null default false;
alter table recognitions add column if not exists notify_team boolean not null default false;

commit;
