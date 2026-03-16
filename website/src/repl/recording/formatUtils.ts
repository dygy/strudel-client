/**
 * Format utilities for the audio recorder feature.
 */

/**
 * Formats elapsed seconds as MM:SS with zero-padding.
 * e.g., 0 → "00:00", 61 → "01:01", 3599 → "59:59", 3600 → "60:00"
 */
export function formatElapsedTime(seconds: number): string {
  const totalSeconds = Math.floor(seconds);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Generates a filename matching pattern `strudel-recording-YYYY-MM-DD-HHmmss.{ext}`
 * with zero-padded date components.
 */
export function generateFilename(date: Date, format: 'wav' | 'mp3'): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `strudel-recording-${y}-${mo}-${d}-${h}${mi}${s}.${format}`;
}

/**
 * Generates a filename matching pattern `strudel-screen-YYYY-MM-DD-HHmmss.webm`
 * with zero-padded date components.
 */
export function generateScreenFilename(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `strudel-screen-${y}-${mo}-${d}-${h}${mi}${s}.webm`;
}
