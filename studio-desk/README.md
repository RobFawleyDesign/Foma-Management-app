# Studio Desk — going live

This is your studio manager as a real website: email/password login, a Supabase
database, and live sync so you and your partner always see the same up-to-date data.

You'll do this once. Two free accounts, a few copy-pastes. Budget ~30 minutes.
No coding required — just follow the steps in order.

There are three parts:
  A. Set up the database (Supabase)
  B. Run it on your own computer to check it works
  C. Put it on the internet (Vercel)

---

## A. Database — Supabase (the shared data + logins)

1. Go to https://supabase.com and sign up (free). Click **New project**.
   - Give it a name (e.g. "studio-desk"), set a database password (save it somewhere),
     pick the region closest to you, and create it. Wait ~2 minutes for it to finish.

2. In the left sidebar open **SQL Editor** → **New query**. Open the file
   `supabase-setup.sql` from this folder, copy ALL of it, paste it in, and click **Run**.
   You should see "Success". This creates the shared table, locks it to logged-in
   users only, and turns on live sync.

3. Get your two keys. Left sidebar → **Project Settings** (gear) → **API**.
   Copy these two values — you'll need them twice:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (a long string; the one labelled "anon" / "public",
     NOT the "service_role" one — never share service_role)

4. Create your two logins. Left sidebar → **Authentication** → **Users** → **Add user**
   → **Create new user**. Make one for you and one for your partner (email + password).
   Tick "Auto Confirm User" so you can sign in immediately.
   - Optional but recommended for privacy: **Authentication → Providers → Email** and
     turn **"Allow new users to sign up"** OFF once both accounts exist. That way the
     public site can't be joined by anyone else, even though it's on the internet.

---

## B. Run it locally first (optional but smart — proves it works before going public)

You need Node.js installed (https://nodejs.org, the "LTS" version).

1. Open a terminal in this folder.
2. Copy the env template:  `cp .env.example .env`   (on Windows: `copy .env.example .env`)
3. Open `.env` in any text editor and paste your two values from step A.3:
   ```
   VITE_SUPABASE_URL=https://abcd1234.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-public-key
   ```
4. Install and run:
   ```
   npm install
   npm run dev
   ```
5. Open the link it prints (usually http://localhost:5173). Sign in with one of the
   accounts you made. Add a residency. Open the same URL in a second browser window,
   sign in as the other account — you should see the same data, updating live.

If that works, you're ready to go public.

---

## C. Put it online — Vercel (the public URL)

1. Put the code on GitHub (Vercel deploys from there):
   - Make a free account at https://github.com and create a **new repository** (private is fine).
   - Upload this whole folder to it. Easiest no-terminal way: on the new repo page use
     **"uploading an existing file"** and drag everything in EXCEPT the `node_modules`
     folder and your `.env` file (those must not be uploaded — `.gitignore` already
     excludes them if you use git).

2. Go to https://vercel.com and sign up with your GitHub account (free).
   - Click **Add New → Project**, pick your repo, click **Import**.
   - Vercel auto-detects Vite. Before deploying, open **Environment Variables** and add
     the SAME two values from step A.3:
       - `VITE_SUPABASE_URL`  =  your project URL
       - `VITE_SUPABASE_ANON_KEY`  =  your anon public key
   - Click **Deploy**. After ~1 minute you'll get a live URL like
     `https://studio-desk.vercel.app`.

3. Tell Supabase to trust that URL. Back in Supabase → **Authentication → URL
   Configuration**, set **Site URL** to your Vercel URL, and add it under
   **Redirect URLs** too. Save.

4. Done. Send the Vercel URL to your partner. You both sign in with the accounts you
   created, and everything stays in sync.

---

## Everyday use
- Whenever you change the code and push to GitHub, Vercel redeploys automatically.
- Your data lives in Supabase (Table Editor → `studio` → the `main` row is the whole
  studio as JSON). It's backed up with your Supabase project.

## If something's off
- **"Missing Supabase config" in the browser console** → your env vars aren't set.
  Locally: check `.env`. On Vercel: check the Environment Variables, then redeploy.
- **Can sign in but see no data / can't save** → re-run `supabase-setup.sql` (the RLS
  policies are what allow logged-in users to read and write).
- **Login says "Invalid credentials"** → the account isn't created/confirmed yet;
  make it under Authentication → Users with "Auto Confirm User" ticked.
- **Changes don't appear live for the other person** → make sure the last line of
  `supabase-setup.sql` (the `alter publication ... add table public.studio`) ran without
  error; that's what enables realtime.

## A note on privacy
Any signed-in user can read and write the shared studio row — which is exactly what you
want for a two-person studio. Keep sign-ups turned off (step A.4) so only the accounts
you created can get in. Never put the `service_role` key in this app or on the site;
only the `anon` key belongs here.
