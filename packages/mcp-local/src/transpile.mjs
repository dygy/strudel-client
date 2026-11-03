import { parse } from 'acorn';
import { transpiler } from '@strudel/transpiler';

const PARSE_OPTIONS = {
  ecmaVersion: 2022,
  allowAwaitOutsideFunction: true,
  allowReturnOutsideFunction: true,
  locations: true,
};

/** Depth-first over an acorn AST. `visit` gets each node and its parent. */
function walk(node, visit, parent = null) {
  visit(node, parent);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) {
      child.filter((item) => typeof item?.type === 'string').forEach((item) => walk(item, visit, node));
    } else if (typeof child?.type === 'string') {
      walk(child, visit, node);
    }
  }
}

const position = ({ loc }) => ({ line: loc.start.line, column: loc.start.column + 1 });

/**
 * Turns Strudel code into plain JS with the same transpiler as the browser. It only parses and
 * generates code: nothing the user wrote is executed here.
 * @param {string} code the user's code
 * @returns {{output: string}|{error: {code: string, message: string, line: (number|null), column: (number|null)}}} the JS, or what's wrong with the code
 */
export function transpile(code) {
  try {
    return { output: transpiler(code, { emitWidgets: false }).output };
  } catch (err) {
    return { error: describeTranspileError(err, code) };
  }
}

function describeTranspileError(err, code) {
  const base = { code: 'syntax_error', message: err.message, line: null, column: null };
  if (err.loc) {
    // acorn
    return { ...base, line: err.loc.line, column: err.loc.column + 1 };
  }
  const mini = /^\[mini\] parse error at line (\d+)/.exec(err.message);
  if (mini) {
    return { ...base, line: Number(mini[1]) };
  }
  // the transpiler's "unexpected ast format", for a last statement that gives no value
  return { ...base, message: `The last statement must be a pattern: ${err.message}`, ...lastStatementPosition(code) };
}

/**
 * Finds the statement that gives a run its value.
 * @param {string} code the user's code, which must parse
 * @returns {{line: number, column: number}|{}} its position, or nothing for code with no statements
 */
export function lastStatementPosition(code) {
  const last = parse(code, PARSE_OPTIONS).body.at(-1);
  return last ? position(last) : {};
}

/**
 * Finds where in the user's code a runtime error belongs. The generated code has other line breaks,
 * so the error's line first leads to its top-level statement, which both versions have in the same order.
 * @param {{code: string, output: string, generatedLine: (number|null), name: string, message: string, unknownNames: function(string[]): string[]}} failure the error, and a way to ask the sandbox which names it doesn't know
 * @returns {{line: (number|null), column: (number|null), message: string}} the position, and the message with the name filled in when QuickJS leaves it out
 */
export function locateRuntimeError({ code, output, generatedLine, name, message, unknownNames }) {
  const fallback = { line: null, column: null, message: `${name}: ${message}` };
  if (generatedLine === null) {
    return fallback;
  }
  const statements = parse(code, PARSE_OPTIONS).body;
  const index = parse(output, PARSE_OPTIONS).body.findIndex(
    ({ loc }) => loc.start.line <= generatedLine && generatedLine <= loc.end.line,
  );
  const statement = statements[index];
  if (!statement) {
    return fallback;
  }
  const atStatement = { ...fallback, ...position(statement) };
  const notDefined = /^'(.+)' is not defined$/.exec(message);
  if (name === 'ReferenceError' && notDefined) {
    const found = findIdentifier(statement, notDefined[1]);
    return found ? { ...atStatement, ...position(found) } : atStatement;
  }
  if (name === 'TypeError' && message === 'not a function') {
    const calls = findMethodCalls(statement);
    const unknown = new Set(unknownNames(calls.map(({ property }) => property.name)));
    const call = calls.find(({ property }) => unknown.has(property.name));
    if (call) {
      return { message: `TypeError: .${call.property.name} is not a function`, ...position(call.property) };
    }
  }
  return atStatement;
}

function findIdentifier(statement, identifier) {
  let found;
  walk(statement, (node, parent) => {
    const isPropertyName = parent?.type === 'MemberExpression' && parent.property === node && !parent.computed;
    if (!found && node.type === 'Identifier' && node.name === identifier && !isPropertyName) {
      found = node;
    }
  });
  return found;
}

/** The `.name(` calls of a statement, in the order they appear, which is the order a chain runs. */
function findMethodCalls(statement) {
  const calls = [];
  walk(statement, (node) => {
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      !node.callee.computed &&
      node.callee.property.type === 'Identifier'
    ) {
      calls.push({ property: node.callee.property });
    }
  });
  return calls.sort((a, b) => a.property.start - b.property.start);
}
