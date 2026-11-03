/** Looking things up and checking code (spec 018, functional 2.7). No network: all from generated data. */
import { checkCode, closestNames } from './check';
import { fail, ok, type ToolResult } from './context';
import functions from './generated/functions.json';
import known from './generated/known.json';
import sounds from './generated/sounds.json';

/**
 * What fits in 10 ms on the first check in a new isolate, measured on the bundle: see README.md. Larger
 * code gets `use_local_helper`. Don't raise it without measuring CPU time on the deployed Worker.
 */
export const CHECK_MAX_BYTES = 768;
const SEARCH_PAGE = 50;
const SOUND_PAGE = 200;

interface FunctionDoc {
  name: string;
  synonyms: string[];
  description: string;
  params: Array<{ name: string; type: string; description: string }>;
  examples: string[];
}

const DOCS = functions as FunctionDoc[];

// Built once per isolate, on first use, and small enough for a request's first call to carry.
let byName: Map<string, FunctionDoc> | null = null;
let knownNames: Set<string> | null = null;

function index() {
  if (!byName) {
    byName = new Map();
    for (const doc of DOCS) {
      byName.set(doc.name.toLowerCase(), doc);
      for (const synonym of doc.synonyms)
        if (!byName.has(synonym.toLowerCase())) byName.set(synonym.toLowerCase(), doc);
    }
  }
  return byName;
}

const names = () => (knownNames ??= new Set(known as string[]));

export function lookupFunction(args: { name: string }): ToolResult {
  const doc = index().get(args.name.toLowerCase());
  if (!doc) {
    const documented = DOCS.flatMap((d) => [d.name, ...d.synonyms]);
    return fail('not_found', `${args.name} is not a Strudel function.`, 'Try one of the closest names.', {
      closest: closestNames(args.name, documented, 5, 4),
    });
  }
  return ok({ ...doc });
}

const firstSentence = (text: string) => {
  const match = /^[\s\S]*?[.!?](?:\s|$)/.exec(text);
  return (match ? match[0] : text).trim();
};

export function searchFunctions(args: { query: string; offset?: number }): ToolResult {
  const query = args.query.toLowerCase();
  const offset = args.offset ?? 0;
  const matches = DOCS.filter(
    (doc) =>
      doc.name.toLowerCase().includes(query) ||
      doc.synonyms.some((synonym) => synonym.toLowerCase().includes(query)) ||
      doc.description.toLowerCase().includes(query),
  );
  // Names first: someone looking for `lpf` wants it above every description that mentions it.
  const named = (doc: FunctionDoc) => (doc.name.toLowerCase().includes(query) ? 0 : 1);
  matches.sort((a, b) => named(a) - named(b) || a.name.localeCompare(b.name));
  const next = offset + SEARCH_PAGE;
  return ok({
    functions: matches
      .slice(offset, next)
      .map((doc) => ({ name: doc.name, synonyms: doc.synonyms, summary: firstSentence(doc.description) })),
    nextOffset: next < matches.length ? next : null,
  });
}

const SOUND_KINDS = ['synths', 'samples', 'drumMachines', 'banks', 'soundfonts'] as const;
type SoundKind = (typeof SOUND_KINDS)[number];

export function listSounds(args: { kind?: SoundKind; query?: string; offset?: number }): ToolResult {
  const kinds = args.kind ? [args.kind] : SOUND_KINDS;
  const query = args.query?.toLowerCase();
  const all = kinds.flatMap((kind) =>
    (sounds[kind] as string[])
      .filter((name) => !query || name.toLowerCase().includes(query))
      .map((name) => ({ name, kind })),
  );
  const offset = args.offset ?? 0;
  const next = offset + SOUND_PAGE;
  return ok({
    sounds: all.slice(offset, next),
    nextOffset: next < all.length ? next : null,
    note: 'What the site loads at start. Sounds a track loads itself with samples() are not listed.',
  });
}

export function checkCodeTool(args: { code: string }): ToolResult {
  if (new TextEncoder().encode(args.code).length > CHECK_MAX_BYTES) {
    return fail(
      'use_local_helper',
      `The online check takes code up to ${CHECK_MAX_BYTES} bytes.`,
      'For larger code, use the local helper: add it to your assistant with the command npx -y strudel_mcp.',
    );
  }
  return ok({ ...checkCode(args.code, names()) });
}
