import useEvent from '@src/useEvent';
import useFrame from '@src/useFrame';
import { getAudioContext } from '@strudel/webaudio';
import { midi2note } from '@strudel/core';
import { useState, useRef, useEffect } from 'react';
import Claviature from '@components/Claviature';
import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
}

const Button = (props: ButtonProps) => (
  <button {...props} className="bg-lineHighlight p-2 rounded-md color-foreground" />
);

function plotValues(ctx: CanvasRenderingContext2D, values: number[], min: number, max: number, color: string) {
  const { width, height } = ctx.canvas;
  ctx.strokeStyle = color;
  const thickness = 8;
  ctx.lineWidth = thickness;
  ctx.beginPath();

  const x = (f: number) => ((f - min) / (max - min)) * width;
  const y = (i: number) => (1 - i / values.length) * height;
  values.forEach((f, i) => {
    ctx.lineTo(x(f), y(i));
  });
  ctx.stroke();
}

function getColor(cssVariable: string): string {
  if (typeof document === 'undefined') {
    return 'white';
  }
  const dummyElement = document.createElement('div');
  dummyElement.style.color = cssVariable;
  // Append the dummy element to the document body
  document.body.appendChild(dummyElement);
  // Get the computed style of the dummy element
  const styles = getComputedStyle(dummyElement);
  // Get the value of the CSS variable
  const color = styles.getPropertyValue(cssVariable);
  document.body.removeChild(dummyElement);
  return color;
}

const pitchColor = '#eab308';
const frequencyColor = '#3b82f6';

interface PitchSliderProps {
  buttons?: number[];
  animatable?: boolean;
  plot?: boolean;
  showPitchSlider?: boolean;
  showFrequencySlider?: boolean;
  pitchStep?: string;
  min?: number;
  max?: number;
  initial?: number;
  baseFrequency?: number;
  zeroOffset?: number;
  claviature?: boolean;
}

export function PitchSlider({
  buttons = [],
  animatable = false,
  plot = false,
  showPitchSlider = false,
  showFrequencySlider = false,
  pitchStep = '0.001',
  min = 55,
  max = 7040,
  initial = 220,
  baseFrequency = min,
  zeroOffset = 0,
  claviature,
}: PitchSliderProps) {
  const oscRef = useRef<OscillatorNode | null>(null);
  const activeRef = useRef<boolean>(false);
  const freqRef = useRef<number>(initial);
  const historyRef = useRef<number[]>([freqRef.current]);
  const frameRef = useRef<number>(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hz, setHz] = useState(freqRef.current);

  useEffect(() => {
    freqRef.current = hz;
  }, [hz]);

  useEvent('mouseup', () => {
    oscRef.current?.stop();
    activeRef.current = false;
  });

  const freqSlider2freq = (progress: number) => min + progress * (max - min);
  const pitchSlider2freq = (progress: number) => min * 2 ** (progress * Math.log2(max / min));
  const freq2freqSlider = (freq: number) => (freq - min) / (max - min);
  const freq2pitchSlider = (freq: number) => {
    const [minOct, maxOct] = [Math.log2(min), Math.log2(max)];
    return (Math.log2(freq) - minOct) / (maxOct - minOct);
  };

  const freqSlider = freq2freqSlider(hz);
  const pitchSlider = freq2pitchSlider(hz);

  const startOsc = (hz: number) => {
    if (oscRef.current) {
      oscRef.current.stop();
    }
    oscRef.current = getAudioContext().createOscillator();
    oscRef.current.frequency.value = hz;
    oscRef.current.connect(getAudioContext().destination);
    oscRef.current.start();
    activeRef.current = true;
    setHz(hz);
  };

  const startSweep = (exp = false) => {
    let f = min;
    startOsc(f);
    const frame = () => {
      if (f < max) {
        if (!exp) {
          f += 10;
        } else {
          f *= 1.01;
        }
        if (oscRef.current) {
          oscRef.current.frequency.value = f;
        }
        frameRef.current = requestAnimationFrame(frame);
      } else {
        oscRef.current?.stop();
        if (frameRef.current) {
          cancelAnimationFrame(frameRef.current);
        }
      }
      setHz(f);
    };
    requestAnimationFrame(frame);
  };

  useFrame(() => {
    historyRef.current.push(freqRef.current);
    historyRef.current = historyRef.current.slice(-1000);
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        if (showFrequencySlider) {
          plotValues(ctx, historyRef.current, min, max, frequencyColor);
        }
        if (showPitchSlider) {
          const [minOct, maxOct] = [Math.log2(min), Math.log2(max)];
          const perceptual = historyRef.current.map((v) => Math.log2(v));
          plotValues(ctx, perceptual, minOct, maxOct, pitchColor);
        }
      }
    }
  }, plot);

  const handleChangeFrequency = (f: number) => {
    setHz(f);
    if (oscRef.current) {
      oscRef.current.frequency.value = f;
    }
  };

  const handleMouseDown = () => {
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
    }
    startOsc(hz);
  };

  let exponent: React.ReactNode;
  let activeNote: string | undefined;
  let activeNoteLabel: string | undefined;

  if (showPitchSlider) {
    const expOffset = baseFrequency ? Math.log2(baseFrequency / min) : 0;
    const expValue = freq2pitchSlider(hz) * Math.log2(max / min) - expOffset;
    let semitones = parseFloat((expValue * 12).toFixed(2));
    
    if (zeroOffset) {
      semitones = semitones + zeroOffset;
      const isWhole = Math.round(semitones) === semitones;
      activeNote = midi2note(Math.round(semitones));
      activeNoteLabel = (!isWhole ? '~' : '') + activeNote;
      const displaySemitones = !isWhole ? semitones.toFixed(2) : semitones;
      exponent = (
        <>
          (<span className="text-yellow-500">{displaySemitones}</span> - {zeroOffset})/12
        </>
      );
    } else if (semitones % 12 === 0) {
      exponent = <span className="text-yellow-500">{semitones / 12}</span>;
    } else if (semitones % 1 === 0) {
      exponent = (
        <>
          <span className="text-yellow-500">{semitones}</span>/12
        </>
      );
    } else {
      exponent = <span className="text-yellow-500">{expValue.toFixed(2)}</span>;
    }
  }

  return (
    <>
      <span className="font-mono">
        {showFrequencySlider && <span className="text-blue-500">{hz.toFixed(0)}Hz</span>}
        {showFrequencySlider && showPitchSlider && <> = </>}
        {showPitchSlider && (
          <>
            {baseFrequency || min}Hz * 2<sup>{exponent}</sup>
          </>
        )}
      </span>
      {claviature && (
        <>
          {' '}
          = <span className="text-yellow-500">{activeNoteLabel}</span>
        </>
      )}
      <div>
        {showFrequencySlider && (
          <div className="flex space-x-1 items-center">
            <input
              type="range"
              value={freqSlider}
              min={0}
              max={1}
              step={0.001}
              onMouseDown={handleMouseDown}
              className={`block w-full max-w-[600px] accent-blue-500 `}
              onChange={(e) => {
                const f = freqSlider2freq(parseFloat(e.target.value));
                handleChangeFrequency(f);
              }}
            />
          </div>
        )}
        {showPitchSlider && (
          <div>
            <input
              type="range"
              value={pitchSlider}
              min={0}
              max={1}
              step={pitchStep}
              onMouseDown={handleMouseDown}
              className={`block w-full max-w-[600px] accent-yellow-500`}
              onChange={(e) => {
                const f = pitchSlider2freq(parseFloat(e.target.value));
                handleChangeFrequency(f);
              }}
            />
          </div>
        )}
      </div>
      <div className="px-2">
        {plot && <canvas ref={canvasRef} className="w-full max-w-[584px] h-[300px]" height="600" width={800} />}
      </div>
      <div className="space-x-2">
        {animatable && (
          <Button onClick={() => startSweep()}>
            <span style={{ color: '#3b82f6' }}>Frequency Sweep</span>
          </Button>
        )}
        {animatable && (
          <Button onClick={() => startSweep(true)}>
            <span style={{ color: '#eab308' }}>Pitch Sweep</span>
          </Button>
        )}
        {buttons.map((f, i) => (
          <Button key={`${f}-${i}`} onMouseDown={() => startOsc(f)}>
            {f}Hz
          </Button>
        ))}
      </div>
      {claviature && (
        <Claviature
          onMouseDown={(note: number) => {
            const f = 440 * 2 ** ((note - 69) / 12);
            handleChangeFrequency(f);
            if (frameRef.current) {
              cancelAnimationFrame(frameRef.current);
            }
            startOsc(f);
          }}
          options={{
            range: ['A1', 'A5'],
            scaleY: 0.75,
            scaleX: 0.86,
            colorize: activeNote ? [{ keys: [activeNote], color: '#eab308' }] : [],
            labels: activeNote ? { [activeNote]: activeNote } : {},
          }}
        />
      )}
    </>
  );
}