import { describe, it, expect } from 'vitest';
import { formatEngine } from '../website/src/repl/formatEngine.ts';

describe('Strudel Code Detection', () => {
  it('should detect Strudel code and apply Strudel-specific formatting', async () => {
    const strudelCode = `
setcps(160/60/4)
samples({ loopAmen02: 'https://cdn.freesound.org/previews/128/128418_615581-lq.mp3' })

$: n("<0 1 2 3 4>*8").scale('G4 minor').s("triangle").room(1).sustain(1.5).gain(0.3)
   .lpf(700).clip(sine.range(.2,.8).slow(3)).sometimes(add(note("16")))

electroLead: note("[c5 e5 g5 b5]@3 [d5 f5 a5 c6]@3 [g4 b4 d5 f5]@3")
  .s("drum").euclidRot(8,16,14).gain(0.6).speed(5).lpf(600).crush(8)
  .pan(sine.range(-0.10, 0.10).slow(50)).room(0.8).color("#f0a")
  ._pianoroll({ labels: 1, cycles: 2 })
`;

    const options = {
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: false,
      quoteProps: 'as-needed',
      trailingComma: 'es5',
      bracketSpacing: true,
      arrowParens: 'always',
      printWidth: 80,
    };

    const result = await formatEngine.formatCode(strudelCode, options);
    
    expect(result.success).toBe(true);
    expect(result.formattedCode).not.toBe(strudelCode); // Should be formatted
    expect(result.formattedCode).toContain('setcps(160 / 60 / 4)'); // Should have proper spacing
    expect(result.formattedCode).toContain('samples({ loopAmen02:'); // Should preserve DSL syntax
  });

  it('should format regular JavaScript code normally', async () => {
    const jsCode = `
const x=1;
function test(){
return x+1;
}
`;

    const options = {
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: false,
      quoteProps: 'as-needed',
      trailingComma: 'es5',
      bracketSpacing: true,
      arrowParens: 'always',
      printWidth: 80,
    };

    const result = await formatEngine.formatCode(jsCode, options);
    
    expect(result.success).toBe(true);
    expect(result.formattedCode).not.toBe(jsCode); // Should be formatted
    expect(result.formattedCode).toContain('const x = 1;'); // Should be properly formatted
  });

  it('should detect various Strudel patterns and format them', async () => {
    const strudelPatterns = [
      '$: sound("bd")',
      'samples({ kick: "url" })',
      'note("c4").s("piano")',
      'setcps(120/60/4)',
      'initHydra()',
      'n("<0 1 2>").scale("major")',
      'sound("bd").gain(0.5).room(0.3)',
      '._pianoroll({ labels: 1 })',
      '.euclidRot(8,16,14)',
      'sine.range(0.2, 0.8)',
      'perlin.range(200, 2000)',
      'shape(3).rotate(0.5).color(1,0,0)',
      'osc(10).kaleid(4).out()',
    ];

    const options = {
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: false,
      quoteProps: 'as-needed',
      trailingComma: 'es5',
      bracketSpacing: true,
      arrowParens: 'always',
      printWidth: 80,
    };

    for (const pattern of strudelPatterns) {
      const result = await formatEngine.formatCode(pattern, options);
      expect(result.success).toBe(true);
      expect(result.formattedCode).toBeDefined(); // Should be formatted (not skipped)
    }
  });
});