# Supabase Database Setup

## Quick Setup (5 minutes)

When you see the error `PGRST205: "Could not find the table 'public.tracks'"`, follow these steps:

### 1. Open Supabase Dashboard
- Go to: https://supabase.com/dashboard
- Sign in to your account
- Select your project: `qocgrtjcmmzmktkhacwt`

### 2. Open SQL Editor
- Click **"SQL Editor"** in the left sidebar
- Click **"New query"** button

### 3. Copy and Execute Schema
- Copy **ALL** the contents from `supabase_schema.sql` (in project root)
- Paste into the SQL editor
- Click **"Run"** button

### 4. Verify Tables Created
- Go to **"Table Editor"** in the left sidebar
- You should see these tables:
  - ✅ `profiles`
  - ✅ `tracks`
  - ✅ `folders`

### 5. Test Your Application
- Go back to your Strudel application
- Sign in with Google
- Try creating a track - it should work now!

## What This Creates

The schema creates:
- **Database tables** for storing tracks and folders
- **Security policies** so users can only see their own data
- **Automatic triggers** for user profile creation
- **Performance indexes** for fast queries

## Troubleshooting

### "Permission denied" errors
- This is normal! It means Row Level Security is working
- Users can only access their own data

### "Table already exists" errors
- This is fine! The schema uses `CREATE TABLE IF NOT EXISTS`
- Safe to run multiple times

### Still having issues?
- Check the browser console for detailed error messages
- Verify you're signed in to the correct Supabase project
- Make sure you copied the ENTIRE schema file

## One-Time Setup

This is a **one-time setup**. Once you run the schema:
- ✅ All users can sign in and use the application
- ✅ Data is automatically synced to the cloud
- ✅ Migration from localStorage works
- ✅ No more manual setup needed

The application will work perfectly for all users after this setup!