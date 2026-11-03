const MAX_DEPTH = 8;

/**
 * Turns a hap value into plain JSON data, dropping what can't cross to the host (functions, patterns).
 * @param {*} value any hap value
 * @param {number} [depth] the current nesting
 * @returns {*} a JSON-safe copy, or undefined when nothing of it can be sent
 */
export function plainValue(value, depth = 0) {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'number':
      return Number.isFinite(value) ? value : null;
    case 'bigint':
      return String(value);
    case 'object':
      break;
    default:
      return undefined;
  }
  if (value === null) {
    return null;
  }
  if (depth >= MAX_DEPTH || value._Pattern) {
    return undefined;
  }
  // a Fraction: every other object in a value is plain data
  if (typeof value.toFraction === 'function') {
    return Number(value.valueOf());
  }
  if (Array.isArray(value)) {
    return value.map((item) => plainValue(item, depth + 1) ?? null);
  }
  const plain = {};
  for (const key of Object.keys(value)) {
    const item = plainValue(value[key], depth + 1);
    if (item !== undefined) {
      plain[key] = item;
    }
  }
  return plain;
}
