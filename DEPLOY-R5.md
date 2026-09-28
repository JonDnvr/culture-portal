# Deploying R5 over R4

This takes the live portal from R4 to R5. It covers only what is new. Allow about fifteen
minutes. There are no new secrets, functions or Stripe settings.

**Before you start**
- R4 is live: its database update has run and its code is on GitHub.
- You can sign in to Supabase and GitHub.

**Order matters, and do the two steps back to back.** R5 stops browsers writing pulse
answers straight into the database, so between steps 1 and 2 the live R4 site cannot save
pulse answers. Nothing else is affected, and nothing is lost: people are asked again.

## What is new

- **Pulse rounds close on participation.** Admin, Settings, "Close a pulse round at" sets
  the share of active members who must rate every behavior (80% to start). The same box
  shows where participation stands and has a button to close the open round now. Only an
  admin or the culture champion can change either.
- **Rounds are dated when they close.** Rounds finished before R5 are recorded as closed
  on their last answer.
- **Reports per round.** In Conviction, Summary ratings and Detail scores have a round
  picker, and a new Pulse rounds tab lists every round with when and how it closed,
  participation, and the average and spread of its answers.
- **Rate what's left**, at the foot of the pulse and on the home page's Survey cadence card,
  puts every behavior a person has left this round in front of them at once.
- **Change password**, in the menu under your name.
- **Two security fixes.** Two reporting views (`behavior_pulse`, `behavior_coverage`)
  ignored row level security, so anyone signed in could read every organization's behavior
  titles, pulse scores and coverage through the API. They now respect it. Pulse answers now
  go through a function that sets the round itself, so nobody can move an organization's
  round from their browser.
- **Fixes.** Conviction's participation number was labelled as behaviors covered; the empty
  Detail scores message always said "two"; the home page and awards wall always said 80%.

---

## 1. Update the database (Supabase website)

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) and the project
   `scypggscxntpaakdjelr`.
2. In the left bar, **SQL Editor**, then **New query**.
3. Open `supabase\migrations\2026-09-28-r5-pulse-rounds.sql` in Notepad. Press Ctrl+A,
   then Ctrl+C.
4. Click into the SQL editor, Ctrl+V, then **Run**.
   - You should see **Success. No rows returned**. Lines saying "does not exist,
     skipping" are normal.
   - It is safe to run again if you're unsure it finished.
5. Check it: clear the editor, paste this, and click **Run**.

   ```
   select o.name, o.pulse_close_pct, count(r.round) as closed_rounds
     from organizations o left join pulse_rounds r on r.org_id = o.id
    group by o.name, o.pulse_close_pct order by o.name;
   ```

   Every organization shows `80`. An organization that had finished pulse rounds shows
   how many.

6. Check the security fix: in the left bar, **Advisors**, **Security Advisor**, then
   **Refresh**. There should be no "Security Definer View" warning for `behavior_pulse`
   or `behavior_coverage`.

## 2. Upload the code (GitHub, then Cloudflare builds)

1. Open the `culture-portal` repository on GitHub.
2. **Add file**, **Upload files**.
3. In File Explorer, open the `culture-portal` folder, select everything inside it
   (Ctrl+A) except `node_modules`, and drag it onto the GitHub page.
4. Wait for the uploads to finish, then **Commit changes**.
5. In Cloudflare, **Workers & Pages**, `culture-portal`, **Deployments**: the newest one
   turns green in a minute or two.

## 3. Check it

Use a test organization, not a pilot.

- [ ] **As a member:** the pulse shows above the page. Rate one, Submit, and the thank-you
      appears. If more are left, **Rate what's left** shows them all.
- [ ] **Home page, Survey cadence:** says the organization's percentage, and **Rate what's
      left** appears when more are left than one sign-in asks.
- [ ] **Menu under your name, Change password:** a wrong current password is refused.
- [ ] **As an admin, Admin, Settings:** "Close a pulse round at" shows the open round and
      participation. Change the percentage; the toast confirms it.
- [ ] **Close round now:** confirm, and the toast says the next round is open.
- [ ] **As a leader, Conviction, Pulse rounds:** the round you closed shows today's date and
      "Closed by" your admin. **See scores** opens it in Detail scores.
- [ ] **As a member:** Admin is not in the menu, and Conviction is not in the rail.

## If something goes wrong

- **"Could not find the function submit_pulse" or pulse answers won't save.** Step 1 hasn't
  run, or didn't finish. Run it again; it is safe to repeat.
- **Going back to R4 code.** Pulse answers won't save under R4 code once step 1 has run,
  because R4 writes them directly. Everything else works. To let R4 save them again, run
  this in the SQL editor:

  ```
  grant insert, update on pulse_responses to authenticated;
  create policy "own pulse responses" on pulse_responses for all
    using (user_id = auth.uid()) with check (user_id = auth.uid() and is_member(org_id));
  ```
