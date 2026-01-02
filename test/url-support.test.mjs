import { describe, it, expect } from 'vitest';
import { transpiler } from '../packages/transpiler/transpiler.mjs';

describe('URL Support in Transpiler', () => {
  it('should not convert URL strings to mini notation', () => {
    const code = `
      samples({ 
        rhodes: "https://cdn.freesound.org/previews/132/132051_316502-lq.mp3",
        kick: "http://example.com/kick.wav",
        snare: "ftp://files.example.com/snare.wav"
      })
    `;
    
    const result = transpiler(code, { emitMiniLocations: false });
    
    // URLs should remain as regular strings (may use single quotes in output)
    expect(result.output).toContain('https://cdn.freesound.org/previews/132/132051_316502-lq.mp3');
    expect(result.output).toContain('http://example.com/kick.wav');
    expect(result.output).toContain('ftp://files.example.com/snare.wav');
    
    // Should not contain mini notation calls for URLs
    expect(result.output).not.toContain('m(\'https://');
    expect(result.output).not.toContain('m(\'http://');
    expect(result.output).not.toContain('m(\'ftp://');
  });

  it('should still convert regular strings to mini notation', () => {
    const code = `
      s("bd hh cp hh")
    `;
    
    const result = transpiler(code, { emitMiniLocations: false });
    
    // Regular mini notation strings should still be converted
    expect(result.output).toContain('m(\'bd hh cp hh\'');
  });

  it('should handle mixed URLs and mini notation', () => {
    const code = `
      await samples({ 
        rhodes: "https://cdn.freesound.org/previews/132/132051_316502-lq.mp3" 
      })
      
      s("bd hh cp hh").sound("rhodes")
    `;
    
    const result = transpiler(code, { emitMiniLocations: false });
    
    // URL should remain as string
    expect(result.output).toContain('https://cdn.freesound.org/previews/132/132051_316502-lq.mp3');
    expect(result.output).not.toContain('m(\'https://');
    
    // Mini notation should be converted
    expect(result.output).toContain('m(\'bd hh cp hh\'');
    expect(result.output).toContain('m(\'rhodes\'');
  });

  it('should detect various URL schemes', () => {
    const urlSchemes = [
      'https://example.com/file.mp3',
      'http://example.com/file.wav',
      'ftp://files.example.com/sound.ogg',
      'file:///local/path/sound.mp3',
      'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEA',
      'blob:https://example.com/12345678-1234-1234-1234-123456789012',
      '//cdn.example.com/sound.mp3'
    ];

    urlSchemes.forEach(url => {
      const code = `samples({ test: "${url}" })`;
      const result = transpiler(code, { emitMiniLocations: false });
      
      // URL should remain as string (not converted to mini notation)
      expect(result.output).toContain(url);
      expect(result.output).not.toContain(`m('${url}'`);
      expect(result.output).not.toContain(`m("${url}"`);
    });
  });

  it('should not affect non-URL strings with forward slashes', () => {
    const code = `
      s("bd/2 hh cp/4 hh")
    `;
    
    const result = transpiler(code, { emitMiniLocations: false });
    
    // Non-URL strings with slashes should still be converted to mini notation
    expect(result.output).toContain('m(\'bd/2 hh cp/4 hh\'');
  });
});