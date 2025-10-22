import { evalScope, hash2code, logger } from '@strudel/core';
import { settingPatterns } from '../settings';
import { setVersionDefaults } from '@strudel/webaudio';
import { getMetadata } from '../metadata_parser';
import { isTauri } from '../tauri';
import './Repl.css';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { $featuredPatterns } from '@src/user_pattern_utils';

// Type definitions
interface CodeRecord {
  code: string;
  hash?: string;
  public?: boolean;
}

interface SupabaseResponse<T> {
  data: T[] | null;
  error: any;
}

interface PatternData {
  code: string;
  [key: string]: any;
}

interface FeaturedPatterns {
  [key: string]: PatternData;
}

// Create a single supabase client for interacting with your database
export const supabase: SupabaseClient = createClient(
  'https://pidxdsxphlhzjnzmifth.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpZHhkc3hwaGxoempuem1pZnRoIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NTYyMzA1NTYsImV4cCI6MTk3MTgwNjU1Nn0.bqlw7802fsWRnqU5BLYtmXk_k-D1VFmbkHMywWc15NM',
);

let dbLoaded: Promise<void> | undefined;
/* if (typeof window !== 'undefined') {
  dbLoaded = loadDBPatterns();
} */

/**
 * Initializes code from URL hash or database
 * @returns Promise that resolves to the code string or undefined
 */
export async function initCode(): Promise<string | undefined> {
  // Load code from url hash (either short hash from database or decode long hash)
  try {
    const initialUrl = window.location.href;
    const hash = initialUrl.split('?')[1]?.split('#')?.[0]?.split('&')[0];
    const codeParam = window.location.href.split('#')[1] || '';
    
    if (codeParam) {
      // Looking like https://strudel.cc/#ImMzIGUzIg%3D%3D (hash length depends on code length)
      return hash2code(codeParam);
    } else if (hash) {
      // Looking like https://strudel.cc/?J01s5i1J0200 (fixed hash length)
      const response = await supabase
        .from('code_v1')
        .select('code')
        .eq('hash', hash);
      
      const { data, error } = response as SupabaseResponse<CodeRecord>;
      
      if (error) {
        console.warn('failed to load hash', error);
        return undefined;
      }
      
      if (data && data.length > 0) {
        // console.log('load hash from database', hash);
        return data[0].code;
      }
    }
  } catch (err) {
    console.warn('failed to decode', err);
  }
  
  return undefined;
}

/**
 * Safely parses JSON string with fallback
 * @param json - JSON string to parse
 * @returns Parsed object or empty object if parsing fails
 */
export const parseJSON = (json: string | null | undefined): any => {
  const safeJson = json != null && json.length ? json : '{}';
  try {
    return JSON.parse(safeJson);
  } catch {
    return {};
  }
};

/**
 * Gets a random tune from featured patterns
 * @returns Promise that resolves to pattern data
 */
export async function getRandomTune(): Promise<PatternData | undefined> {
  await dbLoaded;
  const featuredTunes = Object.entries($featuredPatterns.get() as any);
  const randomItem = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
  const [_, data] = randomItem(featuredTunes);
  return data;
}

/**
 * Loads all Strudel modules dynamically
 * @returns Promise that resolves to the evalScope result
 */
export function loadModules(): Promise<any> {
  const modules = [
    import('@strudel/core'),
    import('@strudel/draw'),
    import('@strudel/tonal'),
    import('@strudel/mini'),
    import('@strudel/xen'),
    import('@strudel/webaudio'),
    import('@strudel/codemirror'),
    import('@strudel/hydra'),
    import('@strudel/serial'),
    import('@strudel/soundfonts'),
    import('@strudel/csound'),
    import('@strudel/tidal'),
    import('@strudel/gamepad'),
    import('@strudel/motion'),
    import('@strudel/mqtt'),
    import('@strudel/mondo'),
    import('@strudel/midi'),
    import('@strudel/osc'),
  ];
  
  // For now, always use web modules since desktopbridge is not published to npm
  // TODO: In a proper Tauri build, conditionally load desktop bridge modules
  // if (isTauri()) {
  //   modules = modules.concat([
  //     import('@strudel/desktopbridge/loggerbridge.mjs'),
  //     import('@strudel/desktopbridge/midibridge.mjs'),
  //     import('@strudel/desktopbridge/oscbridge.mjs'),
  //   ]);
  // }

  return evalScope(settingPatterns, ...modules);
}

/**
 * Normalizes confirm dialog to always return a Promise
 * (WebKit returns Promise, other browsers return boolean)
 * @param msg - Message to show in confirm dialog
 * @returns Promise that resolves to boolean
 */
export function confirmDialog(msg: string): Promise<boolean> {
  const confirmed = confirm(msg);
  if (typeof confirmed === 'object' && confirmed && 'then' in confirmed) {
    return confirmed as Promise<boolean>;
  }
  return new Promise((resolve) => {
    resolve(confirmed as boolean);
  });
}

let lastShared: string | undefined;

/**
 * Shares the current code by copying URL to clipboard
 */
export async function shareCode(): Promise<void> {
  try {
    const shareUrl = window.location.href;
    if (isTauri()) {
      await writeText(shareUrl);
    } else {
      await navigator.clipboard.writeText(shareUrl);
    }
    const message = 'Link copied to clipboard!';
    alert(message);
    logger(message, 'highlight');
  } catch (e) {
    console.error(e);
  }
}

/**
 * Checks if the current window is inside an iframe
 * @returns True if running in iframe
 */
export const isIframe = (): boolean => window.location !== window.parent.location;

/**
 * Checks if the current frame is cross-origin
 * @returns True if cross-origin frame
 */
function isCrossOriginFrame(): boolean {
  try {
    return !window.top?.location.hostname;
  } catch (e) {
    return true;
  }
}

/**
 * Checks if running in Udels environment
 * @returns True if in Udels
 */
export const isUdels = (): boolean => {
  if (isCrossOriginFrame()) {
    return false;
  }
  return window.top?.location?.pathname.includes('udels') ?? false;
};

/**
 * Sets version defaults from code metadata
 * @param code - Code string to parse for metadata
 */
export function setVersionDefaultsFrom(code: string): void {
  try {
    const metadata = getMetadata(code);
    setVersionDefaults(metadata.version);
  } catch (err) {
    console.error('Error parsing metadata..');
    console.error(err);
  }
}