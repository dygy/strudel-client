/**
 * Just enough of PostgREST's query language to run what the Worker sends against plain arrays, so paging
 * and quoting are tested for real rather than by comparing URLs.
 */
function parseValue(text, start) {
  if (text[start] !== '"') {
    let end = start;
    while (end < text.length && text[end] !== ',' && text[end] !== ')') end++;
    return { value: text.slice(start, end), end };
  }
  let value = '';
  let i = start + 1;
  while (text[i] !== '"') {
    if (i >= text.length) throw new Error('unterminated quoted value');
    if (text[i] === '\\') i++;
    value += text[i++];
  }
  return { value, end: i + 1 };
}

function parseTerm(text, start) {
  const group = /^(or|and)\(/.exec(text.slice(start));
  if (group) {
    let i = start + group[0].length;
    const terms = [];
    while (text[i] !== ')') {
      if (i >= text.length) throw new Error('unterminated group');
      const term = parseTerm(text, i);
      terms.push(term.node);
      i = term.end;
      if (text[i] === ',') i++;
    }
    return { node: { group: group[1], terms }, end: i + 1 };
  }
  const head = /^([a-z_]+)\.([a-z]+)\./.exec(text.slice(start));
  if (!head) throw new Error(`bad filter at: ${text.slice(start, start + 40)}`);
  const { value, end } = parseValue(text, start + head[0].length);
  return { node: { column: head[1], op: head[2], value }, end };
}

const LIKE_SPECIAL = /[.+?^${}()|[\]\\]/g;

/** PostgREST's `*` is `%`, and a backslash escapes in the LIKE pattern. */
function likeRegex(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\' && i + 1 < pattern.length) out += pattern[++i].replace(LIKE_SPECIAL, '\\$&');
    else if (c === '*' || c === '%') out += '[\\s\\S]*';
    else if (c === '_') out += '[\\s\\S]';
    else out += c.replace(LIKE_SPECIAL, '\\$&');
  }
  return new RegExp(`^${out}$`, 'i');
}

function matches(row, node) {
  if (node.group === 'or') return node.terms.some((term) => matches(row, term));
  if (node.group === 'and') return node.terms.every((term) => matches(row, term));
  const value = row[node.column];
  switch (node.op) {
    case 'eq':
      return String(value ?? '\0') === node.value;
    case 'is':
      return node.value === 'null' ? value === null || value === undefined : false;
    case 'lt':
      return value !== null && value !== undefined && String(value) < node.value;
    case 'gt':
      return value !== null && value !== undefined && String(value) > node.value;
    case 'ilike':
      return likeRegex(node.value).test(String(value ?? ''));
    default:
      throw new Error(`unsupported operator ${node.op}`);
  }
}

/** Runs one read. `params` is URLSearchParams. */
export function runQuery(rows, params) {
  let out = rows;
  for (const [key, text] of params) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    if (key === 'and' || key === 'or') {
      const { node } = parseTerm(`${key}${text}`, 0);
      out = out.filter((row) => matches(row, node));
    } else {
      const dot = text.indexOf('.');
      const node = { column: key, op: text.slice(0, dot), value: text.slice(dot + 1) };
      out = out.filter((row) => matches(row, node));
    }
  }
  const order = params.get('order');
  if (order) {
    const keys = order.split(',').map((part) => part.split('.'));
    out = [...out].sort((a, b) => {
      for (const [column, direction] of keys) {
        if (a[column] === b[column]) continue;
        const less = String(a[column]) < String(b[column]);
        return (less ? -1 : 1) * (direction === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }
  // PostgREST's default cap on a response, which a whole-library read would run into.
  out = out.slice(0, Number(params.get('limit') ?? 1000));
  const select = params.get('select');
  if (select && select !== '*') {
    const columns = select.split(',');
    out = out.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
  }
  return out;
}
