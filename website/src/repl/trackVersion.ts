/**
 * What this tab knows about each track's version on the server (spec 018, tech 2.6): the version
 * and the content it last synced with, and the saves it has in flight.
 *
 * A version is an opaque string (the row's `updated_at`, with microseconds): compare it, send it
 * back, never parse it. Content is `code` and `steps`, so a folder move or a rename, which bumps
 * the version and nothing else, is not a conflict.
 */

export interface ServerTrack {
  version: string;
  code: string;
  steps: unknown[];
  name?: string;
  folder?: string | null;
  isMultitrack?: boolean;
  activeStep?: number;
}

type Row = Record<string, unknown>;

/** A row in any of the shapes the app has: the database's, or the API's camelCase one. */
export function serverTrackFromRow(row: unknown): ServerTrack | null {
  if (!row || typeof row !== 'object') return null;
  const r = row as Row;
  const version = r.version ?? r.updated_at;
  if (typeof version !== 'string' || !version) return null;
  const activeStep = r.activeStep ?? r.active_step;
  return {
    version,
    code: typeof r.code === 'string' ? r.code : '',
    steps: Array.isArray(r.steps) ? r.steps : [],
    name: typeof r.name === 'string' ? r.name : undefined,
    folder: typeof r.folder === 'string' ? r.folder : null,
    isMultitrack: Boolean(r.isMultitrack ?? r.is_multitrack),
    activeStep: typeof activeStep === 'number' ? activeStep : 0,
  };
}

/** What a step holds that a person would call its content. Timestamps inside a step are not. */
function stepContent(steps: unknown[]): string {
  return JSON.stringify(
    steps.map((step) => {
      const s = (step ?? {}) as Row;
      return [s.id ?? null, s.name ?? null, s.code ?? null];
    }),
  );
}

export function sameContent(a: Pick<ServerTrack, 'code' | 'steps'>, b: Pick<ServerTrack, 'code' | 'steps'>): boolean {
  return a.code === b.code && stepContent(a.steps) === stepContent(b.steps);
}

/** The server moved on and its content differs. `current` is null when the save never left the tab. */
export class VersionConflictError extends Error {
  constructor(
    readonly trackId: string,
    readonly current: ServerTrack | null,
  ) {
    super('This track changed since you read it');
    this.name = 'VersionConflictError';
  }
}

export function createTrackVersions() {
  const baselines = new Map<string, ServerTrack>();
  const queues = new Map<string, Promise<unknown>>();
  const inFlight = new Map<string, number>();
  const generations = new Map<string, number>();
  const paused = new Set<string>();
  let openTrackId: string | null = null;
  let bulkOperations = 0;
  let bulkGeneration = 0;

  const bump = (id: string) => generations.set(id, (generations.get(id) ?? 0) + 1);

  const versions = {
    get: (id: string) => baselines.get(id),
    set(id: string, track: ServerTrack) {
      baselines.set(id, track);
    },
    forget(id: string) {
      baselines.delete(id);
      paused.delete(id);
    },

    /** The track in the editor. Its baseline only moves through a save or a content check. */
    setOpenTrack(id: string | null) {
      openTrackId = id;
    },
    get openTrackId() {
      return openTrackId;
    },

    /**
     * Rows just loaded from the server. The open track is skipped: the editor still holds what it
     * held, so its baseline must keep saying so, or a change elsewhere would go unnoticed.
     */
    seed(rows: unknown[]) {
      for (const row of rows) {
        const track = serverTrackFromRow(row);
        const id = (row as Row | null)?.id;
        if (track && typeof id === 'string' && (id !== openTrackId || !baselines.has(id))) baselines.set(id, track);
      }
    },

    /** A write this tab sent without a version check (rename, move) came back with this row. */
    adoptIfSameContent(id: string, row: unknown) {
      const track = serverTrackFromRow(row);
      const baseline = baselines.get(id);
      if (track && baseline && sameContent(baseline, track)) baselines.set(id, track);
    },

    /**
     * Runs a track's saves one at a time, so each one reads the baseline the previous one left and
     * a tab's own earlier save can never come back as a conflict.
     */
    serialize<T>(id: string, save: () => Promise<T>): Promise<T> {
      inFlight.set(id, (inFlight.get(id) ?? 0) + 1);
      bump(id);
      const run = (queues.get(id) ?? Promise.resolve()).then(save, save);
      const settled = run
        .catch(() => undefined)
        .finally(() => {
          inFlight.set(id, (inFlight.get(id) ?? 1) - 1);
          bump(id);
          if (queues.get(id) === settled) queues.delete(id);
        });
      queues.set(id, settled);
      return run;
    },

    /** Deleting everything: no track's disappearance during this is news. */
    async bulk<T>(operation: () => Promise<T>): Promise<T> {
      bulkOperations++;
      bulkGeneration++;
      try {
        return await operation();
      } finally {
        bulkOperations--;
        bulkGeneration++;
      }
    },

    /** Compare before and after a read: if it changed, the read may have seen this tab's own save. */
    activity(id: string) {
      return `${generations.get(id) ?? 0}:${bulkGeneration}`;
    },
    isBusy: (id: string) => (inFlight.get(id) ?? 0) > 0 || bulkOperations > 0,

    /** While paused, no save for this track leaves the tab. */
    pause(id: string) {
      paused.add(id);
    },
    resume(id: string) {
      paused.delete(id);
    },
    isPaused: (id: string) => paused.has(id),

    /** For tests: isolate:false shares this module between files. */
    reset() {
      baselines.clear();
      queues.clear();
      inFlight.clear();
      generations.clear();
      paused.clear();
      openTrackId = null;
      bulkOperations = 0;
    },
  };
  return versions;
}

export type TrackVersions = ReturnType<typeof createTrackVersions>;

export const trackVersions = createTrackVersions();
