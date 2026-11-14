#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.mjs';
import { login } from './library.mjs';

if (process.argv[2] === 'login') {
  // one-time sign-in to the online library, for upload_track; prints to stderr, never runs the server
  try {
    await login();
    process.exit(0);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
}

// stdout carries the protocol. Nothing else in this thread may print to it.
const server = createServer();
await server.connect(new StdioServerTransport());
// a run in progress would keep the process alive after the client has gone
process.stdin.on('close', () => process.exit(0));
