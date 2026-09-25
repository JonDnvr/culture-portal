# Deploying R1 + R2 together

For a project where neither R1 nor R2 has been run. Three steps, in this order.

## 1. Database (Supabase SQL editor), one run

1. Open the Supabase project `scypggscxntpaakdjelr`, then **SQL Editor**, **New query**.
2. Paste all of `supabase/migrations/2026-09-25-r1-r2-combined.sql` and click **Run**.
3. Notices saying "does not exist, skipping" are expected.
4. Check: run the query at the bottom of the file (remove the `--`). Ten rows.

It runs as one transaction, so if anything fails nothing is changed. It is safe to
run twice, and safe if R1 was somehow already run. Do not also run the separate R1
and R2 files; they are kept in the folder only for the record.

What it adds:
- R1: teams, profile pictures (`avatars` bucket), system runs as iterations,
  recognition tied to a person, Value awards, fluency marks, and the pulse history
  the Gap Closed badge reads. The one change to existing structure:
  `iterations.ritual_id` is no longer required, because an iteration can be a system run.
- R2: any member can record an iteration, as themselves, for a team in their own
  organization. Files on Value awards (`award_grant_attachments`, stored in the
  existing `story-media` bucket). `organizations.behavior_label` and
  `behavior_label_plural` for the organization's own word; only admins can change them.

## 2. Edge function (Supabase CLI)

The share email now handles recognition and Value awards as well as stories:

```
supabase functions deploy share-story
```

No new secrets. It uses the same email settings the story share already uses.
Until it is redeployed, "Share by email" on recognition and awards returns an error.
Sharing a story keeps working either way.

## 3. Code (GitHub, then Cloudflare builds on its own)

Upload these files. This covers both R1 and R2.

Changed:
- `src/App.jsx`, `src/styles.css`
- `src/components/ui.jsx`
- `src/lib/api.js`, `src/lib/local.js`, `src/lib/supabase.js`
- `src/views/Admin.jsx`, `Behavior.jsx`, `Cadence.jsx`, `Clarity.jsx`, `Connection.jsx`,
  `Conviction.jsx`, `Details.jsx`, `Home.jsx`, `PulseCheck.jsx`
- `supabase/functions/share-story/index.ts`
- `supabase/schema.sql` (R1 and R2 appended, so a fresh install gets everything)

New:
- `src/components/badges.jsx`, `badgeDetails.jsx`, `listTools.jsx`
- `src/lib/gamify.js`, `src/lib/term.js`
- `src/views/HomeBadges.jsx`, `Profile.jsx`, `TrophyWall.jsx`
- `supabase/migrations/` (the combined file, plus the separate R1 and R2 files for the record)
- `DEPLOY-R1.md`, `DEPLOY-R2.md`

Simplest: upload the whole `culture-portal` folder from the zip over the repository
(it leaves out `node_modules` and build output).

## 4. Check it

- Sign in as a member (not a leader). Cadence, This week: **Record an iteration** is
  there, and the behavior of the week is already selected.
- Admin, **What you call behaviors**: enter e.g. Foundation / Foundations, Save.
  The nav, home, Clarity and Cadence all switch. Clear both boxes to go back.
- Trophy Wall: give a Value award with a picture. The picture shows on the award.
- Connection: open **Share by email** on a recognition. "Send to" starts empty.
