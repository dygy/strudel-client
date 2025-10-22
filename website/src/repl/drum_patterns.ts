// Type definition for drum patterns
export type DrumPattern = string;

export const Afro1a: DrumPattern = `// made by using the patterns from https://github.com/lvm/tidal-drum-patterns
// (licensed under GPL-3.0 license)
// using the R script from this repository: https://github.com/urswilke/read_beats
stack(
  "[bd ~ ~ ~] [~ ~ ~ ~] [bd ~ ~ ~] [~ ~ ~ ~] ",
  "[hh ~ hh hh] [hh ~ hh ~] [hh ~ hh ~] [hh ~ hh ~] ",
  "[~ ~ ~ ~] [~ ~ rim ~] [~ ~ rim ~] [~ ~ rim ~] ",
).s().slow(2)
`;

export const Afro1b: DrumPattern = `// made by using the patterns from https://github.com/lvm/tidal-drum-patterns
// (licensed under GPL-3.0 license)
// using the R script from this repository: https://github.com/urswilke/read_beats
stack(
  "[bd ~ ~ ~] [~ ~ ~ ~] [bd ~ bd ~] [~ ~ bd ~] ",
  "[hh ~ hh hh] [hh ~ hh ~] [hh ~ hh ~] [hh ~ hh ~] ",
  "[~ ~ ~ ~] [~ ~ rim ~] [~ ~ ~ ~] [rim ~ ~ ~] ",
).s().slow(2)
`;

export const Afro1c: DrumPattern = `// made by using the patterns from https://github.com/lvm/tidal-drum-patterns
// (licensed under GPL-3.0 license)
// using the R script from this repository: https://github.com/urswilke/read_beats
stack(
  "[~ ~ ~ ~] [ac ~ ~ ~] [~ ~ ~ ~] [ac ~ ~ ac] ",
  "[bd ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] ",
  "[hh ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] ",
  "[~ ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] [lt lt lt lt] ",
  "[~ ~ ~ ~] [~ ~ mt mt] [mt mt mt ~] [~ ~ ~ ~] ",
  "[~ sd sd sd] [sd ~ ~ ~] [~ ~ ~ ~] [~ ~ ~ ~] ",
).s().slow(2)
`;
export const Amen: DrumPattern = `// made by using the patterns from https://github.com/lvm/tidal-drum-patterns
// (licensed under GPL-3.0 license)
// using the R script from this repository: https://github.com/urswilke/read_beats
stack(
  "[bd ~ bd ~] [~ ~ ~ ~] [~ ~ bd bd] [~ ~ ~ ~] ",
  "[~ ~ ~ ~] [sd ~ ~ sd] [~ sd ~ ~] [sd ~ ~ sd] ",
  "[hh ~ hh ~] [hh ~ hh ~] [hh ~ hh ~] [hh ~ hh ~] ",
  "[~ ~ ~ ~] [~ ~ ~ ~] [~ ~ oh ~] [~ ~ ~ ~] ",
).s().slow(2)
`;

export const BillyJean: DrumPattern = `// made by using the patterns from https://github.com/lvm/tidal-drum-patterns
// (licensed under GPL-3.0 license)
// using the R script from this repository: https://github.com/urswilke/read_beats
stack(
  "[bd ~ ~ ~] [~ ~ ~ ~] [bd ~ ~ ~] [~ ~ ~ ~] ",
  "[~ ~ ~ ~] [sd ~ ~ ~] [~ ~ ~ ~] [sd ~ ~ ~] ",
  "[hh ~ hh ~] [hh ~ hh ~] [hh ~ hh ~] [hh ~ hh ~] ",
).s().slow(2)
`;

export const BootsNCats: DrumPattern = `// made by using the patterns from https://github.com/lvm/tidal-drum-patterns
// (licensed under GPL-3.0 license)
// using the R script from this repository: https://github.com/urswilke/read_beats
stack(
  "[bd ~ ~ ~] [~ ~ ~ ~] [bd ~ ~ ~] [~ ~ ~ ~]",
  "[~ ~ ~ ~]  [sd ~ ~ ~] [~ ~ ~ ~] [sd ~ ~ ~]",
  "[hh ~ hh ~] [hh ~ hh ~] [hh ~ hh ~] [hh ~ hh ~]",
).s().slow(2)
`;

export const Breakbeat1: DrumPattern = `// made by using the patterns from https://github.com/lvm/tidal-drum-patterns
// (licensed under GPL-3.0 license)
// using the R script from this repository: https://github.com/urswilke/read_beats
stack(
  "[bd ~ ~ ~] [~ ~ ~ ~] [~ ~ bd ~] [~ ~ ~ ~]",
  "[~ ~ ~ ~] [sd ~ ~ ~] [~ ~ ~ ~] [sd ~ ~ ~]",
).s().slow(2)
`;

export const Breakbeat2: DrumPattern = `// made by using the patterns from https://github.com/lvm/tidal-drum-patterns
// (licensed under GPL-3.0 license)
// using the R script from this repository: https://github.com/urswilke/read_beats
stack(
  "[bd ~ bd ~] [~ ~ ~ ~] [~ ~ bd ~] [~ ~ ~ ~]",
  "[~ ~ ~ ~] [sd ~ ~ ~] [~ ~ ~ ~] [sd ~ ~ ~]",
).s().slow(2)
`;

export const Breakbeat3: DrumPattern = `// made by using the patterns from https://github.com/lvm/tidal-drum-patterns
// (licensed under GPL-3.0 license)
// using the R script from this repository: https://github.com/urswilke/read_beats
stack(
  "[bd ~ bd ~] [~ ~ bd ~] [~ ~ bd ~] [~ ~ ~ ~]",
  "[~ ~ ~ ~] [sd ~ ~ bd] [~ sd ~ ~] [sd ~ ~ ~]",
).s().slow(2)
`;

// Note: This file contains a subset of the original drum patterns.
// The full collection contains hundreds of patterns and would be very large.
// Additional patterns can be added as needed following the same TypeScript structure.