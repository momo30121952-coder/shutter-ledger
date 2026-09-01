# Shutter Ledger — deployment steps

No coding, no VS Code. Five steps, all in browser dashboards.

## 1. Set up the database (Supabase)

1. Open your Supabase project.
2. Go to **SQL Editor** > **New query**.
3. Open `supabase-setup.sql` from this folder, copy everything, paste it in, click **Run**.
4. Go to **Storage** and confirm a bucket called `card-photos` now exists (the script creates it).

## 2. Get your Supabase keys

1. In Supabase, go to **Project Settings** > **API**.
2. Copy the **Project URL** and the **anon public** key. You'll need both in step 4.

## 3. Push this code to GitHub

1. Go to github.com, create a new empty repository (e.g. `shutter-ledger`).
2. On the repo page, click **uploading an existing file**.
3. Drag in every file and folder from this project folder, commit.

## 4. Deploy to Vercel

1. In Vercel, click **Add New > Project**, import the GitHub repo you just created.
2. Before deploying, expand **Environment Variables** and add:
   - `NEXT_PUBLIC_SUPABASE_URL` = the Project URL from step 2
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = the anon public key from step 2
3. Click **Deploy**. Vercel gives you a live URL when it's done.

## 5. Create your manager account

1. Open your new live URL.
2. Click **New staff account**, pick a username and password, pick any location (doesn't matter, you'll change it next).
3. Go back to Supabase **SQL Editor**, run:
   ```sql
   update profiles set role = 'manager', location = null where username = 'yourusername';
   ```
4. Sign out and sign back in on the site. You now have full manager access: Dashboard, Reports, Staff.

From here, add each photographer by having them sign up themselves at the site and pick their location — or you can do it for them. You (as manager) can reassign anyone's role or location any time from the **Staff** page in the app.

## A note on security

Staff accounts are self-serve: anyone with the link can create a "staff" account and pick a location. That's the simple tradeoff you asked for — it means no admin approval step, but also means the link itself is effectively the access control. Don't post it publicly.
