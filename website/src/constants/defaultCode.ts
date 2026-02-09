/**
 * Default code template for new Strudel tracks
 * This template provides a minimal starting point
 */
export const DEFAULT_TRACK_CODE = `// Start coding your pattern here
`;

/**
 * Helper function to check if code matches the default template
 * @param code - Code string to check
 * @returns boolean indicating if this is the default code
 */
export function isDefaultCode(code: string): boolean {
  return code.includes('/* ========== SETUP ========== */') && 
         code.includes('setcps(160/60/4)') && 
         code.includes('all(x => x.color("cyan"))');
}