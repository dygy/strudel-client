# Increase Token Lifetime Configuration

## Why Increase Token Lifetime?

For a creative music tool like Strudel, users shouldn't need to re-authenticate multiple times per day. Banking-level security isn't necessary here - we want a smooth creative experience.

## Current Default Settings
- **Access Token**: 1 hour (3600 seconds)
- **Refresh Token**: 30 days (2592000 seconds)

## Recommended Settings for Strudel
- **Access Token**: 7 days (604800 seconds)
- **Refresh Token**: 90 days (7776000 seconds)

This means:
- Users stay logged in for a week without any token refresh
- Even if offline, they can work for up to 7 days
- Refresh token lasts 90 days, so they only need to re-login every 3 months

## How to Configure in Supabase Dashboard

### Step 1: Access Supabase Dashboard
1. Go to https://supabase.com/dashboard
2. Select your Strudel project
3. Navigate to **Authentication** → **Settings**

### Step 2: Update JWT Settings
Look for the **JWT Settings** section and update:

```
JWT expiry limit: 604800
```

This sets the access token to 7 days (604800 seconds).

### Step 3: Update Refresh Token Settings
Look for **Refresh Token Settings** and update:

```
Refresh Token Rotation Enabled: ✓ (keep enabled for security)
Refresh Token Reuse Interval: 10 (seconds)
Refresh Token Expiry: 7776000 (90 days)
```

### Step 4: Save Changes
Click **Save** at the bottom of the page.

## Alternative: Using Supabase CLI

If you prefer to configure via CLI or want to version control this:

1. Install Supabase CLI:
```bash
npm install -g supabase
```

2. Login to Supabase:
```bash
supabase login
```

3. Link your project:
```bash
supabase link --project-ref YOUR_PROJECT_REF
```

4. Update `supabase/config.toml`:
```toml
[auth]
# JWT expiry in seconds (7 days)
jwt_expiry = 604800

# Refresh token expiry in seconds (90 days)
refresh_token_rotation_enabled = true
refresh_token_reuse_interval = 10
security_refresh_token_reuse_interval = 10
```

5. Push changes:
```bash
supabase db push
```

## Benefits of Longer Token Lifetime

### For Users
- ✅ Stay logged in for a full week
- ✅ Work offline without authentication issues
- ✅ No interruptions during creative sessions
- ✅ Only need to re-login every 3 months

### For Developers
- ✅ Fewer authentication-related support issues
- ✅ Better user experience
- ✅ Less token refresh traffic
- ✅ Simpler debugging (fewer auth edge cases)

## Security Considerations

### Still Secure Because:
1. **HTTPS Only**: All traffic is encrypted
2. **PKCE Flow**: Using Proof Key for Code Exchange
3. **Refresh Token Rotation**: Tokens are rotated on use
4. **HttpOnly Cookies**: Tokens stored securely in browser
5. **User-Scoped Data**: RLS policies ensure users only access their own data

### What We're NOT Doing:
- ❌ Storing passwords in browser
- ❌ Disabling encryption
- ❌ Removing access controls
- ❌ Sharing tokens between users

### Risk Assessment:
- **Low Risk**: Music patterns aren't sensitive financial data
- **High Value**: Smooth creative experience is crucial
- **Mitigation**: Users can always sign out manually if needed

## Testing After Configuration

### 1. Test Long Session
```javascript
// In browser console after signing in
const { data: { session } } = await supabase.auth.getSession();
console.log('Token expires at:', new Date(session.expires_at * 1000));
console.log('Time until expiry:', (session.expires_at - Date.now()/1000) / 3600, 'hours');
```

Expected: Should show ~168 hours (7 days)

### 2. Test Offline Work
1. Sign in to Strudel
2. Disconnect from internet
3. Work on patterns for several hours
4. Reconnect
5. Verify autosave works without re-authentication

### 3. Test Refresh Token
1. Sign in
2. Wait 7+ days (or manually expire access token)
3. Make a change to trigger autosave
4. Verify token refreshes automatically
5. Check console for "Session refreshed successfully"

## Current Code Already Supports This

Your code in `website/src/lib/supabase.ts` already has:
```typescript
auth: {
  autoRefreshToken: true,  // ✅ Automatic refresh enabled
  persistSession: true,     // ✅ Session persists across page loads
  detectSessionInUrl: true, // ✅ Handles OAuth callbacks
  flowType: 'pkce',        // ✅ Secure PKCE flow
}
```

And in `website/src/lib/authUtils.ts`:
```typescript
// Refresh if expiring within 10 minutes
if (timeUntilExpiry < 600) {
  // Automatic refresh logic
}
```

So once you update the Supabase settings, everything will work automatically!

## Rollback Plan

If you need to revert to shorter tokens:

1. Go back to Supabase Dashboard → Authentication → Settings
2. Change JWT expiry back to 3600 (1 hour)
3. Change Refresh Token expiry back to 2592000 (30 days)
4. Save changes

Users will need to re-authenticate on their next session after the change.

## Monitoring

After making the change, monitor:
- User complaints about re-authentication (should decrease)
- Token refresh errors in logs (should decrease)
- Session duration analytics (should increase)

## Status
⏳ PENDING - Needs Supabase dashboard configuration
📝 Code already supports longer tokens
✅ No code changes required
