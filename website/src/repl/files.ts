import {
  processSampleMap,
  registerSamplesPrefix,
  registerSound,
  onTriggerSample,
  getAudioContext,
  loadBuffer,
} from '@strudel/webaudio';
import { logger } from '@strudel/core';

// Type definitions for Tauri file system API
interface TauriFS {
  BaseDirectory?: {
    Audio?: string;
  };
  readDir?: (path: string, options?: { dir?: string; recursive?: boolean }) => Promise<FileEntry[]>;
  readBinaryFile?: (path: string, options?: { dir?: string }) => Promise<Uint8Array>;
  writeTextFile?: (path: string, contents: string, options?: { dir?: string }) => Promise<void>;
  readTextFile?: (path: string, options?: { dir?: string }) => Promise<string>;
  exists?: (path: string, options?: { dir?: string }) => Promise<boolean>;
}

interface FileEntry {
  name: string;
  children?: FileEntry[];
  subpath?: string[];
}

interface FileTree {
  name: string;
  children?: FileEntry[];
  subpath?: string[];
}

interface SampleMap {
  [key: string]: string[];
}

type WalkFileTreeCallback = (entry: FileEntry, parent: FileTree) => void;
type FileResolverFunction = (url: string) => Promise<string>;

// Tauri integration
let TAURI: { fs?: TauriFS } | undefined;
if (typeof window !== 'undefined') {
  TAURI = (window as any)?.__TAURI__;
}

export const { BaseDirectory, readDir, readBinaryFile, writeTextFile, readTextFile, exists } = TAURI?.fs || {};

export const dir = BaseDirectory?.Audio; // https://tauri.app/v1/api/js/path#audiodir
const prefix = '~/music/';

/**
 * Checks if a strudel.json file exists in the given subpath
 * @param subpath - The path to check
 * @returns Promise that resolves to true if strudel.json exists
 */
async function hasStrudelJson(subpath: string): Promise<boolean> {
  if (!exists) return false;
  return exists(subpath + '/strudel.json', { dir });
}

/**
 * Loads and processes a strudel.json file
 * @param subpath - The path containing the strudel.json file
 */
async function loadStrudelJson(subpath: string): Promise<void> {
  if (!readTextFile) return;
  
  const contents = await readTextFile(subpath + '/strudel.json', { dir });
  const sampleMap: SampleMap = JSON.parse(contents);
  
  processSampleMap(sampleMap, (key, bank) => {
    registerSound(key, (t, hapValue, onended) => onTriggerSample(t, hapValue, onended, bank, fileResolver(subpath)), {
      type: 'sample',
      samples: bank,
      fileSystem: true,
      tag: 'local',
    });
  });
}

/**
 * Creates a strudel.json file by scanning directory for audio files
 * @param subpath - The path to scan and create strudel.json in
 */
async function writeStrudelJson(subpath: string): Promise<void> {
  if (!readDir || !writeTextFile) return;
  
  const children = await readDir(subpath, { dir, recursive: true });
  const name = subpath.split('/').slice(-1)[0];
  const tree: FileTree = { name, children };

  const samples: SampleMap = {};
  let count = 0;
  
  walkFileTree(tree, (entry, parent) => {
    if (['wav', 'mp3'].includes(entry.name.split('.').slice(-1)[0])) {
      samples[parent.name] = samples[parent.name] || [];
      count += 1;
      samples[parent.name].push(entry.subpath!.slice(1).concat([entry.name]).join('/'));
    }
  });
  
  const json = JSON.stringify(samples, null, 2);
  const filepath = subpath + '/strudel.json';
  await writeTextFile(filepath, json, { dir });
  logger(`wrote strudel.json with ${count} samples to ${subpath}!`, 'success');
}

// Register the samples prefix handler
registerSamplesPrefix(prefix, async (path: string) => {
  const subpath = path.replace(prefix, '');
  const hasJson = await hasStrudelJson(subpath);
  if (!hasJson) {
    await writeStrudelJson(subpath);
  }
  return loadStrudelJson(subpath);
});

/**
 * Recursively walks a file tree and calls a function for each entry
 * @param node - The current node in the tree
 * @param fn - Function to call for each entry
 */
export const walkFileTree = (node: FileTree, fn: WalkFileTreeCallback): void => {
  if (!Array.isArray(node?.children)) {
    return;
  }
  
  for (const entry of node.children) {
    entry.subpath = (node.subpath || []).concat([node.name]);
    fn(entry, node);
    if (entry.children) {
      walkFileTree(entry, fn);
    }
  }
};

/**
 * Checks if a filename has an audio file extension
 * @param filename - The filename to check
 * @returns True if the file is an audio file
 */
export const isAudioFile = (filename: string): boolean =>
  ['wav', 'mp3', 'flac', 'ogg', 'm4a', 'aac'].includes(filename.split('.').slice(-1)[0]);

/**
 * Converts a Uint8Array to a data URL
 * @param uint8Array - The array to convert
 * @returns Data URL string
 */
function uint8ArrayToDataURL(uint8Array: Uint8Array): string {
  const blob = new Blob([uint8Array], { type: 'audio/*' });
  const dataURL = URL.createObjectURL(blob);
  return dataURL;
}

// Cache for local URLs to data URLs
const loadCache: Record<string, Promise<string>> = {};

/**
 * Resolves a file URL to a data URL, with caching
 * @param url - The file URL to resolve
 * @returns Promise that resolves to the data URL
 */
export async function resolveFileURL(url: string): Promise<string> {
  if (loadCache[url]) {
    return loadCache[url];
  }
  
  loadCache[url] = (async () => {
    if (!readBinaryFile) {
      throw new Error('readBinaryFile not available');
    }
    const contents = await readBinaryFile(url, { dir });
    return uint8ArrayToDataURL(contents);
  })();
  
  return loadCache[url];
}

/**
 * Creates a file resolver function for a given subpath
 * @param subpath - The base path for resolving files
 * @returns Function that resolves relative URLs
 */
const fileResolver = (subpath: string): FileResolverFunction => 
  (url: string) => resolveFileURL(subpath.endsWith('/') ? subpath + url : subpath + '/' + url);

/**
 * Plays an audio file from the file system
 * @param path - Path to the audio file
 */
export async function playFile(path: string): Promise<void> {
  const url = await resolveFileURL(path);
  const ac = getAudioContext();
  const bufferSource = ac.createBufferSource();
  bufferSource.buffer = await loadBuffer(url, ac);
  bufferSource.connect(ac.destination);
  bufferSource.start(ac.currentTime);
}