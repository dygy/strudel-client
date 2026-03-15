/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { FormatEngine, type PrettierOptions } from '../formatEngine';

describe('User code formatting test', () => {
  it('should format the full user code', async () => {
    const formatEngine = FormatEngine.getInstance();
    const options: PrettierOptions = {
      tabWidth: 2,
      useTabs: false,
      semi: true,
      singleQuote: true,
      quoteProps: 'as-needed',
      trailingComma: 'es5',
      bracketSpacing: true,
      arrowParens: 'always',
      printWidth: 80,
    };

    const code = `// await samples({ drum: 'https://cdn.freesound.org/previews/803/803889_17187546-lq.mp3' })
let chords = arrange([16, "<Cm7!4 [Bb7 Ab^7 G7b9!2]@4>"],
[32, "<Dm!4 Em7b5!2 A7b9!2>"]).chord()
setcpm(70)
stack(
stack(
// pad
chords.dict('ireal-ext').set.mix(offset("<0!3 [1 2 1 4]>")).voicing()
.s("<gm_fx_goblins gm_accordion gm_bagpipe>*2").color("pink")
.clip(.9).delay(.6).attack(.3).add(note("0,.1"))
.lpf(sine.range(100,200).slow(8)).lpq(4).gain(.4).pan(.4)
.mask("<1!32 0!16>")
//.hush()
,
// bass
chords.rootNotes("1").s("<bass_drum_1 gm_contrabass>")
.lpf(perlin.range(400,600)).lpq(2).ply("<2 4>")
.late("<0 <.125 .25>>")
.sometimesBy("0 .5@3",x=>x.add(note("11.9")))
.attack(".02 .001@3").sustain(.2).clip(.5).shape(.5)
.add(note("0,.1")).color("green").gain(.5).late(.008)
.mask("<0!16 1!32>")
//.hush()
,
// arpeggios
n(run(12).slow(4).sub("<0 1 2 3>")).set(chords).voicing()
.clip(sine.range(1,3).slow(16)).add.squeeze(note("0 -12"))
.color('yellow').room(.9).jux(rev).s("gm_church_organ")
.hpf(perlin.range(800,2000)).hpq(4)
.mask("<0!8 1!32 0!8>").pan(.6).gain(.5)
//.hush()
,
// latin piano
n("<0 5 2 1>*<3 4>".add("<4 3>/64")).set(chords).voicing()
.clip(perlin.range(.4, .8)).color("purple").juxBy(.5,rev)
.s('gm_bagpipe').delay(.4)
.lpf(perlin.range(300,6000).slow(4)).lpq(8).room(.8)
.gain(rand.range(.4,.7))
.mask("<0!32 1!32>")
//.hush()
).add(note(perlin.range(0,.4)))
,
// drums
stack(
s("bd*<2!3 [2 4]>").bank('<EmuSP12 AlesisSR16>').speed(.8).gain(0.5),
s("~ rim:1").bank("<rolandddr30>").late(".005!3").speed("<.5 .95>/16")
.color("orange").lastOf(8, ply("~ [2 4]")),
s("[~ hh*2]*2").bank('rolandddr30').gain(saw.range(.2, .6))
.color("red").late(.003).mask("<1!32 0!16>")
.juxBy(.25, rev).end(sine.range(.06,.2).slow(16))
.release(.02).speed(.9).lpf(saw.range(1000,2000).slow(4)).room(.5)
).off(1/8,x=>x.mul(speed(.5)).gain(.25).degrade().hpf(300).mul(end(.5)))
.mask("<1!32 0!7 1>").color("wheat").late("[0 .003]*4")
).jux(rev)
//.punchcard({fold: 0.6})`;

    const result = await formatEngine.formatCode(code, options);
    expect(result.success).toBe(true);
    // Write to file so we can inspect the output
    const fs = await import('fs');
    fs.writeFileSync('/tmp/formatted-output.txt', result.formattedCode || '');
    expect(result.formattedCode).toBeDefined();
  });
});
