# Deploying R5.1 over R5

A small update on top of R5. Allow about ten minutes. Do the three steps in order.

## What is new

- **New portals start with more examples.** Besides the example values and behaviors, a
  new trial now gets: each example behavior built into a system, an example ritual
  ("Friday wins round"), and a little history in the champion's name (a practice session,
  a ritual run, a system run dated today, a recognition and a story). All of it is tagged
  Example, and **Admin, Clear example content** removes all of it.
- **Example values have a 5C category:** Challenge is Change, Candor is Character, Care is
  Connection. (Challenge replaced the example value Trust.) Portals made earlier that still have the untouched example Trust value move
  it to Change.
- **Home page, Survey cadence:** shows how much of the round is rated (every rating in so
  far, divided by every active member rating every behavior), and the cairn fills with
  that. "x of y people finished" stays. **Rate now** is now **Run a Pulse**.
- **Admin, Settings:** "Close a pulse round at" explains participation (people finished
  divided by active members), shows people finished and participation now, and has a
  **Close Round Now** button.

## 1. Update the database

Same as before: Supabase, **SQL Editor**, **New query**, paste all of
`supabase\migrations\2026-09-28-r5.1-examples-progress.sql`, **Run**. You should see
**Success. No rows returned**. It is safe to run again.

## 2. Deploy the sign-up function

In PowerShell, from the `culture-portal` folder:

```
supabase functions deploy signup --no-verify-jwt --project-ref scypggscxntpaakdjelr
```

## 3. Upload the code

GitHub, **Add file**, **Upload files**, select everything in the `culture-portal` folder
(there is no `node_modules` folder to leave out now), **Commit changes**, and wait for the
Cloudflare deployment to turn green.

## R5.2: example awards

New trials also get an example Value award ("The Keystone Award", for Challenge and Care) given
to an empty "Example team", and Clear example content removes the award, the award given
and the team. Editing an example award, team, session, recognition or story makes it yours.

1. Run `supabase\migrations\2026-09-28-r5.2-example-awards.sql` in the SQL editor, as in step 1.
2. Deploy the sign-up function again, as in step 2.
3. It goes up with the code in step 3.

## Check it

- [ ] **Start a free trial** with a test organization. Clarity shows each behavior with a
      system; Cadence, Rituals shows "Friday wins round" tagged Example; Connection shows
      one recognition and one story; Awards shows The Keystone Award to Example team; the
      home page shows 1 practiced this week.
- [ ] **Admin, About Us, Clear example content** removes all of it, including the award
      and the example team, and leaves the weekly practice ritual.
- [ ] **Home page, Survey cadence**: "% complete", "x of y people finished" and **Run a Pulse**.
- [ ] **Admin, Settings**: people finished, participation, and **Close Round Now**.
