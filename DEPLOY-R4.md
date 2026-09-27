# Deploying R4: self-serve plans and billing, logos, the 5C switch, the new sign-on page

**Starting point:** R3 is live (its migration has run and its code is on GitHub). If not,
deploy R3 first with DEPLOY-R3.md, then this.

For a project already on R3. **Not deployed yet.** R4 is in the local demo only
until you decide to promote it. Order matters: database, then Stripe, then functions,
then code.

## What R4 changes

- **Sign-on page** in Horizon Line Group's look, written for prospects first. It has
  three tabs: Sign in, Start a free trial, Request access. The top Forgot password tab
  is gone; the button inside the sign-in form stays. It can sit in an iframe on
  horizonlinegroup.com. Inside a frame its buttons open the portal full size.
- **Side navigation** is 168px wide, just enough for "Recognition, Stories". The phone
  layout starts at 540px.
- **5C switch** (Admin, Settings), per organization. On: category tags on behaviors, a
  5C section at the end of the home page with short definitions, and Conviction,
  Coverage, By category. Off: tags and category filters hidden. Behaviors keep their
  category either way.
- **Colored boxes** matching the tag colors: Values (burnt orange) on the home page,
  Rituals (grape) and Systems (blue) on Cadence and on behavior pages, and the 5C
  cards and the By category column headers (sage).
- **Logo upload** (Admin, Settings). It replaces the initials block in the header.
- **Plan and billing** tab in Admin for the culture champion:
  - Options and features for the two existing plans (up to 9 people, unlimited) and
    the two terms (monthly, yearly).
  - Choosing a plan the first time starts a 30-day trial. No card is needed.
  - Stripe Checkout collects the card and billing address, and Stripe Tax calculates
    the tax. Billing starts when the trial ends and then renews automatically.
- **Access rules:**
  - Trial with no card by day 30: access narrows to the culture champion. There is a
    warning 7 days before.
  - Failed payment: 7 days of grace, then champion only.
  - Cancelled: access runs to the end of the paid period, then champion only.
  - Data is never deleted.
- **Notices**, emailed to the champion with a copy to Jon, and shown on Admin and as
  a banner:
  - trial ending (7 days before) and trial ended
  - renewal: 30, 7 and 1 days before for yearly plans; 7 and 1 days before for monthly
  - cancellation ending: 7 and 1 days before
  - payment overdue, and access narrowed
  - a receipt after every completed Stripe payment, with the new paid-through date
- **Super user** (Admin, Super admin) can set any billing field for any organization:
  rates, plan, term, trial end, paid-through, cancel, and a fresh trial.
- **Arrangements** (super user). "Invoiced outside Stripe" or "Extend the expiration
  date", with an end date. An arrangement wins over whatever Stripe reports.
- **Pilots.** Mountain Vistage and Vail Daily start as Invoiced outside Stripe until
  December 12, 2099.

### Added in the second round (still R4, same migration)

- **Sign-on page:**
  - The HLG oval logo, with "HORIZON LINE GROUP" in bold capitals.
  - Sans type throughout.
  - The new copy, including a "You get" list of Clarity, Cadence, Connection,
    Conviction and Engagement.
- **Home:**
  - All behaviors now comes right after Badges and streaks.
  - The 5C cards expand to the values in each category.
- **Values** each take one of the 5Cs, set on the value's edit form. The pilots'
  existing values get a first guess by name: Trust, Commitment and Humility as
  Character; Care and Vulnerability as Connection; Challenge and Leadership Excellence
  as Craft; Growth as Change.
- **Admin tabs:** About Us, People, Plan and billing, Settings, with Super admin
  first for the super user.
  - **About Us:** Logo and Highlight color side by side, Purpose and identity,
    Values, Value awards, the 5C Value Categories switch, Our Systems (renamed from
    System categories), Measures, and Example content clearer.
  - **People:** the plan and its status (click the status to open Plan and billing),
    Tentative members, People, and What each role can do.
  - **Settings:** the featured behavior with its refresh cadence, the other
    settings, and the email outbox.
- **Plan and billing:** "Yearly, w Discount", and no feature list under the plan
  buttons.
- **Email preferences:** anyone can open it from their picture menu. Opting out
  stops the weekly prompts and shares. Account email and the champion's billing
  notices still arrive.
- **Refresh cadence** for the featured behavior:
  - Daily (weekdays), weekly (Mondays), or monthly on a chosen day from 1 to 28.
  - Rotation, streaks, "practiced" badges and seals count in that unit. Seals still
    mean a month, a quarter, a half year and a year.
  - The hosted rotation now runs in the database (`maybe_advance_weekly`) when
    behaviors load.
- **Pulse:**
  - A round is complete only when 80% of members have each rated every behavior.
  - Rate now shows whenever the person still has behaviors to rate.
  - Fluency now has a fifth step: rate the behavior at least once.
- **Clickable tags:**
  - A value or 5C tag opens its definition.
  - A behavior's Rituals or Systems tag opens that list, filtered to the behavior.

### Added in the third round (still R4, same migration)

- **Trial:**
  - The trial no longer asks for a plan. Every new portal gets 30 days of the
    unlimited plan.
  - The sign-up form shows both plans' prices, with "Both plans include
    everything, pick a plan and set up payment only if you keep it."
  - In Plan and billing, the champion picks the plan to keep ("Keep this plan"),
    then adds a payment method.
- **Inactive people.** Picking Up to 9 people with more people in the portal warns
  how many will be inactivated. It happens when the plan starts: at the first
  charge after a trial, or right away otherwise.
  - The most recently added go first. The culture champion never does.
  - Inactive people can't sign in and are told why. People shows them with an
    Inactive tag and a Reactivate button, which works when a seat is free.
  - Moving to Unlimited brings everyone back.
- **Prices.** Defaults are now Up to 9 people $15 a month or $159 a year, and
  Unlimited $49 a month or $499 a year.
  - The super user sets them under Super admin, Default prices. They show on the
    sign-in page and are copied onto each new organization.
  - Each organization's own prices are set separately, under Rates.
  - Organizations still on the first R4 prices move to the new ones. Mountain
    Vistage and Vail Daily keep the prices they were quoted.
- **Our Systems** in Admin works like Values: Add a system at the top, and Edit and
  Delete on each row.
- **Cadence, Systems:** each card has Practice It, Details, Edit and Delete, like
  Rituals. Details opens a page for that system placement with its template and
  recorded runs.
- **Back from a tag:** opening Rituals or Systems from a behavior's tag shows a Back
  button.
- **Browser Back:** asks before leaving the portal from any screen, including the
  sign-in page.
- **Drafts:** saving one says "Saved as a draft. Publish it from your top account
  dropdown."
- **Reset demo data** (demo only) is no longer in the account dropdown. Only the
  culture champion can reset, from Admin, Settings, and it asks first.
- **Sign-up form:** no Subtitle field. The hint under "Your name" says
  "Who's the Culture Champion." 
- **Copy:** the new Connection and Cadence lines in "You get", and the new footer line.

### Added in the fourth round (still R4)

- **What's Good**, a new Connection tab: every recognition, story and Value award, newest
  first. It has kind, value and behavior filters, the team toggle, search, See more, Open,
  and Edit for whoever may. It works like Cadence, Sessions.
- **Ready for production:**
  - About 50 CSS rules and seven functions nothing used are gone.
  - The two sign-on images are WebP files, loaded as separate cached files instead of
    inside the code.
  - Admin and Conviction load only when opened. The first page's code went from
    410 KB to 238 KB.

## 1. Database (Supabase SQL editor)

1. Project `scypggscxntpaakdjelr`, **SQL Editor**, **New query**.
2. Paste all of `supabase/migrations/2026-09-26-r4-billing-logo-5c.sql` and **Run**.
   It is one transaction and safe to run twice.
3. Check: run the query at the bottom of the file (remove the `--`). Both pilots
   should read `override`.

What it adds:
- Organization columns for the trial, card, subscription status, arrangement, logo
  and the 5C switch.
- A `billing_notices` table, so each email goes out once.
- The `logos` storage bucket, public read. Only editors of that organization can write.
- The 5C questions updated to the latest model, each with a short definition.

One behavior change: **when a plan is not current, members other than the culture
champion read nothing.** Their role resolves to none. Signing in tells them the portal
is paused and names the champion.

Tested on Postgres 16 against the R3 schema. The checks covered each access state in
turn: trial, trial ended, grace, lapsed and cancelled. They also covered:
- a super user override winning over everything
- the paused message
- a champion who can switch the 5C tags and set the logo, but cannot touch billing
- the service role writing billing fields

## 2. Stripe (dashboard, test mode first)

1. **Keys.** Use the test keys for now. The secret key goes only into Supabase secrets
   (step 3), never into the repository or the site. It has been pasted in a chat, so
   roll it (Developers, API keys, Roll key) before you go live. Do the same for the live
   key when you get there.
2. **Tax.** Settings, Tax: turn on Stripe Tax, add your origin address (Colorado), and
   add registrations where you collect tax. The functions set the product tax code to
   `txcd_10103001`, software as a service for business use. Confirm that is right for
   you under Product catalog. Prices are tax-exclusive, so tax is added on top.
3. **Customer portal.** Settings, Billing, Customer portal. Allow:
   - updating the payment method
   - viewing invoices
   - cancelling at the end of the period
4. **Retries.** Settings, Billing, Subscriptions and emails:
   - Smart Retries on, for about a week.
   - After all retries fail, **cancel the subscription**.

   The portal's 7-day grace period covers the retry window.
5. **Webhook.** Developers, Webhooks, Add endpoint:
   `https://scypggscxntpaakdjelr.supabase.co/functions/v1/stripe-webhook`
   Events:
   - `checkout.session.completed`
   - `customer.subscription.created`, `customer.subscription.updated` and
     `customer.subscription.deleted`
   - `invoice.paid` and `invoice.payment_failed`

   Copy its signing secret (`whsec_...`).

## 3. Secrets and functions (terminal, in the project folder)

    supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_WEBHOOK_SECRET=whsec_...
    supabase secrets set CRON_SECRET=<a long random string> BILLING_COPY_TO=jon@horizonlinegroup.com
    supabase functions deploy billing
    supabase functions deploy stripe-webhook --no-verify-jwt
    supabase functions deploy billing-notices --no-verify-jwt
    supabase functions deploy signup --no-verify-jwt
    supabase functions deploy share-story

`RESEND_API_KEY` and `STORY_FROM_EMAIL` are already set. Billing emails use them.

`supabase/functions/_shared/billing.js` is a copy of `src/lib/billing.js`, so the
notices use exactly the rules the portal shows. If you edit one, copy it over the other.

## 4. Schedule the daily notices

Supabase dashboard, **Integrations**, **Cron**, enable it if asked, then **Create job**:
- Name `billing-notices`, schedule `5 14 * * *` (8:05 am Mountain, 7:05 am in winter)
- Type: Supabase Edge Function, `billing-notices`, method POST
- Header: `x-cron-secret` = the CRON_SECRET from step 3

Check it: **Run** once. The response lists anything sent. It is empty on a normal day.

## 5. Code (GitHub, then Cloudflare builds)

Upload the whole `culture-portal` folder from the zip over the repository: GitHub,
**Add file**, **Upload files**. Drag in everything inside the folder, then **Commit
changes**. Cloudflare builds and deploys on its own in a minute or two.

- Do not upload `node_modules`, `dist` or `dist-single`. They are not in the zip.
- Nothing needs deleting from the repository. Every R3 file is still used or replaced.
- The build already carries the project's public Supabase address and key, in
  `vite.config.js`, so Cloudflare needs no environment variables. It never needs the
  secret keys; those live only in Supabase secrets (step 3).

## 6. culture-portal.horizonlinegroup.com

Your DNS is at WordPress.com. The portal runs as a Cloudflare **Worker**, and a Worker
custom domain needs the whole domain's DNS on Cloudflare. Two ways to get the address.

**Option A: add a Cloudflare Pages copy of the site. DNS stays at WordPress.com.**
Recommended: nothing about your email or website DNS changes.

1. Cloudflare dashboard: **Workers & Pages**, **Create**, **Pages**, **Connect to Git**.
   Pick the `culture-portal` repository.
2. Build settings:
   - Framework: None
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment variables: none. The build carries the public Supabase values.
     A warning about `wrangler.jsonc` in the build log is harmless: that file is for the
     Worker, and Pages ignores it.

   Deploy it and open the `…pages.dev` address to check it works.
3. In the new Pages project: **Custom domains**, **Set up a custom domain**, enter
   `culture-portal.horizonlinegroup.com`. Do this first; a CNAME added before this step
   gives a 522 error.
4. WordPress.com: **Upgrades**, **Domains**, horizonlinegroup.com, **DNS records**, **Add**:
   - Type **CNAME**
   - Name `culture-portal`
   - Value `<your-project>.pages.dev` (the address from step 2)

   Save.
5. Back in Cloudflare, wait for the domain to show **Active**. It usually takes minutes
   and can take up to a day. The certificate is automatic.

**Option B: move horizonlinegroup.com's DNS to Cloudflare and keep the Worker.**
More moving parts; only if you want everything on Cloudflare.

1. Cloudflare: **Add a domain**, horizonlinegroup.com, Free plan. Compare the records
   it imports with WordPress.com's list, one by one. Make sure of:
   - the website records
   - the MX records for Mimecast
   - every Resend record (DKIM, SPF, the `send` subdomain)
2. WordPress.com: Domains, **Name servers**. Switch to custom name servers and enter
   Cloudflare's two.
3. Once the domain is active in Cloudflare: Worker `culture-portal`, **Settings**,
   **Domains & Routes**, **Add**, **Custom domain**, `culture-portal.horizonlinegroup.com`.

**After either option:**
- Supabase: **Authentication**, **URL Configuration**. Set Site URL to
  `https://culture-portal.horizonlinegroup.com` and add it under Redirect URLs. Keep the
  old address in the list until everyone has moved.
- Supabase secret: `supabase secrets set PUBLIC_APP_URL=https://culture-portal.horizonlinegroup.com`.
  Welcome and reset emails link there.
- Stripe needs nothing. Checkout returns to whichever address the champion started from.
- Embed on WordPress. It is same-site now, so sign-in inside a frame works too.
  Add a Custom HTML block:

      <iframe src="https://culture-portal.horizonlinegroup.com/" title="Culture Portal"
        style="width:100%;height:1150px;border:0" loading="lazy"></iframe>

  WordPress.com only keeps iframes on plans that allow custom HTML (Business and above).
  On a lower plan, link a button to the address instead.

## 7. Check it

In test mode first, with a new test organization rather than a pilot.

- [ ] Signed out: the Horizon Line page, three tabs, and Forgot password inside Sign in.
      Both plans' prices show under Start a free trial.
- [ ] **Start a free trial.** You land in the portal as champion. Admin, Plan and billing
      says "Free trial of the unlimited plan", 30 days out, with no plan picked.
- [ ] **Keep this plan** on a plan, then **Add a payment method**. Use Stripe's test card
      `4242 4242 4242 4242`, any future date, any code, and a Colorado address. Back in
      Admin: card ending 4242, first charge the day after the trial.
- [ ] In Stripe, Billing, Subscriptions, the new subscription is trialing, with tax set
      to automatic.
- [ ] **Super admin** on that organization. Save an arrangement; the champion sees
      "arranged with Horizon Line".
- [ ] **Pilots.** Vail Daily and Mountain Vistage say "arranged with Horizon Line" through
      December 12, 2099. Everyone signs in as before, and their prices are unchanged.
- [ ] Admin tabs: About Us (logo upload, 5C switch, Our Systems), People, Plan and billing,
      Settings (refresh cadence).
- [ ] **Connection, What's Good** lists recognition, stories and Value awards together.
- [ ] Supabase, Integrations, Cron, the `billing-notices` job, **Run**. The run log shows
      today's date and a list, usually empty.
