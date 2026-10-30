/**
 * How a multitrack is laid out in a ZIP (or a dropped folder): one `.js` file per step plus a
 * `metadata.json` whose `steps` list gives the step order and names. Shared by the export and the
 * three import paths so a round trip keeps every step with its own code, in order.
 */

export interface StepMeta {
  name?: unknown;
  created?: unknown;
  modified?: unknown;
}

/** The export rule for a step's file name: non-alphanumerics become '_'. */
const legacyStepFileName = (name: unknown) => `${String(name ?? '').replace(/[^a-zA-Z0-9]/g, '_')}.js`;

/**
 * The file each step is exported under, in step order. Two steps whose names map to the same file
 * ("A!" and "A?" are both `A_.js`) get "_2", "_3"…, or the ZIP would keep only one of them.
 */
export function stepFileNames(names: unknown[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base = legacyStepFileName(name).slice(0, -'.js'.length);
    let file = `${base}.js`;
    for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base}_${n}.js`;
    used.add(file.toLowerCase());
    return file;
  });
}

const basename = (path: string) => path.slice(path.lastIndexOf('/') + 1);
const naturalOrder = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Step files in step order, each with its metadata entry when it has one.
 *
 * A metadata step finds its file by the name the export gives it, so the order and the names come
 * from `metadata.json`, not from the file names' alphabetical order. Files no step claims follow in
 * natural order (`step_2` before `step_10`). When no step finds its file (hand-made ZIPs, step files
 * named `step_1.js`…), the metadata is paired with the files by position, in natural order.
 */
export function orderStepFiles(files: string[], steps?: unknown): Array<{ file: string; meta?: StepMeta }> {
  const metaSteps: StepMeta[] = Array.isArray(steps) ? steps.map((s) => (s && typeof s === 'object' ? s : {})) : [];
  const exact = new Map<string, string>();
  const folded = new Map<string, string>();
  for (const file of files) {
    const name = basename(file);
    if (!exact.has(name)) exact.set(name, file);
    if (!folded.has(name.toLowerCase())) folded.set(name.toLowerCase(), file);
  }
  const lookup = (name: string) => exact.get(name) ?? folded.get(name.toLowerCase());

  const used = new Set<string>();
  const claimed: Array<{ file: string; meta: StepMeta }> = [];
  const expected = stepFileNames(metaSteps.map((s) => s.name));
  metaSteps.forEach((meta, i) => {
    const file = [expected[i], legacyStepFileName(meta.name)].map(lookup).find((f) => f && !used.has(f));
    if (file) {
      used.add(file);
      claimed.push({ file, meta });
    }
  });

  const rest = files.filter((f) => !used.has(f)).sort(naturalOrder);
  if (!claimed.length) return rest.map((file, i) => ({ file, meta: metaSteps[i] }));
  return [...claimed, ...rest.map((file) => ({ file }))];
}

/**
 * Where a file that is not a step but sits in a multitrack's folder goes: next to the multitrack,
 * in that folder's parent (undefined = the root). A multitrack is a track, not a folder, so a
 * folder path through it would point at a folder that is never created.
 */
export function folderOutsideMultitracks(folder: string | undefined, multitracks: Set<string>): string | undefined {
  if (!folder) return undefined;
  const parts = folder.split('/');
  for (let i = 1; i <= parts.length; i++) {
    if (multitracks.has(parts.slice(0, i).join('/'))) return i > 1 ? parts.slice(0, i - 1).join('/') : undefined;
  }
  return folder;
}
