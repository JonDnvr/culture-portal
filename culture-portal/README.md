# Culture Portal

A multi-organization culture portal: each organization publishes its purpose, values,
numbered behaviors, the systems that reinforce them, the rituals that carry them, and
the measurement that says whether any of it is holding.

It runs two ways from the same code. **Local mode** needs no server, no account and
no network: everything is stored in the browser. **Hosted mode** puts the same calls
against Supabase (Postgres, auth, storage, edge functions), with row level security
doing the enforcing. `src/lib/api.js` picks between them based on whether
`VITE_SUPABASE_URL` is set, and no view code changes either way.

The front end is Vite and React, so it also runs as-is in Bolt, StackBlitz, Vercel or
Netlify.

Production setup is in **DEPLOYMENT.md**, written for someone who has not used these tools before: every click, every command, and what you should see after each one.

## Three ways in

The sign-in page offers four things: signing in, starting a portal, asking to join one, and
recovering a password.

- **Create a new culture portal.** Organization name, the champion's name and email, and a
  password. It stands up the organization, makes that person its culture champion, and seeds
  three example values, three example behaviors, three system categories and the practice
  session. Everything seeded carries an Example tag until someone edits it, and Admin has a
  button to clear whatever is left. New portals start on the free tier, so adding people means
  choosing a plan.
- **Request access.** Name, email, organization and a password of their choosing. It lands in
  that organization's Admin as a tentative member, where an admin picks a role and presses
  "Make active". Until then the account cannot sign in: it has no membership, and every policy
  is written against membership.
- **Forgot password.** Hosted mode uses Supabase's own reset email. Local mode issues a six
  digit code, good once and for thirty minutes, shown on screen since there is no mail server.
  Both answer the same way whether or not the address has an account.

Anyone who gains access gets a welcome email: how to sign in, what each section is for, and
what the quick pulse will ask. In hosted mode it goes through Resend; in local mode it
collects in an outbox an admin can read from the Admin page, so the wording can be checked
without a mail server.

## Accounts and tenancy

A person signs in, belongs to **exactly one organization**, and sees only that
organization's data. Roles are assigned by an administrator; nobody chooses their own.

| Role | Can do |
|---|---|
| Member | Read everything, post recognition and stories, share a story, answer the pulse |
| Leader | The above, plus log rituals and see Conviction |
| Admin | The above, plus edit content, manage people, and choose the plan. Several people can hold it. |
| Culture champion | Admin rights, plus the one seat that survives a lapsed subscription. Exactly one per organization, enforced by a unique index. |
| Super user | Every organization: create organizations, create users at any role, edit any content |

The super user is `jon@horizonlinegroup.com`, recorded in `platform_admins` rather than
in any one organization, which is why it is the only account that gets an organization
switcher.

Seeded demonstration accounts, all with the password `Portal2026!`:

| Email | Organization | Role |
|---|---|---|
| chair@mountainvistage.com | Mountain Vistage CE Team | Culture champion |
| accountability@mountainvistage.com | Mountain Vistage CE Team | Leader |
| member@mountainvistage.com | Mountain Vistage CE Team | Member |
| editor@vaildaily.com | Vail Daily | Culture champion |
| desk@vaildaily.com | Vail Daily | Leader |
| reporter@vaildaily.com | Vail Daily | Member |

Sign in as the champion of either organization and you will see only that organization.
Sign in as the super user and the left rail gains an organization switcher, and Admin
gains an Organizations section for standing up a new client.

### A word on local-mode passwords

Local mode stores a salted SHA-256 hash rather than the password itself, which keeps
credentials out of the source, but a browser store cannot keep a secret from whoever is
at the keyboard, and every tenant's rows sit in the same store. **Local mode is for
demonstration only.** The real boundary is hosted mode, where Postgres row level
security enforces the same rules server-side and the app cannot bypass them.

Two follow-ups worth doing before this holds anyone's real data: change the super user
password, since it has been shared in a chat transcript, and set up hosted mode for
anything beyond a demo.

## Run it locally, right now

Fastest, no tooling at all:

    open dist-single/culture-portal.html

That file is the whole application inlined into one HTML document. Double-click it and
sign in with one of the accounts above. The super user can use "Reset demo data" in the
left rail to restore the seeded organizations, people and content.

With Node, for live editing:

    npm install
    npm run dev

Leave `.env` out entirely and the app stays in local mode. To rebuild the standalone
file after a change:

    npm run build:single

**Local mode limits.** Data lives in this one browser's localStorage, roughly 5 MB, so
attachments over 2 MB are recorded by name without their contents. Sharing a story
opens your own mail client with the message written, since there is no server to send
from. Pulse scores are sample values until a real cycle runs. Nothing is shared between
people, and the tenant separation is enforced by the app rather than by a server; that
is what hosted mode is for.

## Structure

```
dist-single/culture-portal.html  the whole app in one file, no server needed
supabase/
  schema.sql                     tables, views, row level security, storage bucket
  functions/share-story/         emails a story with signed attachment links
  functions/manage-users/        creates accounts and assigns roles
  functions/signup/              new portals and access requests, public
  functions/billing/             Stripe Checkout for the two paid tiers
  functions/stripe-webhook/      writes subscription state back to the org
scripts/
  seed.mjs                       loads an organization, and optionally its people
  seed-data.json                 Mountain Vistage CE Team and Vail Daily content
  seed-users.json                the accounts, without passwords
src/
  lib/api.js                     every query in one place
  views/                         Home, Clarity, Behavior, Cadence, Connection, Conviction, Admin
  components/ui.jsx              badge, modal, toast, pulse bar
  styles.css
```

## Hosted setup (Supabase)

1. **Create a Supabase project**, then open the SQL editor and run `supabase/schema.sql`.
   It creates the tables, the row level security policies, the `story-media` bucket and
   the five shared categories.

2. **Configure the app.**

   ```bash
   cp .env.example .env
   npm install
   ```

   Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Project settings, API.

3. **Seed the organizations and their people.** Add `SUPABASE_SERVICE_ROLE_KEY` to
   `.env` first; it is server-side only and must never reach the browser. Passwords come
   from the environment, not from a file in this repository.

   ```bash
   export SUPER_USER_PASSWORD='choose-a-new-one'
   export DEMO_USER_PASSWORD='choose-a-new-one'
   node scripts/seed.mjs mv --with-users     # Mountain Vistage CE Team
   node scripts/seed.mjs vd --with-users     # Vail Daily
   ```

   The account list is `scripts/seed-users.json`. The super user is created once and
   added to `platform_admins`; everyone else gets one membership row.

4. **Deploy the functions.**

   ```bash
   supabase functions deploy share-story
   supabase functions deploy manage-users
   supabase functions deploy signup --no-verify-jwt
   supabase secrets set RESEND_API_KEY=... STORY_FROM_EMAIL=culture@yourdomain.com PUBLIC_APP_URL=https://...
   ```

   `manage-users` creates accounts, which needs the admin API and therefore cannot run
   in a browser. It re-checks the caller's role with the caller's own token before the
   service role does anything. Resend is the email default; Postmark or SendGrid is a
   two-line change in `share-story`.

5. **Run it.**

   ```bash
   npm run dev
   ```

6. **Deploy it.** Cloudflare Pages is the intended host: build command `npm run build`,
   output directory `dist`, and the two `VITE_` variables in the project settings.
   `public/_redirects` and `public/_headers` ship with the repository and handle deep
   links, the content security policy and caching. Setting the two variables is also what
   switches the build from local mode to hosted mode, so there is no flag to forget.
   DEPLOYMENT.md walks through the whole thing.

## How tenancy is enforced in Postgres

- `memberships.user_id` is **unique**, so a person cannot hold two memberships.
- Every content and activity table carries `org_id`, and every policy is written
  against `is_member(org_id)`, `can_lead(org_id)` or `can_edit(org_id)`. A member of one
  organization cannot read another's rows even by calling the REST API directly.
- The policy helpers are `security definer` functions, so a membership check inside a
  policy does not recurse through RLS.
- A `before insert or update` trigger on `memberships` refuses any attempt to assign
  `owner` unless the caller is a platform admin, and refuses to let anyone change their
  own role. That holds for the edge function too, since it also goes through Postgres.
- Only a platform admin can insert an organization.
- Storage keys are `{org_id}/{story_id}/{filename}` and the bucket policies read the
  first path segment, so attachments are separated the same way rows are.

## Data model notes

- **Behaviors are numbered per organization** (`behaviors.number`, unique with `org_id`).
  The number is the reference people use out loud, so it is stored, not derived.
- **Values are per organization** and many-to-many with behaviors. Categories are the
  five shared ones and live in a global table.
- **System categories are per organization and admin-defined.** A `placement` joins a
  behavior to one system category and carries the owner, cadence, artifact and template.
  A behavior may appear once per system category.
- **Rituals are written once and shared.** `behavior_rituals` links them, so editing a
  practice updates it everywhere it is applied. This is the difference between a ritual
  and a placement template: the template belongs to one placement, the practice belongs
  to the ritual.
- **`behavior_coverage`** flags any behavior reinforced in fewer than two systems.
  **`behavior_pulse`** returns average and standard deviation per behavior; the spread
  is the diagnostic, since it shows people living in different versions of the same
  organization.

## Story attachments

Files upload to the private `story-media` bucket under `{org_id}/{story_id}/{filename}`.
The storage policies read the first path segment as the tenant, so a member of one
organization cannot read another's media. The app fetches short-lived signed URLs to
render images and video inline; the email function signs them for seven days.

Supabase caps uploads at 50 MB by default. For longer video, raise the limit in
Project settings, Storage, or hand off to a video host and store the URL.

## How the sections fit together

| Section | Holds |
|---|---|
| Culture home | Purpose, values, this week, and two handouts: the short one for the room, the full one for whoever is leading |
| Clarity | Every behavior, filtered by value, then category, then system |
| Cadence | This week's practice session, the rotation, the ritual library, the systems library |
| Connection | Recognition and stories, posted from a dialog, filtered by value or behavior |
| Conviction | Measures, summary ratings, detail scores, rhythm iterations, coverage |
| Admin | People, purpose, values, system categories, measures, recent window |

Behaviors and rituals are managed where they are used, in Cadence and on each behavior's
page, rather than in Admin.

### Iterations

Recording that a ritual was run is the unit that makes Conviction meaningful. An
iteration carries the ritual, the behaviors it covered, who recorded it, when it was
run, notes, and attachments. "Practice It" on the Rituals tab and on This Week both
write one. Recency and count on the Rhythm iterations tab read from them, and each
behavior's Recent column links to the full record.

### The pulse

Rather than a survey, each person is asked about a few behaviors when they sign in, framed
as an add-on above the page and dismissible for the session. How many appear is set in
Admin, one to five. The prompt asks how well the behavior drives the culture, on a five
point scale from Rarely to Exemplary, with the full rubric behind a link. The rotation
hands out the least-answered behaviors the person has not scored yet. Example content is
never rated, and a new portal is not asked anything until it has written a behavior of its
own. A round
closes once every behavior has been scored by a quarter of the organization, and the
next round opens. In hosted mode this lives in two Postgres functions, `pulse_status`
and `pulse_assignment`, so the rotation cannot be gamed from the browser.

## Billing

Three tiers. The free one is not a trial: it is the culture champion's own access, which
never lapses. An organization that stops paying keeps all of its content and its
champion, and everyone else is locked out until the subscription is current again.

| Tier | Seats | Set by |
|---|---|---|
| Champion only, free | 1, the champion | Automatic fallback |
| Up to 9 people | 9 | Chosen by the champion |
| Unlimited people | no cap | Chosen by the champion |

Rates are **per organization**, so a client can be quoted their own price. The super user
sets a monthly and a yearly rate for each paid tier in Admin, along with the paid-through
date. Whether payment is current is worked out from that date rather than toggled, so the
two can never disagree. Cancelling sets `cancel_at_period_end`: the subscription keeps
working until the paid-through date and then falls back to the free tier, and the super
user sees which plan and cycle each organization chose, and whether they have cancelled. The champion sees those rates in their own Admin and
picks a plan and a cycle.

Choosing a plan records the organization's choice; it does not move the paid-through date.
The change shows as pending on both sides until the super user records a payment, which
clears it and is written to the billing history. Cancelling and resuming work the same way:
they record intent, never a date. When Stripe is live, its webhook records the payment
instead of the super user.

Payment goes through Stripe Checkout in subscription mode, recurring until cancelled.
`supabase/functions/billing` creates the Checkout session with a price built from that
organization's rate, and `supabase/functions/stripe-webhook` writes the result back onto
the organization, so the app answers one cheap question: is this payment current?
Cancelling sets `cancel_at_period_end`, so the organization keeps what it paid for.

Seats are enforced in Postgres by a trigger on `memberships`, not only in the interface,
and sign-in checks the effective plan, so a lapsed organization cannot be worked around
from the browser.

**In local mode there is no Stripe.** Choosing a plan records the choice and leaves the
paid-through date alone, exactly as the hosted flow does before a payment clears. Everything else about the model,
including the seat caps and the champion-always-works rule, behaves as it will in hosted
mode.

```bash
supabase functions deploy billing
supabase functions deploy stripe-webhook --no-verify-jwt
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_...
```

## Who can change what

A culture champion has full editorial control of their own organization:

- **Purpose and identity** (name, subtitle, initials, accent, mission, vision, creed) from Admin
- **Values**: add, edit, delete. Behaviors attach to values from each behavior's edit form
- **Behaviors**: add from Cadence, Rotation; edit every field from the behavior page;
  reorder by dragging in the Rotation tab, which renumbers the list
- **Systems**: define the categories, apply them to behaviors, write and edit templates
- **Rituals**: create from the behavior page or from Cadence, assign to several behaviors
  at once, edit any of them. Editing a ritual changes it everywhere it is applied, which
  the behavior page says on screen when a ritual is shared. The weekly practice session
  is a ritual marked as applying to every behavior
- **Behavior of the week**, set in Admin
- **Measures**: defined in Admin. Recording a value for a period is separate, done from
  Conviction, so definitions stay stable while values accumulate
- **Settings** in Admin: what counts as recent, how many behaviors the quick pulse asks
  about per sign-in, and the highlight color, which can be changed at any time
- **People**: add, assign roles, reset passwords, remove

The super user does all of that in any organization, plus creating organizations and
assigning the super user role.

## What is not built yet

- Pulse cycle scheduling and the response form (the tables and the view exist)
- The weekly email, which wants a scheduled function on the same pattern as `share-story`
- Printable cards as PDF
- Reminders when a ritual has not been run within its own cadence
- Email invitations, so a new person sets their own password instead of being handed one
- Dunning emails when a payment fails
- Self-service password change from inside the app (the function exists in `api.js`)
- Cloning an organization's behavior set as a template for a new client
