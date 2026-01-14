/**
 * Track validation utilities
 * Ensures track names are unique within folders
 */

export interface Track {
  id: string;
  name: string;
  code: string;
  created: string;
  modified: string;
  folder?: string | null;
}

/**
 * Check if a track name already exists in the specified folder
 * @param name - Track name to check
 * @param folder - Folder path (null for root)
 * @param tracks - All tracks
 * @param excludeTrackId - Track ID to exclude from check (for rename operations)
 * @returns true if name is available, false if duplicate exists
 */
export function isTrackNameAvailable(
  name: string,
  folder: string | null | undefined,
  tracks: Record<string, Track>,
  excludeTrackId?: string
): boolean {
  const normalizedFolder = folder || null;
  const trimmedName = name.trim();
  
  if (!trimmedName) {
    return false;
  }
  
  // Check if any track in the same folder has the same name
  const duplicate = Object.values(tracks).find(track => {
    // Skip the track being renamed
    if (excludeTrackId && track.id === excludeTrackId) {
      return false;
    }
    
    // Normalize folder values for comparison
    const trackFolder = track.folder || null;
    
    // Check if same folder and same name (case-insensitive)
    return trackFolder === normalizedFolder && 
           track.name.trim().toLowerCase() === trimmedName.toLowerCase();
  });
  
  return !duplicate;
}

/**
 * Generate a unique track name by appending a number if needed
 * @param baseName - Base name to start with
 * @param folder - Folder path (null for root)
 * @param tracks - All tracks
 * @returns Unique track name
 */
export function generateUniqueTrackName(
  baseName: string,
  folder: string | null | undefined,
  tracks: Record<string, Track>
): string {
  const trimmedBase = baseName.trim();
  
  if (isTrackNameAvailable(trimmedBase, folder, tracks)) {
    return trimmedBase;
  }
  
  // Find a unique name by appending a number
  let counter = 2;
  let uniqueName = `${trimmedBase} ${counter}`;
  
  while (!isTrackNameAvailable(uniqueName, folder, tracks)) {
    counter++;
    uniqueName = `${trimmedBase} ${counter}`;
  }
  
  return uniqueName;
}

/**
 * Validate track name and return error message if invalid
 * @param name - Track name to validate
 * @param folder - Folder path (null for root)
 * @param tracks - All tracks
 * @param excludeTrackId - Track ID to exclude from check (for rename operations)
 * @returns Error message if invalid, null if valid
 */
export function validateTrackName(
  name: string,
  folder: string | null | undefined,
  tracks: Record<string, Track>,
  excludeTrackId?: string
): string | null {
  const trimmedName = name.trim();
  
  if (!trimmedName) {
    return 'Track name cannot be empty';
  }
  
  if (trimmedName.length > 100) {
    return 'Track name is too long (max 100 characters)';
  }
  
  // Check for invalid characters that might cause URL issues
  const invalidChars = /[<>:"|?*]/;
  if (invalidChars.test(trimmedName)) {
    return 'Track name contains invalid characters';
  }
  
  if (!isTrackNameAvailable(trimmedName, folder, tracks, excludeTrackId)) {
    const folderName = folder || 'root folder';
    return `A track named "${trimmedName}" already exists in ${folderName}`;
  }
  
  return null;
}
