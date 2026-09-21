# Putting the Culture Portal online

This guide assumes you have never used any of these tools. Every step says where to click,
what to type, and what you should see afterwards. Nothing is skipped.

Set aside two to three hours for the first run. You can stop after any numbered part and
come back later; nothing breaks if you leave it half done, as long as you don't give
anyone the address yet.

---

## Before you start: the words used here

| Word | What it means in plain terms |
|---|---|
| **Terminal** (Mac) or **PowerShell** (Windows) | A window where you type commands instead of clicking |
| **Command** | A line of text you type into that window and press Enter |
| **Repository**, or repo | A folder of code stored online, usually on GitHub |
| **Supabase** | The service holding your database, sign-ins and uploaded files |
| **Cloudflare Pages** | The service that serves the web page to your members |
| **Edge function** | A small program that runs on Supabase's servers rather than in the browser. Five come with this app |
| **Environment variable** | A setting passed to a program as a name and a value, like `STRIPE_SECRET_KEY=sk_test_123` |
| **Key** | A long password-like string that lets one service talk to another |

Two keys matter, and mixing them up is the one mistake with real consequences:

- The **anon key** is meant to be public. It ends up inside the web page. That is fine and
  by design; the database rules are what protect the data.
- The **service role key** bypasses every security rule. It goes only into Supabase's own
  settings and into one file on your computer. It must never go into the website, an
  email, a chat window, or a public repository.

---

## Part 1. Get the code onto your computer

1. Download `culture-portal.zip`.
2. Double-click it to unzip. You get a folder called `culture-portal`.
3. Move that folder somewhere you can find again. **Documents** is fine. Avoid Downloads,
   since that gets cleared out.

Open the folder and look inside. You should see:

```
culture-portal/
  DEPLOYMENT.md          this guide
  README.md              what the app is and how it works
  env.example            a template for settings
  index.html
  package.json
  public/                the two Cloudflare files
  scripts/               the seeding script and its data
  src/                   the app itself
  supabase/              schema.sql and the five edge functions
  vite.config.js
```

The file you need first is `supabase/schema.sql`. Confirm it is there.

---

## Part 2. Install the tools

### 2.1 Install Node.js

Node runs the build and the seeding script.

1. Go to **nodejs.org**.
2. Download the **LTS** version, the one on the left. Do not take "Current".
3. Run the installer and accept every default.

### 2.2 Open a terminal

**On a Mac:** press `Cmd + Space`, type `Terminal`, press Enter. A window opens with a line
ending in `%` or `$`. That is the prompt.

**On Windows:** click Start, type `PowerShell`, click **Windows PowerShell**. A window
opens with a line ending in `>`.

### 2.3 Check Node installed

Type this and press Enter:

```bash
node --version
```

You should see something like `v20.11.1`. If you see "command not found" or "not
recognized", close the terminal, open a new one, and try again. Installers only take effect
in windows opened afterwards.

### 2.4 Move the terminal into your project folder

The terminal is always "in" some folder. It needs to be in `culture-portal`.

**The easy way, both platforms:** type `cd` then a space, then drag the `culture-portal`
folder from Finder or File Explorer onto the terminal window and let go. It pastes the path
for you. Press Enter.

```bash
cd /Users/jon/Documents/culture-portal       # Mac, yours will differ
cd C:\Users\jon\Documents\culture-portal     # Windows
```

Check you are in the right place:

```bash
ls        # Mac
dir       # Windows
```

You should see `package.json`, `src`, `supabase` and the rest. If not, you are in the wrong
folder; run `cd` again.

**From here on, every command in this guide is typed into that terminal window, in that
folder.** If you close it, open a new one and `cd` back in.

### 2.5 Install the app's dependencies

```bash
npm install
```

This downloads the libraries the app needs. One to three minutes, and it prints a lot of
text. Warnings are normal. It is done when the prompt comes back. A `node_modules` folder
appears; ignore it.

---

## Part 3. Create the Supabase project

### 3.1 Sign up

1. Go to **supabase.com**, click **Start your project**.
2. Sign in with GitHub or an email address. Either is fine.

### 3.2 Create the project

1. Click **New project**.
2. **Name**: `culture-portal`.
3. **Database Password**: click **Generate a password**, then **copy it somewhere safe**.
   You will rarely need it and it cannot be shown again.
4. **Region**: the one nearest your clients. For Colorado, `West US (North California)` or
   `East US (North Virginia)`.
5. Click **Create new project**.

It takes two or three minutes to build. Wait until the dashboard stops saying "Setting up
project".

### 3.3 Collect the values you will need

In the left sidebar click the **gear icon** at the bottom (Project Settings), then **API**.
Three things are on that page:

| On the page | Looks like | What it is for |
|---|---|---|
| **Project URL** | `https://abcdefgh.supabase.co` | Goes into the website settings |
| **anon public** key | a very long string starting `eyJ...` | Goes into the website settings |
| **service_role** key | another long string, behind a **Reveal** button | Stays on your computer only |

Open a blank note and paste all three in, labelled. You will use them four or five times.

While you are here, look at your browser's address bar:

```
https://supabase.com/dashboard/project/abcdefghijklmnop
                                       ^^^^^^^^^^^^^^^^
```

That last part is your **project ref**. Add it to the note.

---

## Part 4. Create the database tables

`schema.sql` is a text file of instructions that creates every table, rule and function the
app needs. You paste it into Supabase and press Run. That is all "running a schema" means.

1. In Supabase's left sidebar click **SQL Editor**.
2. Click **+ New query** at the top of that panel. A large empty text box appears.
3. Now open the file on your computer. **Mac:** open `culture-portal`, then `supabase`,
   right-click `schema.sql`, choose **Open With**, then **TextEdit**. **Windows:**
   right-click it, **Open with**, **Notepad**.
4. Click inside the file, press `Cmd + A` / `Ctrl + A` to select everything, then
   `Cmd + C` / `Ctrl + C` to copy.
5. Click into the empty query box in Supabase and press `Cmd + V` / `Ctrl + V`. It is
   around 700 lines, so expect to scroll.
6. Click the green **Run** button at the bottom right, or press `Cmd + Enter` /
   `Ctrl + Enter`.

**What success looks like:** a grey bar underneath saying **Success. No rows returned**.
That is correct for this kind of script; it is not an error.

**If you get a red error:**

| Error says | What happened | What to do |
|---|---|---|
| `relation "organizations" already exists` | You already ran it | Nothing. Skip ahead |
| `syntax error at or near ...` | Only part of the file pasted | Clear the box, re-copy the whole file, paste again |
| `permission denied` | Wrong place | Make sure you are in the SQL Editor of your own project |

### 4.1 Check it worked

Click **+ New query** again, paste this, and Run:

```sql
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;
```

You get about 25 rows back, and **every one must show `true`** in the `rowsecurity` column.
That column is what stops one client's data being visible to another. If any row says
`false`, stop and tell me which one before putting real data in.

### 4.2 Turn off email confirmation, for now

1. Left sidebar, **Authentication**, then **Providers**.
2. Click **Email**.
3. Turn **Confirm email** off. Click **Save**.

This lets an admin create someone's account and have them sign in straight away. Turn it
back on later if you would rather people verify their address first.

---

## Part 5. Install the Supabase command-line tool

The five edge functions cannot be uploaded through the website. They need a tool called the
Supabase CLI.

### 5.1 Install it

In your terminal, in the project folder:

```bash
npm install -g supabase
```

On a Mac, if that fails with "permission denied":

```bash
sudo npm install -g supabase
```

Type your Mac password when asked. Nothing appears as you type; that is normal. Press
Enter.

Check it:

```bash
supabase --version
```

You should see a version number like `2.x.x`.

### 5.2 Sign in

```bash
supabase login
```

Your browser opens and asks you to authorize. Click **Authorize**, then go back to the
terminal. It says `Finished supabase login`.

### 5.3 Connect this folder to your project

Use the project ref from step 3.3:

```bash
supabase link --project-ref abcdefghijklmnop
```

It asks for the database password you generated in 3.2. Paste it and press Enter; nothing
appears as you paste. Success reads `Finished supabase link`.

---

## Part 6. Upload the five edge functions

Type these one at a time, waiting for each to finish:

```bash
supabase functions deploy manage-users
supabase functions deploy share-story
supabase functions deploy billing
supabase functions deploy signup --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
```

Each takes 20 to 60 seconds and ends with `Deployed Function`. The last two carry
`--no-verify-jwt` because they are called by people who are not signed in yet, and by
Stripe. The other three refuse anyone without a valid sign-in.

| Function | Job |
|---|---|
| `signup` | Creates a new portal, and takes requests to join one |
| `manage-users` | Creates accounts, sets roles, approves requests |
| `share-story` | Emails a story with links to its attachments |
| `billing` | Sends someone to Stripe to pay |
| `stripe-webhook` | Listens for Stripe saying a payment happened |

Check them: left sidebar, **Edge Functions**. All five should be listed. Their secret
settings come in Part 8 and Part 9, once you have the keys.

---

## Part 7. Set up email

The app sends welcome emails and shared stories. Without this they silently do not send.

### 7.1 Create a Resend account

1. Go to **resend.com** and sign up.
2. Click **Domains**, then **Add Domain**.
3. Type the domain you send from, for example `horizonlinegroup.com`.

Resend shows three or four DNS records to add. This is the fiddly part and it is worth
doing properly: skip it and your welcome emails land in spam.

### 7.2 Add the DNS records

These go wherever your domain is managed: GoDaddy, Namecheap, Cloudflare, whoever you
bought it from.

1. Sign in there and find **DNS** or **DNS Records** for the domain.
2. For each row Resend shows, click **Add record** and copy across the **Type** (TXT, MX or
   CNAME), the **Name** and the **Value**. Copy and paste; do not retype.
3. Save.
4. Back in Resend, click **Verify DNS Records**. It takes a few minutes to an hour. Green
   ticks mean done.

### 7.3 Get the API key

1. In Resend, click **API Keys**, then **Create API Key**.
2. Name it `culture-portal`, permission **Sending access**.
3. Copy the key. It starts `re_` and is shown once. Put it in your note.

---

## Part 8. Give the functions their secrets

Back in the terminal, in the project folder. Replace the placeholder values with yours,
keeping the quotes exactly as shown:

```bash
supabase secrets set RESEND_API_KEY=re_your_key_here
supabase secrets set STORY_FROM_EMAIL="Culture Portal <culture@yourdomain.com>"
supabase secrets set PUBLIC_APP_URL=https://yourdomain.com
```

Each prints `Finished supabase secrets set`.

If you do not have the web address yet, put anything in for `PUBLIC_APP_URL` and come back
after Part 11.

You do **not** set the Supabase URL or keys here. Functions get those automatically.

---

## Part 9. Set up Stripe

**Skip this whole part if you are recording payments by hand for now.** The app works
without it: you enter a paid-through date in Admin and that grants access. Come back when
you want clients paying online.

### 9.1 Test mode first

1. Go to **stripe.com**, sign up, fill in the business details.
2. In the dashboard find the **Test mode** toggle at the top right and switch it **on**.
   Everything below happens in test mode. You move to live only once it works.

### 9.2 The secret key

1. **Developers**, then **API keys**.
2. Under **Secret key**, click **Reveal test key** and copy it. It starts `sk_test_`.

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_your_key_here
```

### 9.3 The webhook

A webhook is Stripe calling your app to say a payment happened.

1. **Developers**, then **Webhooks**, then **Add endpoint**.
2. **Endpoint URL**, built from your project ref:

   ```
   https://abcdefghijklmnop.supabase.co/functions/v1/stripe-webhook
   ```

3. Click **Select events** and tick these five:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Click **Add endpoint**.
5. On the page that follows find **Signing secret**, click **Reveal**, copy it. It starts
   `whsec_`.

```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_your_secret_here
```

**When you go live:** turn test mode off, take the live secret key, create the webhook
again in live mode, and set both secrets again. A live key with a test webhook secret fails
quietly, which is the most common mistake here.

---

## Part 10. Put the code on GitHub

Cloudflare builds the site from a repository, so the code has to be there. No command line
for this part.

1. Go to **github.com** and sign up if you have not.
2. Click the **+** at the top right, then **New repository**.
3. **Repository name**: `culture-portal`. Set it **Private**. Do not tick any of the
   "initialize" boxes. Click **Create repository**.
4. On the next screen click the link **uploading an existing file**.
5. Open your `culture-portal` folder. Select everything **except** `node_modules`, and drag
   the selection onto the browser window.
6. Wait for the uploads to finish, then click **Commit changes**.

`node_modules` is thousands of files and is rebuilt automatically; uploading it will hang
the browser.

---

## Part 11. Publish the site on Cloudflare Pages

### 11.1 Connect

1. Go to **cloudflare.com**, sign up, sign in.
2. Left sidebar, **Workers & Pages**.
3. **Create**, then the **Pages** tab, then **Connect to Git**.
4. Click **Connect GitHub**, authorize it, choose your `culture-portal` repository, and
   click **Begin setup**.

### 11.2 Build settings

Fill the form in exactly like this:

| Field | Value |
|---|---|
| Project name | `culture-portal` |
| Production branch | `main` |
| Framework preset | **Vite** |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | leave empty |

### 11.3 Environment variables

Still on that page, expand **Environment variables** and add two, from your note:

| Variable name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://abcdefgh.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | the long `eyJ...` anon key |

Add them to **Production**, and to **Preview** as well if the form offers it.

**The service role key does not go here.** Anything set here ends up inside the web page.

Setting these two is also what switches the app from storing data in the browser to using
your database. Without them you would publish a version where everyone's work vanishes when
they clear their cache.

### 11.4 Deploy

Click **Save and Deploy**. The first build takes two to four minutes; a log scrolls past and
ends with **Success**.

You now have an address like `https://culture-portal-abc.pages.dev`. Click it. You should
see the sign-in page with four tabs. Don't sign up yet.

### 11.5 Tell Supabase the address

Sign-in and password resets break without this.

1. Supabase, **Authentication**, **URL Configuration**.
2. **Site URL**: your Pages address.
3. **Redirect URLs**: add that same address.
4. **Save**.

Then match the function secret:

```bash
supabase secrets set PUBLIC_APP_URL=https://culture-portal-abc.pages.dev
```

### 11.6 Your own domain, optional

1. In the Pages project click **Custom domains**, then **Set up a custom domain**.
2. Type the address you want, such as `portal.horizonlinegroup.com`.
3. If the domain is already on Cloudflare, the DNS record is added for you. If not, it
   shows a CNAME to add wherever your DNS lives, the same way as 7.2.
4. Wait for the certificate, five to twenty minutes.
5. Then **redo 11.5** with the new address, adding both addresses to Redirect URLs. In that
   order, or sign-in breaks.

---

## Part 12. Create your own account and the first organizations

### 12.1 Make a settings file

The seeding script needs the service role key, which never goes near the website. It reads
it from a file called `.env` in the project folder.

1. In your terminal, in the project folder:

   ```bash
   cp env.example .env        # Mac
   copy env.example .env      # Windows
   ```

2. Open `.env` in TextEdit or Notepad. On a Mac, files starting with a dot are hidden in
   Finder; press `Cmd + Shift + .` to show them.
3. Fill in these four lines and leave the rest:

   ```
   SUPABASE_URL=https://abcdefgh.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
   SUPER_USER_PASSWORD=pick-a-strong-one
   DEMO_USER_PASSWORD=pick-another-one
   ```

4. Save and close.

`SUPER_USER_PASSWORD` becomes the password for your own account,
`jon@horizonlinegroup.com`. Choose a new one. Do not reuse a password that has been typed
into a chat window, a ticket or an email.

`.env` stays on your computer and is already excluded from GitHub.

### 12.2 Run the seeding script

```bash
node scripts/seed.mjs mv --with-users
node scripts/seed.mjs vd --with-users
```

The first loads Mountain Vistage: sixteen behaviors, thirteen rituals, the values, the
systems and the accounts. The second loads Vail Daily. Each prints a line per account and
ends with something like `Done: 16 behaviors, 13 rituals, 8 values.`

| If it says | It means | Fix |
|---|---|---|
| `Missing credentials` | `.env` is empty or in the wrong folder | It must sit next to `package.json` |
| `fetch failed` | `SUPABASE_URL` has a typo | No slash at the end |
| `Invalid API key` | The service role key is wrong | Re-copy it, use service_role not anon |

### 12.3 Sign in

Open your site and sign in as `jon@horizonlinegroup.com` with the password you chose. You
should get the organization chooser showing both organizations and their plans.

If you would rather seed nothing and just make yourself the super user, sign up through the
site once, then run this in the SQL Editor:

```sql
insert into platform_admins (user_id)
select id from auth.users where email = 'jon@horizonlinegroup.com';
```

---

## Part 13. Check everything before anyone else sees it

Work through this in order. Each line has caught a real problem at some point.

**The site**
- [ ] The sign-in page loads with four tabs.
- [ ] Open a behavior, then reload the page. It loads again rather than showing a 404.

**Keeping clients apart**
- [ ] Sign in as `editor@vaildaily.com` with the demo password. You see Vail Daily, no trace
      of Mountain Vistage, and no organization switcher.
- [ ] Sign in as `member@mountainvistage.com`. Conviction and Admin are missing from the
      left-hand menu.

**The three ways in**
- [ ] Choose **Create a new culture portal** and make a throwaway one. It signs you in and
      shows example content in gold.
- [ ] Choose **Request access**, ask to join Mountain Vistage, then sign in as its chair and
      approve it in Admin. The new person can then sign in.
- [ ] Choose **Forgot password** and reset one.

**Email**
- [ ] All three of those sent a message, and it arrived in the inbox rather than spam.

**Money**, if you set Stripe up
- [ ] Choosing a plan as a champion does **not** move the paid-through date.
- [ ] Recording a paid-through date as the super user does.
- [ ] Setting a past date locks members out while the culture champion still signs in.

**Files**
- [ ] Add a story with a photo and a short video. Both display.

When those pass, delete the throwaway organization from the super admin tab. The portal is
ready for a real client.

---

## Part 14. When something does not work

| What you see | What it usually is | The fix |
|---|---|---|
| `command not found: npm` | Node is not installed, or the terminal predates the install | Close the terminal, open a new one |
| `command not found: supabase` | The CLI install failed | Re-run it, with `sudo` on a Mac |
| A blank white page on the site | The build worked, the app crashed | Right-click the page, **Inspect**, **Console**, read the red line |
| "Invalid API key" on sign-in | The anon key in Cloudflare is wrong or truncated | Re-copy it from Supabase, then redeploy |
| Sign-in works locally, not on the site | The address is not in Supabase's redirect list | Part 11.5 |
| No emails at all | The Resend key or from-address is missing | Part 8, and check the domain verified |
| Emails land in spam | The DNS records are incomplete | Part 7.2, all records green |
| Stripe pays, nothing changes | The webhook secret does not match the mode | Part 9.3, redo it in the mode you are in |
| Everything 404s except the home page | `_redirects` did not ship | Confirm `public/_redirects` is in GitHub |

**Reading the function logs**, which is where email and Stripe problems show up: Supabase,
**Edge Functions**, click the function, then the **Logs** tab. Each call is a line; click one
to see what it did and what failed.

---

## Part 15. Living with it

**Changing the app.** Edit the files, upload the changed ones to GitHub the same way as
Part 10, and Cloudflare rebuilds within a couple of minutes by itself.

**Changing the database.** Do not re-run `schema.sql` once you have real data; it is for
creating the database from nothing. Changes go through migration files instead. Ask me when
you get there.

**Backups.** Supabase, **Database**, **Backups**. Daily backups are automatic on paid plans.
Take a manual one before any database change, and test a restore once into a scratch
project, because a backup nobody has restored is only a hope.

**What it costs.** Cloudflare Pages is free at this scale. Supabase is free up to roughly
500 MB of database and 1 GB of files, then $25 a month. Resend is free for about 3,000
emails a month. Stripe takes a percentage of what you collect and nothing otherwise.

**What is still done by hand.** Payments are recorded by you until Stripe is live. The
weekly behavior email is not built. The behavior of the week advances on its own only when
an organization turns that toggle on in Admin.
