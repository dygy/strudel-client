# @dygy/strudel-mcp

A local [MCP](https://modelcontextprotocol.io) server that lets an AI assistant run [Strudel](https://strudel.cc) patterns on your computer and see which events they produce. It makes no sound and needs no account.

```sh
claude mcp add strudel -- npx -y @dygy/strudel-mcp
```

Any other MCP client: run `npx -y @dygy/strudel-mcp` as a stdio server. Needs Node 20 or newer.

## Tools

| Tool | Answer |
|---|---|
| `run_pattern` | `code`, `cycles` (default 4, max 64). Events with `start`, `end` and `values`, at most 2,000 with a `truncated` flag, plus a summary |
| `summarize_pattern` | The same input. Sounds used, events per cycle, note range |

Errors come back as `isError` results holding JSON: `code`, `message`, `line`, `column` and `next`.

- **Line numbers:** syntax errors, unknown functions and misspelled methods give their exact line. Any other runtime error gives the line where its statement starts.
- **Events:** the same as the browser's scheduler for `@strudel/core`, `@strudel/mini` and `@strudel/tonal`. Functions from other packages aren't available, and running them is an error.
- **Skipped:** `samples()` and other loaders, visuals such as `.pianoroll()` and outputs such as `.midi()` do nothing, and are listed under `skipped`. `slider()`, `toggle()` and `radio()` keep the value in the code.

## The sandbox

Code runs in [QuickJS](https://github.com/justjake/quickjs-emscripten) compiled to WebAssembly, with a fresh context per run. The sandbox receives no host functions, so code has no way to reach files, the network or other programs.

A run stops after 9 seconds or 256 MB. `STRUDEL_MCP_TIME_LIMIT_MS` can shorten the time limit, but can't extend it.

## License

AGPL-3.0-or-later. The notices of the bundled packages are in `dist/THIRD-PARTY-NOTICES.*.txt`. The source is at https://github.com/dygy/strudel-client, in `packages/mcp-local`.
