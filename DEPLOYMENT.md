# Deploying R4 over R3

This takes the live portal from R3 to R4. It covers only what is new: nothing done for R3
is repeated. Allow about an hour. Do it in test mode first (Stripe test keys, a test
organization), then switch Stripe to live at the end.

**Before you start**
- R3 is live: its database update has run and its code is on GitHub.
- The R4 zip is unzipped somewhere, for example `Downloads\culture-portal-r4\culture-portal`.
- You can sign in to Supabase, Stripe, GitHub and Cloudflare.

**About the command boxes.** Type only what is inside a box. A word like `bash` or
`powershell` on the edge of a box is a label, not part of the command. Every command runs
in **PowerShell**, from inside the `culture-portal` folder (step 3.1 shows how to get
there).

**Order matters.** Database first, then Stripe, then functions, then code. Code that
arrives before the database update shows errors until step 1 is done.

---

## 1. Update the database (Supabase website)

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) and the project
   `scypggscxntpaakdjelr`.
2. In the left bar, **SQL Editor**, then **New query**.
3. Open `supabase\migrations\2026-09-26-r4.sql` in Notepad. It's also in Downloads as
   `culture-portal-r4.sql`. Press Ctrl+A, then Ctrl+C.
4. Click into the SQL editor, Ctrl+V, then **Run**.
   - You should see **Success. No rows returned**. Lines saying "does not exist,
     skipping" are normal.
   - It is safe to run again if you're unsure it finished.
5. Check it: clear the editor, paste this, and click **Run**.

   ```
   select name, access_status(id), override_kind, override_until from organizations order by name;
   ```

   Mountain Vistage and Vail Daily both show `override`, `invoiced` and `2099-12-12`.

What it changes:
- It only adds and removes no data.
- Members of an organization whose plan is not current (other than the culture
  champion) can no longer read its data. The pilots are covered by the invoiced
  arrangement, so nothing changes for them.

---

## 2. Set up Stripe (Stripe website, test mode)

Open [dashboard.stripe.com](https://dashboard.stripe.com) and turn on **Test mode**
(top right).

1. **Tax.** Settings, **Tax**:
   1. Turn on Stripe Tax.
   2. Add your origin address in Colorado.
   3. Add any registrations where you collect tax.

   Prices are charged plus tax. The portal marks its product as software as a service
   for business use (`txcd_10103001`); confirm that under Product catalog after the
   first checkout.
2. **Customer portal.** Settings, Billing, **Customer portal**. Allow:
   - updating the payment method
   - viewing invoices
   - cancelling at the end of the period

   Save.
3. **Retries.** Settings, Billing, **Subscriptions and emails**:
   1. Turn Smart Retries on, for about a week.
   2. Set "If all retries for a payment fail" to **cancel the subscription**.
4. **Webhook.** Developers, **Webhooks**, **Add endpoint**:
   - Endpoint URL:
     `https://scypggscxntpaakdjelr.supabase.co/functions/v1/stripe-webhook`
   - Events:
     - `checkout.session.completed`
     - `customer.subscription.created`, `customer.subscription.updated` and
       `customer.subscription.deleted`
     - `invoice.paid` and `invoice.payment_failed`
   - Save, then **Reveal** the signing secret. It starts `whsec_`. Keep it for step 3.
5. **Secret key.** Developers, **API keys**, the test **Secret key** (`sk_test_...`). Keep it
   for step 3.
   - It goes only into Supabase (step 3), never into GitHub or the website.
   - It was pasted in a chat, so **Roll key** before going live, and use the new one.

---

## 3. Secrets and server functions (PowerShell)

### 3.1 Open PowerShell in the project folder

1. Open File Explorer to the `culture-portal` folder (the one containing `package.json`).
2. Click the address bar, type `powershell`, and press Enter.
3. Check you're in the right place:

   ```
   dir package.json
   ```

   It lists the file. If it says it cannot find it, you are in the wrong folder.

### 3.2 Check the tools

```
node --version
```

This should print a version, like `v22.x.x`. If it's not recognized, install the LTS version
from nodejs.org, close PowerShell, and open it again as in 3.1.

The Supabase tool runs through `npx`, so there is nothing else to install. The first time,
it may ask `Ok to proceed? (y)`; type `y` and press Enter.

```
npx supabase --version
```

### 3.3 Sign in and link the project

```
npx supabase login
```

Your browser opens. Click **Authorize**, then come back to PowerShell.

```
npx supabase link --project-ref scypggscxntpaakdjelr
```

If it asks for the database password, paste it (nothing shows as you paste) and press Enter.
It ends with `Finished supabase link`.

### 3.4 Add the new secrets

Make a random string for the daily notices job:

```
[guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
```

Copy what it prints. Then run these three commands, each on one line, with your own
values in place of the parts in angle brackets. Leave out the angle brackets.

```
npx supabase secrets set STRIPE_SECRET_KEY=<your sk_test_ key>
```

```
npx supabase secrets set STRIPE_WEBHOOK_SECRET=<your whsec_ secret>
```

```
npx supabase secrets set CRON_SECRET=<the random string> BILLING_COPY_TO=jon@horizonlinegroup.com
```

Each prints `Finished supabase secrets set`. The email secrets from R3 (`RESEND_API_KEY`,
`STORY_FROM_EMAIL`, `PUBLIC_APP_URL`) stay as they are.

### 3.5 Deploy the functions

One at a time, waiting for each to say `Deployed Functions`:

```
npx supabase functions deploy billing
```

```
npx supabase functions deploy stripe-webhook --no-verify-jwt
```

```
npx supabase functions deploy billing-notices --no-verify-jwt
```

```
npx supabase functions deploy signup --no-verify-jwt
```

```
npx supabase functions deploy share-story
```

`billing-notices` is new. The other four changed since R3. `manage-users` did not change
and needs nothing.

---

## 4. Schedule the daily notices (Supabase SQL editor)

The daily job needs two Supabase extensions, `pg_cron` (the scheduler) and `pg_net` (lets
the database call a function). This does it all in one paste, with no Cron screens.

1. Supabase, **SQL Editor**, **New query**. Paste this, then replace `PASTE-CRON-SECRET`
   with the random string from 3.4. Keep the single quotes around it.

   ```
   create extension if not exists pg_cron with schema pg_catalog;
   create extension if not exists pg_net with schema extensions;

   select cron.unschedule('billing-notices')
    where exists (select 1 from cron.job where jobname = 'billing-notices');

   select cron.schedule(
     'billing-notices',
     '5 14 * * *',
     $$
     select net.http_post(
       url := 'https://scypggscxntpaakdjelr.supabase.co/functions/v1/billing-notices',
       headers := jsonb_build_object('Content-Type', 'application/json',
                                     'x-cron-secret', 'PASTE-CRON-SECRET'),
       body := '{}'::jsonb
     );
     $$
   );
   ```

2. Click **Run**. The last result shows a job number. `5 14 * * *` is 8:05 am Mountain in
   summer, 7:05 am in winter. Running this again replaces the job, so it's safe to repeat.
3. Test it now: run this in a new query.

   ```
   select net.http_post(
     url := 'https://scypggscxntpaakdjelr.supabase.co/functions/v1/billing-notices',
     headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', 'PASTE-CRON-SECRET'),
     body := '{}'::jsonb);
   ```

   Then open Edge Functions, `billing-notices`, **Logs**. The newest line shows a 200.
   A 403 means the secret doesn't match the CRON_SECRET from 3.4.

## 5. Upload the code (GitHub, then Cloudflare builds)

1. Open the `culture-portal` repository on GitHub.
2. **Add file**, **Upload files**.
3. In File Explorer, open the unzipped `culture-portal` folder, select everything inside
   it (Ctrl+A), and drag it onto the GitHub page. Folders come along with their contents.
4. Wait for the uploads to finish, then **Commit changes**.
5. Cloudflare sees the commit and builds. In Cloudflare, **Workers & Pages**,
   `culture-portal`, **Deployments**, the newest one turns green in a minute or two.

Notes:
- Nothing needs deleting in the repository; every R3 file is still used or replaced.
- Cloudflare needs no new settings. The build already carries the public Supabase address
  and key; the secret keys live only in Supabase.

---

## 6. Check it (test mode)

Use a new test organization, not a pilot.

- [ ] **Signed out:** the Horizon Line page with three tabs, and Forgot password inside Sign in.
      Start a free trial shows both plans' prices.
- [ ] **Start a free trial** with a test email. You land in the portal as the champion.
      Admin, Plan and billing says "Free trial of the unlimited plan", 30 days out.
- [ ] **Pick a plan.** Choose Monthly or Yearly, then **Keep this plan** on a plan, then
      **Add a payment method**. Stripe's page opens. Use:
      - card `4242 4242 4242 4242`
      - any future date and any three digits
      - a Colorado address

      Back in the portal: card ending 4242, first charge the day after the trial.
- [ ] **In Stripe**, Billing, Subscriptions: the new subscription is **Trialing**, with tax
      automatic.
- [ ] **The pilots.** Sign in as a Vail Daily or Mountain Vistage member. Everything works
      as before. Admin, Plan and billing says it is arranged with Horizon Line through
      December 12, 2099.
- [ ] **As super user:**
      - Admin, Super admin shows Default prices.
      - On the test organization, saving an arrangement shows it to that champion.
- [ ] **Around the portal:** Connection, What's Good lists recognition, stories and Value
      awards. Admin has About Us, People, Plan and billing, and Settings.
- [ ] **Cron:** the `billing-notices` test call in step 4 shows a 200 in the function's logs.

When you're satisfied, cancel the test subscription in Stripe (test mode) so it doesn't
linger.

---

## 7. Go live with Stripe

1. Stripe: turn off Test mode.
   - Repeat step 2 in live mode: tax, customer portal, retries, and a new webhook with the
     same address and events.
   - Copy the live `sk_live_` key and the live webhook's `whsec_` secret.
2. PowerShell, in the project folder:

   ```
   npx supabase secrets set STRIPE_SECRET_KEY=<your sk_live_ key>
   ```

   ```
   npx supabase secrets set STRIPE_WEBHOOK_SECRET=<your live whsec_ secret>
   ```

   The functions pick up new secrets on their next run. No redeploy needed.
3. Roll the test secret key in Stripe too, since it was shared in a chat.

---

## 8. Optional: culture-portal.horizonlinegroup.com

Do this any time after step 5. Your domain's DNS is at WordPress.com, and a Cloudflare
Worker can only use a custom domain whose DNS is on Cloudflare. The simplest route is a
Cloudflare Pages copy of the same repository, which keeps DNS where it is.

1. Cloudflare: **Workers & Pages**, **Create**, **Pages**, **Connect to Git**, pick
   `culture-portal`. Set:
   - Framework: None
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment variables: none

   Deploy, then open the `...pages.dev` address to check it works. A build warning about
   `wrangler.jsonc` is harmless.
2. In the Pages project: **Custom domains**, **Set up a custom domain**,
   `culture-portal.horizonlinegroup.com`. Do this before step 3, or the address shows a
   522 error.
3. WordPress.com: **Upgrades**, **Domains**, horizonlinegroup.com, **DNS records**, **Add**.
   Add a record with type **CNAME**, name `culture-portal`, and value `<your project>.pages.dev`.
   Save it.
4. Wait for Cloudflare to show **Active**. It usually takes minutes, sometimes up to a day.
5. Supabase:
   1. Authentication, **URL Configuration**. Set Site URL to
      `https://culture-portal.horizonlinegroup.com`, and add it under Redirect URLs. Keep the
      old address in the list for now.
   2. Then, in PowerShell:

      ```
      npx supabase secrets set PUBLIC_APP_URL=https://culture-portal.horizonlinegroup.com
      ```

6. To embed it on horizonlinegroup.com, add a Custom HTML block (WordPress.com Business
   plan or above):

   ```
   <iframe src="https://culture-portal.horizonlinegroup.com/" title="Culture Portal" style="width:100%;height:1150px;border:0" loading="lazy"></iframe>
   ```

   On a lower plan, link a button to the address instead.

---

## If something goes wrong

- **The site shows errors right after upload.** The database update (step 1) hasn't run, or
  didn't finish. Run it again; it is safe to repeat.
- **Checkout says "No rate is set for that plan".** Super admin, that organization, Rates:
  enter its prices.
- **Going back to R3 code.** Upload the R3 files over the repository the same way. The
  database update can stay; R3 ignores what it added.
  - One exception: members of an organization whose plan isn't current stay locked out
    under R3 too.
  - For the pilots that never applies, because of their arrangement.
- **Function errors.** In Supabase, open Edge Functions, click the function, then **Logs**.
  The newest line usually says what's missing, often a secret from step 3.4.

What changed in R4, feature by feature, is in `DEPLOY-R4.md`. The full first-time setup,
from an empty Supabase project, is in `DEPLOYMENT-FIRST-TIME.md`.
