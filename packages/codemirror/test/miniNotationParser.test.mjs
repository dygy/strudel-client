import { describe, it, expect } from 'vitest';
import { MiniNotationContextParser } from '../miniNotationParser.mjs';

describe('MiniNotationContextParser', () => {
  const parser = new MiniNotationContextParser();

  describe('findSeparators', () => {
    it('should find spaces as separators', () => {
      const separators = parser.findSeparators('bd hh cp');
      expect(separators).toEqual([2, 5]);
    });

    it('should find commas as separators', () => {
      const separators = parser.findSeparators('bd,hh,cp');
      expect(separators).toEqual([2, 5]);
    });

    it('should find mixed separators', () => {
      const separators = parser.findSeparators('bd hh,cp sd');
      expect(separators).toEqual([2, 5, 8]);
    });

    it('should ignore separators inside brackets', () => {
      const separators = parser.findSeparators('bd [hh cp] sd');
      expect(separators).toEqual([2, 10]);
    });

    it('should ignore separators inside angle brackets', () => {
      const separators = parser.findSeparators('bd <hh cp> sd');
      expect(separators).toEqual([2, 10]);
    });

    it('should ignore separators inside braces', () => {
      const separators = parser.findSeparators('bd {hh cp} sd');
      expect(separators).toEqual([2, 10]);
    });

    it('should handle nested brackets', () => {
      const separators = parser.findSeparators('bd [hh [cp sd]] sn');
      expect(separators).toEqual([2, 15]);
    });

    it('should ignore separators inside parentheses', () => {
      const separators = parser.findSeparators('bd(3,8) hh');
      expect(separators).toEqual([7]);
    });

    it('should handle empty string', () => {
      const separators = parser.findSeparators('');
      expect(separators).toEqual([]);
    });

    it('should handle string with no separators', () => {
      const separators = parser.findSeparators('bd');
      expect(separators).toEqual([]);
    });
  });

  describe('analyzeColonContext', () => {
    it('should detect no colon syntax', () => {
      const context = parser.analyzeColonContext('bd hh', 2);
      expect(context).toEqual({
        inColonSyntax: false,
        colonPosition: -1,
        parameterIndex: 0
      });
    });

    it('should detect colon syntax with one colon', () => {
      const context = parser.analyzeColonContext('bd:0', 4);
      expect(context.inColonSyntax).toBe(true);
      expect(context.colonPosition).toBe(2);
      expect(context.parameterIndex).toBe(1);
    });

    it('should detect colon syntax with two colons', () => {
      const context = parser.analyzeColonContext('bd:0:0.5', 8);
      expect(context.inColonSyntax).toBe(true);
      expect(context.parameterIndex).toBe(2);
    });

    it('should handle position before colon', () => {
      const context = parser.analyzeColonContext('bd:0', 2);
      expect(context.inColonSyntax).toBe(false);
    });

    it('should handle position after first colon', () => {
      const context = parser.analyzeColonContext('bd:0', 3);
      expect(context.inColonSyntax).toBe(true);
      expect(context.parameterIndex).toBe(1);
    });

    it('should handle multiple elements with colons', () => {
      const context = parser.analyzeColonContext('bd:0 hh:1', 9);
      expect(context.inColonSyntax).toBe(true);
      expect(context.parameterIndex).toBe(1);
    });

    it('should handle colon syntax after comma', () => {
      const context = parser.analyzeColonContext('bd:0,hh:1', 9);
      expect(context.inColonSyntax).toBe(true);
      expect(context.parameterIndex).toBe(1);
    });
  });

  describe('parseContext - simple patterns', () => {
    it('should parse simple space-separated pattern', () => {
      const context = parser.parseContext('bd hh cp', 3);
      expect(context.elementStart).toBe(3);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
      expect(context.inColonSyntax).toBe(false);
      expect(context.nestingDepth).toBe(0);
    });

    it('should parse pattern with cursor in middle of element', () => {
      const context = parser.parseContext('bd hh cp', 4);
      expect(context.elementStart).toBe(3);
      expect(context.fragment).toBe('h');
      expect(context.contextType).toBe('sample_name');
    });

    it('should parse pattern at start', () => {
      const context = parser.parseContext('bd hh cp', 0);
      expect(context.elementStart).toBe(0);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });

    it('should parse pattern at end', () => {
      const context = parser.parseContext('bd hh cp', 8);
      expect(context.elementStart).toBe(6);
      expect(context.fragment).toBe('cp');
      expect(context.contextType).toBe('sample_name');
    });
  });

  describe('parseContext - colon syntax', () => {
    it('should parse colon syntax at sample position', () => {
      const context = parser.parseContext('bd:0:0.5', 2);
      expect(context.elementStart).toBe(0);
      expect(context.fragment).toBe('bd');
      expect(context.contextType).toBe('sample_name');
      expect(context.inColonSyntax).toBe(false);
    });

    it('should parse colon syntax at number position', () => {
      const context = parser.parseContext('bd:0:0.5', 4);
      expect(context.elementStart).toBe(0);
      expect(context.fragment).toBe('bd:0');
      expect(context.contextType).toBe('sample_number');
      expect(context.inColonSyntax).toBe(true);
      expect(context.parameterIndex).toBe(1);
    });

    it('should parse colon syntax at gain position', () => {
      const context = parser.parseContext('bd:0:0.5', 8);
      expect(context.elementStart).toBe(0);
      expect(context.fragment).toBe('bd:0:0.5');
      expect(context.contextType).toBe('gain');
      expect(context.inColonSyntax).toBe(true);
      expect(context.parameterIndex).toBe(2);
    });

    it('should parse multiple colon elements', () => {
      const context = parser.parseContext('bd:0 hh:1', 9);
      expect(context.elementStart).toBe(5);
      expect(context.fragment).toBe('hh:1');
      expect(context.contextType).toBe('sample_number');
    });

    it('should parse colon syntax with comma separator', () => {
      const context = parser.parseContext('pulse:1200,gm_', 14);
      expect(context.elementStart).toBe(11);
      expect(context.fragment).toBe('gm_');
      expect(context.contextType).toBe('sample_name');
      expect(context.inColonSyntax).toBe(false);
    });
  });

  describe('parseContext - nested brackets', () => {
    it('should parse inside square brackets', () => {
      const context = parser.parseContext('[bd hh]', 4);
      expect(context.elementStart).toBe(4);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
      expect(context.nestingDepth).toBe(1);
    });

    it('should parse nested square brackets', () => {
      const context = parser.parseContext('[bd [hh cp]]', 8);
      expect(context.elementStart).toBe(8);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
      expect(context.nestingDepth).toBe(2);
    });

    it('should parse after closing bracket', () => {
      const context = parser.parseContext('[bd hh] cp', 8);
      expect(context.elementStart).toBe(8);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
      expect(context.nestingDepth).toBe(0);
    });
  });

  describe('parseContext - angle brackets', () => {
    it('should parse inside angle brackets', () => {
      const context = parser.parseContext('<bd hh>', 4);
      expect(context.elementStart).toBe(4);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
      expect(context.nestingDepth).toBe(1);
    });

    it('should parse multiple elements in angle brackets', () => {
      const context = parser.parseContext('<bd hh cp>', 7);
      expect(context.elementStart).toBe(7);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });
  });

  describe('parseContext - polymeter (braces)', () => {
    it('should parse inside braces', () => {
      const context = parser.parseContext('{bd hh, cp sd}', 4);
      expect(context.elementStart).toBe(4);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
      expect(context.nestingDepth).toBe(1);
    });

    it('should parse after comma in braces', () => {
      const context = parser.parseContext('{bd hh, cp sd}', 8);
      expect(context.elementStart).toBe(8);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });
  });

  describe('parseContext - euclidean rhythm', () => {
    it('should detect euclidean parameter context', () => {
      const context = parser.parseContext('bd(3,8)', 4);
      expect(context.contextType).toBe('euclidean_param');
    });

    it('should detect euclidean parameter after comma', () => {
      const context = parser.parseContext('bd(3,8)', 6);
      expect(context.contextType).toBe('euclidean_param');
    });

    it('should parse after euclidean rhythm', () => {
      const context = parser.parseContext('bd(3,8) hh', 8);
      expect(context.elementStart).toBe(8);
      expect(context.contextType).toBe('sample_name');
    });
  });

  describe('parseContext - weight syntax', () => {
    it('should detect weight context', () => {
      const context = parser.parseContext('bd@3', 4);
      expect(context.contextType).toBe('weight');
    });

    it('should parse after weight', () => {
      const context = parser.parseContext('bd@3 hh', 5);
      expect(context.elementStart).toBe(5);
      expect(context.contextType).toBe('sample_name');
    });
  });

  describe('parseContext - special characters', () => {
    it('should handle silence (~)', () => {
      const context = parser.parseContext('bd ~ hh', 5);
      expect(context.elementStart).toBe(5);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });

    it('should handle rest (-)', () => {
      const context = parser.parseContext('bd - hh', 5);
      expect(context.elementStart).toBe(5);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });
  });

  describe('parseContext - edge cases', () => {
    it('should handle empty string', () => {
      const context = parser.parseContext('', 0);
      expect(context.elementStart).toBe(0);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });

    it('should handle single character', () => {
      const context = parser.parseContext('b', 1);
      expect(context.elementStart).toBe(0);
      expect(context.fragment).toBe('b');
      expect(context.contextType).toBe('sample_name');
    });

    it('should handle multiple spaces', () => {
      const context = parser.parseContext('bd  hh', 4);
      expect(context.elementStart).toBe(4);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });

    it('should handle trailing space', () => {
      const context = parser.parseContext('bd hh ', 6);
      expect(context.elementStart).toBe(6);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });

    it('should handle leading space', () => {
      const context = parser.parseContext(' bd hh', 1);
      expect(context.elementStart).toBe(1);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });
  });

  describe('parseContext - complex patterns', () => {
    it('should parse complex nested pattern', () => {
      const context = parser.parseContext('[bd [hh cp]] <sd sn>', 17);
      expect(context.elementStart).toBe(17);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
      expect(context.nestingDepth).toBe(1);
    });

    it('should parse pattern with all features', () => {
      const context = parser.parseContext('bd:0:0.5 [hh(3,8) cp@2] <sd sn>', 24);
      expect(context.elementStart).toBe(24);
      expect(context.fragment).toBe('');
      expect(context.contextType).toBe('sample_name');
    });

    it('should parse real-world example from requirements', () => {
      const context = parser.parseContext('pulse:1200,gm_church_organ:800 sin', 14);
      expect(context.elementStart).toBe(11);
      expect(context.fragment).toBe('gm_');
      expect(context.contextType).toBe('sample_name');
    });
  });
});
