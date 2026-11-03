// The script that runs inside QuickJS. Polyfills first: the engine reads them while it loads.
import './polyfills.mjs';
import * as core from '@strudel/core';
import * as mini from '@strudel/mini';
import * as tonal from '@strudel/tonal';
import { createGuest } from './run.mjs';

// The host takes this and deletes the global before any user code runs.
globalThis.__strudelGuest = createGuest({ core, mini, tonal });
