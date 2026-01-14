/**
 * Default code template for new Strudel tracks
 * This template provides a simple working example
 */
export const DEFAULT_TRACK_CODE = `// Welcome to Strudel!
// Press play to hear this pattern

stack(
  s("bd*4").gain(0.8),
  s("~ cp ~ cp").gain(0.6),
  s("hh*8").gain(0.4)
).cpm(120)`;

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