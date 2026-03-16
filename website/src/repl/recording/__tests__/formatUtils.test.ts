import { describe, it, expect } from 'vitest';
import { formatElapsedTime, generateFilename, generateScreenFilename } from '../formatUtils';

describe('formatElapsedTime', () => {
  it('formats 0 seconds as 00:00', () => {
    expect(formatElapsedTime(0)).toBe('00:00');
  });

  it('formats 61 seconds as 01:01', () => {
    expect(formatElapsedTime(61)).toBe('01:01');
  });

  it('formats 3599 seconds as 59:59', () => {
    expect(formatElapsedTime(3599)).toBe('59:59');
  });

  it('formats 3600 seconds as 60:00', () => {
    expect(formatElapsedTime(3600)).toBe('60:00');
  });

  it('zero-pads single-digit minutes and seconds', () => {
    expect(formatElapsedTime(5)).toBe('00:05');
    expect(formatElapsedTime(65)).toBe('01:05');
  });

  it('floors fractional seconds', () => {
    expect(formatElapsedTime(61.9)).toBe('01:01');
  });
});

describe('generateFilename', () => {
  it('generates correct filename for a wav format', () => {
    const date = new Date(2025, 0, 15, 9, 5, 3); // Jan 15, 2025 09:05:03
    expect(generateFilename(date, 'wav')).toBe('strudel-recording-2025-01-15-090503.wav');
  });

  it('generates correct filename for an mp3 format', () => {
    const date = new Date(2025, 11, 31, 23, 59, 59); // Dec 31, 2025 23:59:59
    expect(generateFilename(date, 'mp3')).toBe('strudel-recording-2025-12-31-235959.mp3');
  });

  it('zero-pads all date components', () => {
    const date = new Date(2025, 0, 1, 0, 0, 0); // Jan 1, 2025 00:00:00
    expect(generateFilename(date, 'wav')).toBe('strudel-recording-2025-01-01-000000.wav');
  });
});

describe('generateScreenFilename', () => {
  it('generates correct filename with strudel-screen prefix and .webm extension', () => {
    const date = new Date(2025, 0, 15, 9, 5, 3); // Jan 15, 2025 09:05:03
    expect(generateScreenFilename(date)).toBe('strudel-screen-2025-01-15-090503.webm');
  });

  it('zero-pads all date components', () => {
    const date = new Date(2025, 0, 1, 0, 0, 0); // Jan 1, 2025 00:00:00
    expect(generateScreenFilename(date)).toBe('strudel-screen-2025-01-01-000000.webm');
  });

  it('handles end-of-year date correctly', () => {
    const date = new Date(2025, 11, 31, 23, 59, 59); // Dec 31, 2025 23:59:59
    expect(generateScreenFilename(date)).toBe('strudel-screen-2025-12-31-235959.webm');
  });
});
