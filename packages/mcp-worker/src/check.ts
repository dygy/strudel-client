/**
 * The pattern check (spec 018, functional 2.7): syntax, mini-notation and names that don't exist,
 * without running anything. Pure, and takes its names as an argument, so the local helper can bundle
 * the same logic. acorn parses the code; krill, the parser the site itself uses, parses the strings.
 */
import { parse as parseJs, type Node } from 'acorn';
import { parse as parseMini } from '../../mini/krill-parser.js';

export interface CheckProblem {
  kind: 'syntax' | 'mini' | 'unknown_function';
  message: string;
  line: number;
  column: number;
  suggestion?: string;
}

export interface CheckResult {
  ok: boolean;
  errors: CheckProblem[];
  warnings: CheckProblem[];
}

/** Names people expect, for functions that exist under another name. */
const REAL_NAME: Readonly<Record<string, string>> = {
  lowpass: 'lpf',
  lopass: 'lpf',
  highpass: 'hpf',
  hipass: 'hpf',
  bandpass: 'bpf',
  volume: 'gain',
  reverb: 'room',
  sample: 's',
  tempo: 'setcps',
};
const MAX_WARNINGS = 25;
/** Comparing a name with all the known ones is what costs most in a check, so only the first few get it. */
const MAX_SUGGESTIONS = 5;
const MAX_SUGGESTION_DISTANCE = 2;

/** As the transpiler: these are strings it leaves as they are, not mini-notation. */
const PLAIN_WORDS = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/;
const URL_LIKE = /^(https?:\/\/|ftp:\/\/|file:\/\/|data:|blob:|\/\/)/;

/** Edit distance, giving up once it's over `limit`. */
export function distance(a: string, b: string, limit = MAX_SUGGESTION_DISTANCE): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(cost);
      if (cost < best) best = cost;
    }
    if (best > limit) return limit + 1;
    previous = row;
  }
  return previous[b.length];
}

/** The closest real names, nearest first. A misspelt alias leads to the real name it stands for. */
export function closestNames(name: string, names: Iterable<string>, count: number, limit = MAX_SUGGESTION_DISTANCE) {
  const wanted = name.toLowerCase();
  const found = new Map<string, number>();
  const consider = (candidate: string, real: string) => {
    if (Math.abs(candidate.length - wanted.length) > limit) return;
    const d = distance(wanted, candidate.toLowerCase(), limit);
    if (d <= limit && d < (found.get(real) ?? Infinity)) found.set(real, d);
  };
  for (const candidate of names) consider(candidate, candidate);
  for (const [alias, real] of Object.entries(REAL_NAME)) consider(alias, real);
  return [...found.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([real]) => real);
}

type AnyNode = Node & Record<string, unknown>;
const isNode = (value: unknown): value is AnyNode =>
  typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';

function walk(root: AnyNode, visit: (node: AnyNode, parent: AnyNode | null) => void) {
  const stack: Array<[AnyNode, AnyNode | null]> = [[root, null]];
  while (stack.length) {
    const [node, parent] = stack.pop()!;
    visit(node, parent);
    for (const key in node) {
      if (key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = value.length - 1; i >= 0; i--) if (isNode(value[i])) stack.push([value[i], node]);
      } else if (isNode(value)) {
        stack.push([value, node]);
      }
    }
  }
}

const at = (node: AnyNode) => ({ line: node.loc!.start.line, column: node.loc!.start.column + 1 });

/** A mini-notation string that doesn't parse, placed where the mistake is. */
function checkMini(text: string, node: AnyNode, passed: Set<string>): CheckProblem | null {
  // Words and spaces can't be wrong, and a string that passed once passes again. Most strings are one
  // or the other, and the parser is the slowest thing here.
  if (PLAIN_WORDS.test(text) || passed.has(text)) return null;
  try {
    // In quotes, as the transpiler hands it over: the grammar's start rule is a quoted sequence.
    parseMini(`"${text}"`);
    passed.add(text);
    return null;
  } catch (error: unknown) {
    const { location, found } = error as {
      location?: { start?: { line: number; column: number } };
      found?: string | null;
    };
    const place = location?.start;
    const start = at(node);
    return {
      kind: 'mini',
      message: `Mini-notation mistake in this string: ${
        found && found !== '"' ? `unexpected "${found}"` : 'it ends too early, perhaps at an unclosed bracket'
      }.`,
      line: start.line + (place ? place.line - 1 : 0),
      // The added quote stands where the code's own does. An escape in the string shifts this a little.
      column: place && place.line > 1 ? place.column : start.column + (place ? place.column - 1 : 0),
    };
  }
}

/**
 * Checks code without running it.
 * @param known every name a call may use
 */
export function checkCode(code: string, known: Set<string>): CheckResult {
  let ast: AnyNode;
  try {
    ast = parseJs(code, {
      ecmaVersion: 2022,
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      locations: true,
    }) as unknown as AnyNode;
  } catch (error: unknown) {
    const { loc, message } = error as { loc?: { line: number; column: number }; message?: string };
    return {
      ok: false,
      warnings: [],
      errors: [
        {
          kind: 'syntax',
          // acorn ends its message with the position, which these fields already say.
          message: (message ?? 'Syntax error').replace(/ \(\d+:\d+\)$/, ''),
          line: loc?.line ?? 1,
          column: (loc?.column ?? 0) + 1,
        },
      ],
    };
  }

  // Names this code gives itself: what it declares, and what it registers.
  const local = new Set<string>();
  const calls: Array<{ name: string; node: AnyNode }> = [];
  const errors: CheckProblem[] = [];
  const passed = new Set<string>();

  walk(ast, (node, parent) => {
    switch (node.type) {
      case 'VariableDeclarator':
      case 'FunctionDeclaration':
      case 'FunctionExpression':
      case 'ArrowFunctionExpression':
      case 'ImportSpecifier':
      case 'ImportDefaultSpecifier':
      case 'ImportNamespaceSpecifier':
      case 'ClassDeclaration': {
        const id = (node.id ?? node.local) as AnyNode | null | undefined;
        if (id?.type === 'Identifier') local.add(id.name as string);
        if (id?.type === 'ObjectPattern' || id?.type === 'ArrayPattern') {
          walk(id, (inner) => {
            if (inner.type === 'Identifier') local.add(inner.name as string);
          });
        }
        for (const param of (node.params ?? []) as AnyNode[]) {
          walk(param, (inner) => {
            if (inner.type === 'Identifier') local.add(inner.name as string);
          });
        }
        break;
      }
      case 'Property':
      case 'MethodDefinition': {
        // `{ f() {} }`, and a call to it later.
        const key = node.key as AnyNode;
        if (!node.computed && key.type === 'Identifier') local.add(key.name as string);
        break;
      }
      case 'AssignmentExpression': {
        // `Pattern.prototype.f = ...` and `f = ...`.
        const left = node.left as AnyNode;
        if (left.type === 'Identifier') local.add(left.name as string);
        if (left.type === 'MemberExpression' && !left.computed) local.add((left.property as AnyNode).name as string);
        break;
      }
      case 'Literal': {
        const isKey = parent?.type === 'Property' && parent.key === node && !parent.computed;
        const isImport = parent?.type === 'ImportDeclaration' || parent?.type === 'ImportExpression';
        if ((node.raw as string)[0] === '"' && typeof node.value === 'string' && !isKey && !isImport) {
          if (!URL_LIKE.test(node.value)) {
            const problem = checkMini(node.value, node, passed);
            if (problem) errors.push(problem);
          }
        }
        break;
      }
      case 'TemplateLiteral': {
        // As the transpiler: a template is mini-notation unless it's tagged, and only its first part counts.
        const quasis = node.quasis as AnyNode[];
        if (parent?.type !== 'TaggedTemplateExpression' && quasis.length === 1) {
          const problem = checkMini((quasis[0].value as { raw: string }).raw, node, passed);
          if (problem) errors.push(problem);
        }
        break;
      }
      case 'CallExpression': {
        const callee = node.callee as AnyNode;
        if (callee.type === 'Identifier') {
          calls.push({ name: callee.name as string, node: callee });
          // register('name', ...) makes a name of its own.
          const first = (node.arguments as AnyNode[])[0];
          if (callee.name === 'register' && first?.type === 'Literal' && typeof first.value === 'string') {
            local.add(first.value);
          }
        } else if (callee.type === 'MemberExpression' && !callee.computed) {
          calls.push({ name: (callee.property as AnyNode).name as string, node: callee.property as AnyNode });
        }
        break;
      }
    }
  });

  const warnings: CheckProblem[] = [];
  const seen = new Set<string>();
  for (const { name, node } of calls) {
    if (known.has(name) || local.has(name) || seen.has(name) || warnings.length >= MAX_WARNINGS) continue;
    seen.add(name);
    const suggestion =
      REAL_NAME[name] ?? (warnings.length < MAX_SUGGESTIONS ? closestNames(name, known, 1)[0] : undefined);
    warnings.push({
      kind: 'unknown_function',
      message: suggestion
        ? `${name} is not a Strudel function. Did you mean ${suggestion}?`
        : `${name} is not a Strudel function.`,
      ...at(node),
      ...(suggestion ? { suggestion } : {}),
    });
  }
  warnings.sort((a, b) => a.line - b.line || a.column - b.column);
  errors.sort((a, b) => a.line - b.line || a.column - b.column);
  return { ok: errors.length === 0, errors, warnings };
}
