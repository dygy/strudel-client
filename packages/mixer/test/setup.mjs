/**
 * Test setup for @strudel/mixer (referenced by packages/mixer/vitest.config.js).
 *
 * Intentionally empty. The Web Audio / device / storage mocks live in
 * ./webAudioMock.mjs and are installed per test via vi.stubGlobal, so the
 * same mock serves both this package config and the root vitest run (which
 * never loads this file and runs with isolate: false — permanent globals
 * installed here would leak into other packages' tests).
 */
