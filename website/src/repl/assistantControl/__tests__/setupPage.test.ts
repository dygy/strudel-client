/**
 * @spec: 018-strudel-mcp-server (functional 2.11)
 * The setup page says what's true: every tool, the address, the check's limit, and how to get to it.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECK_MAX_BYTES } from '../../../../../packages/mcp-worker/src/knowledge';
import { HELPER_COMMAND, HELPER_PACKAGE } from '../../../lib/mcpHelper';
import { TOOLS } from '../../../../../packages/mcp-worker/src/tools';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const page = read('website/src/pages/learn/ai-assistants.mdx');
const panel = read('website/src/repl/components/panel/ConnectedAssistants.tsx');

describe('learn/ai-assistants', () => {
  it('can be read signed out: prerendered, like the rest of the docs', () => {
    expect(page).not.toMatch(/prerender\s*=\s*false/);
    expect(page).toContain('layout: ../../layouts/MainLayout.astro');
  });

  it('names every tool except the one that only says who you are', () => {
    const missing = TOOLS.map((tool) => tool.name).filter((name) => name !== 'whoami' && !page.includes(`\`${name}\``));
    expect(missing).toEqual([]);
  });

  it('gives the address and the command the app gives', () => {
    const address = /MCP_ADDRESS = '([^']+)'/.exec(panel)![1];
    expect(page).toContain(address);
    expect(page).toContain(`claude mcp add --transport http strudel ${address}`);
  });

  it('only offers the helper through the one constant, so nothing names the package until it is there', () => {
    expect(page).toContain('{HELPER_PUBLISHED && (');
    expect(page).toContain('{HELPER_COMMAND}');
    expect(page).not.toContain(HELPER_PACKAGE);
    expect(read('packages/mcp-worker/src/knowledge.ts')).not.toContain(HELPER_PACKAGE);
    expect(panel).not.toContain(HELPER_PACKAGE);
    expect(HELPER_COMMAND).toContain(`npx -y ${HELPER_PACKAGE}`);
  });

  it("gives the online check's limit as it is", () => {
    expect(page).toContain(`up to ${CHECK_MAX_BYTES} bytes`);
  });

  it('says how to disconnect, and how control is turned on and off', () => {
    expect(page).toMatch(/## Disconnecting/);
    expect(page).toContain('**Allow assistant control**');
  });

  it('is in the docs menu and linked from the app', () => {
    expect(read('website/src/config.ts')).toContain("link: 'learn/ai-assistants'");
    expect(panel).toContain('learn/ai-assistants');
  });
});
