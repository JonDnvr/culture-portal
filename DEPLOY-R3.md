# Deploying R3: drafts, edit and delete, mobile navigation, Back button

For a project already on R2. Two steps, database first. No edge function changes.

## 1. Database (Supabase SQL editor)

1. Open the Supabase project `scypggscxntpaakdjelr`, then **SQL Editor**, **New query**.
2. Paste all of `supabase/migrations/2026-09-26-r3-edit-drafts.sql` and click **Run**.
3. Notices saying "does not exist, skipping" are expected. It runs as one transaction
   and is safe to run twice.
4. Check: run the query at the bottom of the file (remove the `--`). Four rows.

What it changes:
- `is_draft` and `updated_at` on stories, recognitions, iterations and award_grants.
  Existing rows are published (`is_draft = false`), so nothing already posted changes.
- A draft is visible only to the person who wrote it, and counts toward nothing
  (badges, streaks, rings, coverage report) until it is published. Publishing is
  one way, and it stamps the publish time.
- The author can edit and delete their own. Culture champions, admins and the
  super admin can edit and delete anyone's published record, and its files.
- An edit can never change who wrote a record or which organization it is in.
  A Value award keeps its award and recipient; the citation and files can change.
- A draft Value award does not use up the leader's limit for the period. The limit
  is checked when it is published, and a team award goes to whoever is on the team
  at that moment.

## 2. Code (GitHub, then Cloudflare builds on its own)

Upload these files to the `culture-portal` repository.

Changed:
- `src/App.jsx`, `src/styles.css`
- `src/components/ui.jsx`
- `src/lib/api.js`, `src/lib/local.js`, `src/lib/supabase.js`
- `src/views/Admin.jsx`, `Behavior.jsx`, `Cadence.jsx`, `Clarity.jsx`, `Connection.jsx`,
  `Details.jsx`, `Profile.jsx`, `TrophyWall.jsx`
- `supabase/schema.sql` (R3 appended, so a fresh install gets everything)

New:
- `src/components/records.jsx`
- `src/views/RecordEditor.jsx`
- `supabase/migrations/2026-09-26-r3-edit-drafts.sql`
- `DEPLOY-R3.md`

Or upload the whole `culture-portal` folder from the zip over the repository.

## 3. Check it

- On a phone: the organization, Awards, Admin and your picture sit in one bar at the
  top; the five sections sit in a bar along the bottom. Nothing to scroll to reach them.
- Tap your picture: Change picture, Your drafts, Sign out.
- Connection, Recognize someone, **Save as draft**. It shows under "Your draft
  recognition" and nobody else sees it. **Publish** puts it in the list.
- As the culture champion: open anyone's story, recognition, session or Value award.
  **Edit** and **Delete** are there. Delete always asks first.
- Press the browser's Back button: it closes an open dialog, then goes back a page.
  On the home page it asks before leaving the portal.
