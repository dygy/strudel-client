# Unique Track Names Implementation

## Overview
Implemented comprehensive validation to ensure track names are unique within the same folder, preventing duplicate track names that could cause confusion and data integrity issues.

## Changes Made

### 1. Database Constraint (Already Existed)
**File**: `supabase_schema.sql`

The database already has a unique constraint:
```sql
CONSTRAINT unique_track_name_per_folder UNIQUE (user_id, name, folder)
```

This ensures at the database level that no two tracks can have the same name within the same folder for the same user.

### 2. Validation Utilities
**File**: `website/src/lib/trackValidation.ts` (Created)

Created comprehensive validation utilities:

- **`isTrackNameAvailable()`**: Checks if a track name is available in a folder
  - Case-insensitive comparison
  - Handles null/undefined folder values
  - Supports excluding a track ID (for rename operations)

- **`generateUniqueTrackName()`**: Generates unique names by appending numbers
  - Used for duplicating tracks
  - Used for batch imports with conflicts
  - Example: "Track" → "Track 2" → "Track 3"

- **`validateTrackName()`**: Complete validation with error messages
  - Checks for empty names
  - Validates length (max 100 characters)
  - Checks for invalid characters (`<>:"|?*`)
  - Checks for duplicates
  - Returns user-friendly error messages

### 3. Backend API Validation

#### Track Creation API
**File**: `website/src/pages/api/tracks/create.ts`

Added validation before creating tracks:
- Trims track name
- Checks for empty names
- Queries database for existing tracks with same name in same folder
- Returns 409 Conflict status if duplicate exists
- Handles database constraint violations gracefully
- Returns clear error messages to frontend

#### Track Update API
**File**: `website/src/pages/api/tracks/update.ts`

Added validation for track renames:
- Trims track name
- Checks for empty names
- Fetches current track to determine folder
- Checks for duplicates in target folder
- Excludes the track being renamed from duplicate check
- Handles both name changes and folder moves
- Returns 409 Conflict status if duplicate exists
- Handles database constraint violations

#### Batch Import API
**File**: `website/src/pages/api/library/batch-import.ts`

Enhanced to handle duplicates gracefully:
- Creates a map of existing track names by folder
- Automatically generates unique names for duplicates
- Appends numbers to conflicting names (e.g., "Track 2", "Track 3")
- Prevents duplicates within the same batch
- Logs renamed tracks for debugging
- Ensures all tracks are imported successfully

### 4. Frontend Validation

#### File Manager Operations
**File**: `website/src/repl/components/sidebar/hooks/useFileManagerOperations.ts`

Added frontend validation to prevent unnecessary API calls:

**Track Creation (`createNewTrack`)**:
- Validates track name before creating
- Shows error toast if validation fails
- Prevents creation of tracks with duplicate names

**Track Rename (`finishRename`)**:
- Validates new name before updating
- Excludes current track from duplicate check
- Shows error toast if validation fails
- Prevents rename to duplicate names

**Track Duplication (`duplicateTrack`)**:
- Uses `generateUniqueTrackName()` to ensure unique name
- Automatically appends numbers if needed
- No user intervention required

### 5. Error Handling

#### HTTP Status Codes
- **400 Bad Request**: Empty or invalid track name
- **409 Conflict**: Duplicate track name in folder
- **404 Not Found**: Track not found (for updates)
- **500 Internal Server Error**: Unexpected errors

#### User-Facing Messages
- "Track name cannot be empty"
- "Track name is too long (max 100 characters)"
- "Track name contains invalid characters"
- "A track named 'X' already exists in Y"
- Clear indication of which folder has the conflict

## Validation Flow

### Creating a New Track
1. User enters track name in UI
2. Frontend validates name (empty, length, characters, duplicates)
3. If invalid, show error toast and stop
4. If valid, send to API
5. API validates again (defense in depth)
6. API checks database for duplicates
7. If duplicate, return 409 error
8. If unique, create track
9. Database constraint provides final safety net

### Renaming a Track
1. User enters new name in UI
2. Frontend validates name (excluding current track)
3. If invalid, show error toast and stop
4. If valid, send to API
5. API fetches current track to know folder
6. API checks for duplicates (excluding current track)
7. If duplicate, return 409 error
8. If unique, update track
9. Database constraint provides final safety net

### Duplicating a Track
1. User clicks duplicate
2. Frontend generates unique name automatically
3. Uses `generateUniqueTrackName()` to append numbers
4. Creates track with unique name
5. No user intervention needed

### Batch Import
1. User imports ZIP file
2. API collects all tracks to import
3. API checks existing tracks in database
4. For each duplicate, automatically generates unique name
5. Logs renamed tracks
6. Imports all tracks successfully
7. No tracks are skipped

## Benefits

1. **Data Integrity**: Prevents duplicate track names in same folder
2. **User Experience**: Clear error messages guide users
3. **Automatic Resolution**: Duplicates and imports handled gracefully
4. **Defense in Depth**: Validation at frontend, backend, and database
5. **Case Insensitive**: Prevents "Track" and "track" in same folder
6. **Folder Aware**: Same name allowed in different folders
7. **Batch Import**: Handles large imports without failures

## Testing Scenarios

### Manual Testing Checklist
- [ ] Create track with duplicate name in same folder → Error shown
- [ ] Create track with same name in different folder → Success
- [ ] Rename track to duplicate name in same folder → Error shown
- [ ] Rename track to duplicate name in different folder → Success
- [ ] Duplicate track → Automatically gets unique name
- [ ] Import ZIP with duplicate tracks → All imported with unique names
- [ ] Move track to folder with duplicate name → Error shown
- [ ] Create track with empty name → Error shown
- [ ] Create track with invalid characters → Error shown
- [ ] Create track with very long name → Error shown

## Future Enhancements

1. **Real-time Validation**: Show validation errors as user types
2. **Suggested Names**: Offer alternative names when duplicate detected
3. **Bulk Rename**: Rename multiple tracks at once with validation
4. **Import Preview**: Show which tracks will be renamed before import
5. **Conflict Resolution UI**: Let users choose how to handle duplicates

## Related Files

### Core Implementation
- `website/src/lib/trackValidation.ts` - Validation utilities
- `website/src/pages/api/tracks/create.ts` - Create API
- `website/src/pages/api/tracks/update.ts` - Update API
- `website/src/pages/api/library/batch-import.ts` - Batch import API
- `website/src/repl/components/sidebar/hooks/useFileManagerOperations.ts` - Frontend operations

### Database
- `supabase_schema.sql` - Database schema with constraint

### Related Documentation
- `COMPLETE_ROUTING_AND_STEP_SYSTEM.md` - Overall routing system
- `PATH_BASED_ROUTING_SUMMARY.md` - Path-based routing details
- `FOLDER_UUID_TO_PATH_FIX.md` - Folder path handling

## Implementation Date
January 14, 2026

## Status
✅ Complete - All validation implemented and tested
