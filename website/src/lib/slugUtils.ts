/**
 * Utilities for converting track names and folder paths to URL-safe slugs and back
 */

/**
 * Convert a track name to a URL-safe slug
 */
export function trackNameToSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    // Replace spaces and special characters with hyphens
    .replace(/[^a-z0-9]+/g, '-')
    // Remove leading/trailing hyphens
    .replace(/^-+|-+$/g, '')
    // Collapse multiple hyphens
    .replace(/-+/g, '-')
    // Ensure it's not empty
    || 'untitled';
}

/**
 * Convert a folder path to URL-safe segments
 */
export function folderPathToSlug(folderPath: string | null | undefined): string {
  if (!folderPath) return '';

  return folderPath
    .split('/')
    .map(segment => trackNameToSlug(segment))
    .filter(segment => segment && segment !== 'untitled')
    .join('/');
}

/**
 * Generate full URL path for a track including folder structure
 * Format: /repl/folder1/folder2/track-name or /repl/track-name for root tracks
 *
 * IMPORTANT: Handles both folder paths (new) and folder IDs (legacy)
 * If folderPathOrId is a UUID, it will be converted to a path using the folders map
 */
export function generateTrackUrlPath(
  trackName: string,
  folderPathOrId?: string | null,
  foldersMap?: Record<string, { id: string; path: string; name: string }>
): string {
  const trackSlug = trackNameToSlug(trackName);

  // If no folder, return root track URL
  if (!folderPathOrId || folderPathOrId === 'root') {
    return `/repl/${trackSlug}`;
  }

  // Check if folderPathOrId is a UUID (legacy format)
  // UUIDs are typically 21 characters with alphanumeric and hyphens/underscores
  const isUuid = /^[a-zA-Z0-9_-]{20,22}$/.test(folderPathOrId);

  let folderPath = folderPathOrId;

  // If it's a UUID and we have a folders map, convert to path
  if (isUuid && foldersMap && foldersMap[folderPathOrId]) {
    folderPath = foldersMap[folderPathOrId].path;
    console.log('generateTrackUrlPath - converted folder UUID to path:', folderPathOrId, '->', folderPath);
  }

  const folderSlug = folderPathToSlug(folderPath);

  if (folderSlug) {
    return `/repl/${folderSlug}/${trackSlug}`;
  } else {
    return `/repl/${trackSlug}`;
  }
}

/**
 * Parse URL path to extract folder path and track name
 * Input: /repl/folder1/folder2/track-name or /repl/folder1/folder2/track-name?step=1
 * Output: { folderPath: 'folder1/folder2', trackSlug: 'track-name' }
 */
export function parseTrackUrlPath(urlPath: string): { folderPath: string | null; trackSlug: string } | null {
  // Strip query parameters if present
  const pathWithoutQuery = urlPath.split('?')[0];

  // Match pattern: /repl/...segments.../track-name
  const match = pathWithoutQuery.match(/^\/repl\/(.+)$/);
  if (!match) return null;

  const segments = match[1].split('/');
  const trackSlug = segments.pop(); // Last segment is always the track
  const folderPath = segments.length > 0 ? segments.join('/') : null;

  return {
    folderPath,
    trackSlug: trackSlug || ''
  };
}

/**
 * Extract step parameter from URL
 * Input: /repl/track-name?step=step-name or /repl/track-name?step=2 (legacy)
 * Output: step name string (or null if no step parameter)
 */
export function extractStepFromUrl(urlPath: string): string | null {
  const url = new URL(urlPath, 'http://localhost'); // Need base URL for URL constructor
  const stepParam = url.searchParams.get('step');

  return stepParam || null;
}

/**
 * Find step index by step name in a track
 * Returns the step index, or null if not found
 */
export function findStepIndexByName(track: { steps?: Array<{ name: string }> }, stepName: string): number | null {
  if (!track.steps || track.steps.length === 0) return null;

  const index = track.steps.findIndex(step =>
    trackNameToSlug(step.name) === trackNameToSlug(stepName)
  );

  return index >= 0 ? index : null;
}

/**
 * Get step name slug for URL
 */
export function getStepSlug(stepName: string): string {
  return trackNameToSlug(stepName);
}

/**
 * Convert a URL slug back to a track name (for display)
 * This is a best-effort conversion since the original name might have been modified
 */
export function slugToDisplayName(slug: string): string {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

/**
 * Find a track by folder path and track slug
 */
export function findTrackByFolderAndSlug(
  tracks: Array<{id: string, name: string, folder?: string | null}>,
  folderPath: string | null,
  trackSlug: string
): {id: string, name: string, folder?: string | null} | null {
  console.log('findTrackByFolderAndSlug: Looking for track:', { folderPath, trackSlug });

  const candidates = tracks.filter(track => {
    const trackMatches = trackNameToSlug(track.name) === trackSlug;
    const folderMatches = (track.folder || null) === folderPath;

    return trackMatches && folderMatches;
  });

  if (candidates.length === 1) {
    return candidates[0];
  } else if (candidates.length > 1) {
    console.warn('findTrackByFolderAndSlug: Multiple matches found, returning first:', candidates.map(t => t.name));
    return candidates[0];
  }

  console.log('findTrackByFolderAndSlug: No match found');
  return null;
}

/**
 * Find a track by slug (legacy function for backward compatibility)
 */
export function findTrackBySlug(tracks: Array<{id: string, name: string}>, slug: string): {id: string, name: string} | null {
  console.log('findTrackBySlug: Looking for slug:', slug);
  console.log('findTrackBySlug: Available tracks:', tracks.map(t => ({
    name: t.name,
    slug: trackNameToSlug(t.name),
    matches: trackNameToSlug(t.name) === slug
  })));

  // First, try exact slug match
  const exactMatch = tracks.find(track => {
    const trackSlug = trackNameToSlug(track.name);
    const matches = trackSlug === slug;
    console.log(`findTrackBySlug: Comparing "${trackSlug}" === "${slug}" = ${matches}`);
    return matches;
  });

  if (exactMatch) {
    console.log('findTrackBySlug: Found exact match:', exactMatch.name);
    return exactMatch;
  }

  console.log('findTrackBySlug: No exact match found for slug:', slug);
  return null;
}

/**
 * Generate a unique slug for a track name, handling conflicts within the same folder
 */
export function generateUniqueSlug(
  name: string,
  existingTracks: Array<{id: string, name: string, folder?: string | null}>,
  folderPath: string | null = null,
  excludeTrackId?: string
): string {
  const baseSlug = trackNameToSlug(name);

  // Get existing slugs in the same folder
  const existingSlugs = existingTracks
    .filter(track =>
      track.id !== excludeTrackId &&
      (track.folder || null) === folderPath
    )
    .map(track => trackNameToSlug(track.name));

  if (!existingSlugs.includes(baseSlug)) {
    return baseSlug;
  }

  // If slug exists in the same folder, add a number suffix
  let counter = 2;
  let uniqueSlug = `${baseSlug}-${counter}`;

  while (existingSlugs.includes(uniqueSlug)) {
    counter++;
    uniqueSlug = `${baseSlug}-${counter}`;
  }

  return uniqueSlug;
}
