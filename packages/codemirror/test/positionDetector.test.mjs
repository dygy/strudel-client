import { describe, it, expect } from 'vitest';
import { PatternPositionDetector } from '../positionDetector.mjs';

describe('PatternPositionDetector', () => {
  const detector = new PatternPositionDetector();

  describe('detectPositionType', () => {
    it('should detect sample_name at start', () => {
      const type = detector.detectPositionType('bd hh', 0);
      expect(type).toBe('sample_name');
    });

    it('should detect sample_name after space', () => {
      const type = detector.detectPositionType('bd hh', 3);
      expect(type).toBe('sample_name');
    });

    it('should detect sample_number after first colon', () => {
      const type = detector.detectPositionType('bd:0', 3);
      expect(type).toBe('sample_number');
    });

    it('should detect gain after second colon', () => {
      const type = detector.detectPositionType('bd:0:0.5', 6);
      expect(type).toBe('gain');
    });

    it('should detect euclidean_param inside parentheses', () => {
      const type = detector.detectPositionType('bd(3,8)', 4);
      expect(type).toBe('euclidean_param');
    });

    it('should detect weight after @', () => {
      const type = detector.detectPositionType('bd@3', 3);
      expect(type).toBe('weight');
    });

    it('should detect sample_name in nested brackets', () => {
      const type = detector.detectPositionType('[bd hh]', 4);
      expect(type).toBe('sample_name');
    });
  });

  describe('getCurrentElement', () => {
    it('should get element at start', () => {
      const element = detector.getCurrentElement('bd hh cp', 0);
      expect(element.start).toBe(0);
      expect(element.text).toBe('bd');
      expect(element.type).toBe('sample_name');
    });

    it('should get element in middle', () => {
      const element = detector.getCurrentElement('bd hh cp', 4);
      expect(element.start).toBe(3);
      expect(element.text).toBe('hh');
      expect(element.type).toBe('sample_name');
    });

    it('should get element at end', () => {
      const element = detector.getCurrentElement('bd hh cp', 8);
      expect(element.start).toBe(6);
      expect(element.text).toBe('cp');
      expect(element.type).toBe('sample_name');
    });

    it('should get element with colon syntax', () => {
      const element = detector.getCurrentElement('bd:0:0.5 hh', 4);
      expect(element.start).toBe(0);
      expect(element.text).toBe('bd:0:0.5');
      expect(element.type).toBe('sample_number');
    });

    it('should get element inside brackets', () => {
      const element = detector.getCurrentElement('[bd hh]', 4);
      expect(element.start).toBe(4);
      expect(element.text).toBe('hh');
      expect(element.type).toBe('sample_name');
    });

    it('should get element with euclidean rhythm', () => {
      const element = detector.getCurrentElement('bd(3,8) hh', 4);
      expect(element.start).toBe(0);
      expect(element.text).toBe('bd(3,8)');
      expect(element.type).toBe('euclidean_param');
    });

    it('should get element with weight', () => {
      const element = detector.getCurrentElement('bd@3 hh', 3);
      expect(element.start).toBe(0);
      expect(element.text).toBe('bd@3');
      expect(element.type).toBe('weight');
    });
  });

  describe('isAfterSeparator', () => {
    it('should return true at start', () => {
      expect(detector.isAfterSeparator('bd hh', 0)).toBe(true);
    });

    it('should return true after space', () => {
      expect(detector.isAfterSeparator('bd hh', 3)).toBe(true);
    });

    it('should return true after comma', () => {
      expect(detector.isAfterSeparator('bd,hh', 3)).toBe(true);
    });

    it('should return true after opening bracket', () => {
      expect(detector.isAfterSeparator('[bd', 1)).toBe(true);
    });

    it('should return true after opening angle bracket', () => {
      expect(detector.isAfterSeparator('<bd', 1)).toBe(true);
    });

    it('should return true after opening brace', () => {
      expect(detector.isAfterSeparator('{bd', 1)).toBe(true);
    });

    it('should return false in middle of element', () => {
      expect(detector.isAfterSeparator('bd hh', 1)).toBe(false);
    });

    it('should return false after colon', () => {
      expect(detector.isAfterSeparator('bd:0', 3)).toBe(false);
    });
  });

  describe('position detection - sample_name contexts', () => {
    it('should detect sample_name in simple pattern', () => {
      expect(detector.detectPositionType('bd hh cp', 0)).toBe('sample_name');
      expect(detector.detectPositionType('bd hh cp', 3)).toBe('sample_name');
      expect(detector.detectPositionType('bd hh cp', 6)).toBe('sample_name');
    });

    it('should detect sample_name after comma', () => {
      expect(detector.detectPositionType('bd,hh,cp', 3)).toBe('sample_name');
      expect(detector.detectPositionType('bd,hh,cp', 6)).toBe('sample_name');
    });

    it('should detect sample_name in brackets', () => {
      expect(detector.detectPositionType('[bd hh]', 1)).toBe('sample_name');
      expect(detector.detectPositionType('[bd hh]', 4)).toBe('sample_name');
    });

    it('should detect sample_name in angle brackets', () => {
      expect(detector.detectPositionType('<bd hh>', 1)).toBe('sample_name');
      expect(detector.detectPositionType('<bd hh>', 4)).toBe('sample_name');
    });

    it('should detect sample_name in braces', () => {
      expect(detector.detectPositionType('{bd hh, cp sd}', 1)).toBe('sample_name');
      expect(detector.detectPositionType('{bd hh, cp sd}', 4)).toBe('sample_name');
      expect(detector.detectPositionType('{bd hh, cp sd}', 8)).toBe('sample_name');
    });
  });

  describe('position detection - colon syntax', () => {
    it('should detect sample_name before colon', () => {
      expect(detector.detectPositionType('bd:0', 1)).toBe('sample_name');
    });

    it('should detect sample_number after first colon', () => {
      expect(detector.detectPositionType('bd:0', 3)).toBe('sample_number');
      expect(detector.detectPositionType('bd:0', 4)).toBe('sample_number');
    });

    it('should detect gain after second colon', () => {
      expect(detector.detectPositionType('bd:0:0.5', 5)).toBe('gain');
      expect(detector.detectPositionType('bd:0:0.5', 8)).toBe('gain');
    });

    it('should handle multiple elements with colons', () => {
      expect(detector.detectPositionType('bd:0 hh:1', 3)).toBe('sample_number');
      expect(detector.detectPositionType('bd:0 hh:1', 8)).toBe('sample_number');
    });

    it('should handle colon syntax with comma', () => {
      expect(detector.detectPositionType('bd:0,hh:1', 3)).toBe('sample_number');
      expect(detector.detectPositionType('bd:0,hh:1', 8)).toBe('sample_number');
    });
  });

  describe('position detection - euclidean rhythm', () => {
    it('should detect euclidean_param inside parentheses', () => {
      expect(detector.detectPositionType('bd(3,8)', 3)).toBe('euclidean_param');
      expect(detector.detectPositionType('bd(3,8)', 4)).toBe('euclidean_param');
      expect(detector.detectPositionType('bd(3,8)', 6)).toBe('euclidean_param');
    });

    it('should detect sample_name before parentheses', () => {
      expect(detector.detectPositionType('bd(3,8)', 1)).toBe('sample_name');
    });

    it('should detect sample_name after parentheses', () => {
      expect(detector.detectPositionType('bd(3,8) hh', 8)).toBe('sample_name');
    });

    it('should handle euclidean with colon syntax', () => {
      expect(detector.detectPositionType('bd:0(3,8)', 4)).toBe('euclidean_param');
    });
  });

  describe('position detection - weight syntax', () => {
    it('should detect weight after @', () => {
      expect(detector.detectPositionType('bd@3', 3)).toBe('weight');
      expect(detector.detectPositionType('bd@3', 4)).toBe('weight');
    });

    it('should detect sample_name before @', () => {
      expect(detector.detectPositionType('bd@3', 1)).toBe('sample_name');
    });

    it('should detect sample_name after weight', () => {
      expect(detector.detectPositionType('bd@3 hh', 5)).toBe('sample_name');
    });

    it('should handle weight with multiple elements', () => {
      expect(detector.detectPositionType('bd@3 hh@1', 3)).toBe('weight');
      expect(detector.detectPositionType('bd@3 hh@1', 8)).toBe('weight');
    });
  });

  describe('position detection - complex patterns', () => {
    it('should handle nested brackets', () => {
      expect(detector.detectPositionType('[bd [hh cp]]', 5)).toBe('sample_name');
      expect(detector.detectPositionType('[bd [hh cp]]', 8)).toBe('sample_name');
    });

    it('should handle mixed syntax', () => {
      expect(detector.detectPositionType('bd:0:0.5 [hh(3,8) cp@2]', 3)).toBe('sample_number');
      expect(detector.detectPositionType('bd:0:0.5 [hh(3,8) cp@2]', 13)).toBe('euclidean_param');
      expect(detector.detectPositionType('bd:0:0.5 [hh(3,8) cp@2]', 21)).toBe('weight');
    });

    it('should handle real-world example', () => {
      const pattern = 'pulse:1200,gm_church_organ:800 sin';
      expect(detector.detectPositionType(pattern, 6)).toBe('sample_number');
      expect(detector.detectPositionType(pattern, 11)).toBe('sample_name');
      expect(detector.detectPositionType(pattern, 27)).toBe('sample_number');
      expect(detector.detectPositionType(pattern, 31)).toBe('sample_name');
    });
  });

  describe('edge cases', () => {
    it('should handle empty string', () => {
      const element = detector.getCurrentElement('', 0);
      expect(element.start).toBe(0);
      expect(element.text).toBe('');
    });

    it('should handle single character', () => {
      const element = detector.getCurrentElement('b', 0);
      expect(element.start).toBe(0);
      expect(element.text).toBe('b');
    });

    it('should handle position at end', () => {
      const element = detector.getCurrentElement('bd hh', 5);
      expect(element.start).toBe(3);
      expect(element.text).toBe('hh');
    });

    it('should handle multiple spaces', () => {
      expect(detector.isAfterSeparator('bd  hh', 3)).toBe(true);
      expect(detector.isAfterSeparator('bd  hh', 4)).toBe(true);
    });

    it('should handle trailing space', () => {
      const element = detector.getCurrentElement('bd hh ', 6);
      expect(element.start).toBe(6);
      expect(element.text).toBe('');
    });
  });
});
