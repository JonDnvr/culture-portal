# Deploying R1 (superseded: see DEPLOY-R2.md to run R1 and R2 together)

Order matters. Run the database step before the code reaches Cloudflare. The site
tolerates a few minutes in the other order (the new parts show as empty), but
recording a practice with a team fails until the migration has run.

No edge function changes. Nothing to redeploy in `supabase/functions`.

## 1. Database (Supabase SQL editor)

1. Open the Supabase project `scypggscxntpaakdjelr`, then **SQL Editor**, **New query**.
2. Paste all of `supabase/migrations/2026-09-25-r1-gamification.sql` and click **Run**.
3. It ends with `commit`. Notices saying "does not exist, skipping" are expected.
4. Check: run the query at the bottom of the file (remove the `--`). Eight rows.

It is safe to run twice. It only adds tables, columns, functions, policies and the
`avatars` storage bucket. The one change to existing structure: `iterations.ritual_id`
is no longer required, because an iteration can now be a system run.

It also closes a gap: the old iteration edit policy let any member insert an
iteration through the API. Inserts now go through the leader-only policy.

## 2. Code (GitHub, then Cloudflare builds on its own)

Upload the changed and new files to the `culture-portal` repository:

Changed:
- `src/App.jsx`, `src/styles.css`
- `src/components/ui.jsx`
- `src/lib/api.js`, `src/lib/local.js`, `src/lib/supabase.js`
- `src/views/Admin.jsx`, `Behavior.jsx`, `Cadence.jsx`, `Clarity.jsx`, `Connection.jsx`,
  `Conviction.jsx`, `Details.jsx`, `Home.jsx`
- `supabase/schema.sql`

New:
- `src/components/badges.jsx`, `src/components/badgeDetails.jsx`
- `src/lib/gamify.js`
- `src/views/HomeBadges.jsx`, `src/views/Profile.jsx`, `src/views/TrophyWall.jsx`
- `supabase/migrations/2026-09-25-r1-gamification.sql`
- `DEPLOY-R1.md`

Easiest: GitHub, **Add file**, **Upload files**, drag the `src` and `supabase` folders
and this file in, **Commit changes**. GitHub replaces files with the same path.

## 3. After it is live

1. **Put everyone on a team.** Existing members start with no team. Admin, People:
   each row has a Team dropdown with "+ Create a new team" at the bottom.
2. **Create the Value awards.** Admin, Value awards, New Value award. Name it, pick
   its Values, choose person or team, set the limit per leader.
3. **Ask people to add a picture.** Their name at the foot of the left rail opens it.

## Check it worked

- [ ] Home shows Badges and streaks under This week, with a Vail Daily / team toggle.
- [ ] Cadence, Rituals, Practice It: only that ritual's behaviors, none selected.
- [ ] A behavior page, Open the practice: same dialog, with Mark it done for leaders.
- [ ] A behavior page, a system's Open the template (or Record a run): records a system run.
- [ ] Connection, Recognize someone: a person list and a title, not a typed name.
- [ ] Trophy Wall at the foot of the navigation: Me, your team, the organization.
- [ ] Admin: team dropdowns, gold star counts that open a list, Value awards.

## What counts, in one place

- Weeks run Monday to Sunday. The week in progress never breaks a streak.
- Behavior of the Week streak: weeks with the practice session recorded.
- Practiced: any other ritual, or any system, recorded against a behavior. The
  session counts as discussion, not practice.
- Team credit follows the team chosen on the Practice It form.
- Seal tiers at 4, 12, 26 and 52 weeks; each notch is a month.
- Recent window: the Admin setting in days, read as weeks for badges (45 days = 6).
- Gold stars: recognition that picked a member from the list. Older recognition
  with a typed name stays visible but earns no star.
- Fluency: read the description (open the behavior), read a practice or template,
  you or your team recorded a discussion, you or your team recorded a practice.
  A gold star or your own story for that behavior makes you Fully Fluent.
- The Full Set: every Foundation discussed and practiced at least once.
- Survey cadence: the existing pulse rounds. Gap Closed: average spread narrowed
  between the last two finished rounds.
