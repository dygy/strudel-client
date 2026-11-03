/** A small JSON Schema check for tool arguments: the subset the tool definitions use (no zod here). */
export interface Schema {
  type?: string | readonly string[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: Schema;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  enum?: readonly unknown[];
  [other: string]: unknown;
}

const typeOf = (value: unknown) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

/** The first thing wrong with `value`, or null. Says where, never echoes the value. */
export function firstProblem(value: unknown, schema: Schema, path = 'arguments'): string | null {
  const actual = typeOf(value);
  const types = typeof schema.type === 'string' ? [schema.type] : schema.type;
  if (types && !types.includes(actual) && !(actual === 'integer' && types.includes('number'))) {
    return `${path} must be ${types.join(' or ')}`;
  }
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of ${schema.enum.join(', ')}`;
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path} is too short`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path} is too long`;
  }
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) {
    return `${path} must be at least ${schema.minimum}`;
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path} has too few items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} has too many items`;
    if (schema.items) {
      for (let i = 0; i < value.length; i++) {
        const problem = firstProblem(value[i], schema.items, `${path}[${i}]`);
        if (problem) return problem;
      }
    }
  }
  if (actual === 'object') {
    const object = value as Record<string, unknown>;
    for (const key of schema.required ?? []) {
      if (object[key] === undefined) return `${path}.${key} is required`;
    }
    for (const key of Object.keys(object)) {
      const property = schema.properties?.[key];
      if (property) {
        const problem = firstProblem(object[key], property, `${path}.${key}`);
        if (problem) return problem;
      } else if (schema.additionalProperties === false) {
        return `${path} has an unknown field`;
      }
    }
  }
  return null;
}
