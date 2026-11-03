#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.mjs';

// stdout carries the protocol. Nothing else in this thread may print to it.
const server = createServer();
await server.connect(new StdioServerTransport());
// a run in progress would keep the process alive after the client has gone
process.stdin.on('close', () => process.exit(0));
