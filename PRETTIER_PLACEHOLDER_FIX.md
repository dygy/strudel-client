# Prettier Placeholder Bug Fix

## Problem
When formatting Strudel code with Prettier (Cmd-Q/Ctrl-Q), the track would be "killed" after save. The formatted code contained placeholder strings like `XSTRINGPLACEHOLDERX` instead of the actual string content.

## Root Cause
The `formatStrudelCode` function in `formatEngine.ts` was using a two-stage string protection mechanism:

1. **Global placeholders**: Replaced strings with `XSTRINGPLACEHOLDERX${char}XSTRINGPLACEHOLDERX` before preprocessing
2. **Local placeholders**: Replaced strings with `__STRING_${index}__` during line formatting

The issue was that:
- Global placeholders used character codes (A, B, C...) which limited to 26 strings
- The restoration logic was incomplete and could fail silently
- If autosave triggered before restoration completed, it would save code with placeholders
- The placeholders would break the Strudel code syntax, causing the track to fail

## Solution
Replaced the placeholder system with a more robust approach:

### Changes Made

1. **Better Global Placeholders**
   - Changed from `XSTRINGPLACEHOLDERX${char}XSTRINGPLACEHOLDERX` to `__STRUDEL_STRING_${index}_PLACEHOLDER__`
   - Uses numeric indices instead of character codes (no 26-string limit)
   - More unique and less likely to conflict with actual code

2. **Better Local Placeholders**
   - Changed from `__STRING_${index}__` to `__LOCAL_STRING_${index}__`
   - Clearer naming to distinguish from global placeholders

3. **Improved Restoration**
   - Global strings restored immediately after preprocessing using regex replace
   - Local strings restored immediately after line formatting using regex replace
   - Added final verification to detect any remaining placeholders
   - Returns original code if restoration fails (fail-safe)

4. **Synchronous Processing**
   - All string restoration happens synchronously before returning
   - No async gaps where autosave could trigger with incomplete code

## Files Modified
- `website/src/repl/formatEngine.ts` - Fixed `formatStrudelCode` method

## Testing
To verify the fix:
1. Open a track with many strings (URLs, text, etc.)
2. Press Cmd-Q (Mac) or Ctrl-Q (Windows/Linux) to format
3. Save the track (Cmd-S or auto-save)
4. Verify the track still plays correctly
5. Check that no placeholder strings appear in the saved code

## Impact
- Fixes the "track killed after format" bug
- Improves reliability of Prettier formatting for Strudel code
- Maintains all existing formatting behavior
- No breaking changes to the API
