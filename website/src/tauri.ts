import { invoke } from '@tauri-apps/api/core';

// Type definitions for Tauri
declare global {
  interface Window {
    __TAURI_IPC__?: any;
  }
}

export const Invoke = invoke;

/**
 * Checks if the application is running in Tauri environment
 * @returns True if running in Tauri, false otherwise
 */
export const isTauri = (): boolean => window.__TAURI_IPC__ != null;