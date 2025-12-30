/**
 * Default code template for new Strudel tracks
 * This template provides a complete example with drums, bass, and chords
 */
export const DEFAULT_TRACK_CODE = `/* ========== SETUP ========== */
setcps(160/60/4) // 160 BPM (2.666… cycles per second)

/* ========== DRUM SECTION ========== */
// Four‑on‑the‑floor kick with some drive and low‑pass
kick: s("bd*4").bank("RolandTR909").drive(2).lpf(2200).gain(0.85)

// Clap on the 2 and 4 for backbeat punch
clap: s("~ cp ~ cp").bank("RolandTR909").crush(12).room(0.2).gain(0.5)

// Closed hats: straight 16ths plus a quieter off‑beat shuffle
hats: stack(
  s("hh*16").bank("RolandTR909").dec(0.05).gain(0.25),
  s("~ hh ~ hh").bank("RolandTR909").dec(0.03).gain(0.15).pan(sine.range(-0.4, 0.4).slow(8))
).gain(1)

/* ========== BASS (DONK) ========== */
// Donk‑style bass in A major. Tweak note pattern to taste.
donk: note("<a1 g#1 a1 f#1> <e1 e1 d#1 e1>").sub(12).sound("z_sine").ftype("ladder").lpf(180).lpq(8).euclidRot(3,16,14).drive(3).distort("1.4:.65")

/* ========== STAB CHORDS ========== */
// A → F#m → D → E progression. Adjust timing/gain by ear.
stabs: chord("<A F#m D E>").dict("ireal").voicing().sound("square").gain("<0.1 0.15 0.1 0.15>").decay(0.3).room(0.5).delay(".18:.1:.26").gain("<0.1 0.15 0.1 0.15>")

/* ========== GLOBAL TOUCH ========== */
// Tint everything cyan (optional)
all(x => x.color("cyan"))`;

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