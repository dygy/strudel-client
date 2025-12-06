import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Icon } from './Icon';
import { silence, noteToMidi, _mod } from '@strudel/core';
import { getDrawContext } from '@strudel/draw';
import { transpiler } from '@strudel/transpiler';
import { getAudioContext, webaudioOutput, initAudioOnFirstClick } from '@strudel/webaudio';
import { StrudelMirror } from '@strudel/codemirror';
import { prebake } from '../repl/prebake';
import { loadModules, setVersionDefaultsFrom } from '../repl/util';
import Claviature from '@components/Claviature';
import useClient from '@src/useClient';
import React from 'react';

let prebaked: Promise<any> | undefined;
let modulesLoading: Promise<any> | undefined;
let audioReady: Promise<any> | undefined;

if (typeof window !== 'undefined') {
  prebaked = prebake();
  modulesLoading = loadModules();
  audioReady = initAudioOnFirstClick();
}

interface ReplState {
  started?: boolean;
  isDirty?: boolean;
  error?: Error | null;
}

interface MiniReplProps {
  tune?: string;
  tunes?: string[];
  hideHeader?: boolean;
  canvasHeight?: number;
  onTrigger?: (time: number, hap: any, currentTime: number) => void;
  punchcard?: boolean;
  punchcardLabels?: boolean;
  claviature?: boolean;
  claviatureLabels?: Record<string, string>;
  maxHeight?: number;
  autodraw?: boolean;
  drawTime?: [number, number];
  mondo?: boolean;
}

export function MiniRepl({
  tune,
  tunes,
  hideHeader = false,
  canvasHeight = 100,
  onTrigger,
  punchcard,
  punchcardLabels = true,
  claviature,
  claviatureLabels,
  maxHeight,
  autodraw,
  drawTime,
  mondo = false,
}: MiniReplProps) {
  const code = tunes ? tunes[0] : tune || '';
  const id = useMemo(() => s4(), []);
  const shouldShowCanvas = !!punchcard;
  const canvasId = shouldShowCanvas ? useMemo(() => `canvas-${id}`, [id]) : null;
  const autoDrawEnabled = !!punchcard || !!claviature || !!autodraw;
  const finalDrawTime = (drawTime ?? punchcard) ? [0, 4] : [-2, 2];
  const actualDrawTime = claviature ? [0, 0] : finalDrawTime;
  
  const [activeNotes, setActiveNotes] = useState<(string | number)[]>([]);

  const init = useCallback(({ code, autodraw }: { code: string; autodraw: boolean }) => {
    const drawContext = canvasId ? document.querySelector<HTMLCanvasElement>('#' + canvasId)?.getContext('2d') : getDrawContext();

    const editor = new StrudelMirror({
      id,
      defaultOutput: webaudioOutput,
      getTime: () => getAudioContext().currentTime,
      transpiler,
      autodraw,
      root: containerRef.current,
      initialCode: '// LOADING',
      pattern: silence,
      drawTime: actualDrawTime as [number, number],
      drawContext,
      editPattern: (pat: any, id: string) => {
        if (onTrigger) {
          pat = pat.onTrigger(onTrigger, false);
        }
        if (claviature) {
          pat = pat.onPaint((ctx: any, time: number, haps: any[], drawTime: [number, number]) => {
            const active = haps
              .map((hap) => hap.value.note)
              .filter(Boolean)
              .map((n) => (typeof n === 'string' ? noteToMidi(n) : n));
            setActiveNotes(active);
          });
        }
        if (punchcard) {
          pat = pat.punchcard({ labels: !!punchcardLabels });
        }
        return pat;
      },
      prebake: async () => Promise.all([modulesLoading, prebaked]),
      onUpdateState: (state: ReplState) => {
        setReplState({ ...state });
      },
      onToggle: (playing: boolean) => {
        if (!playing) {
          // clearHydra(); // TBD: doesn't work with multiple MiniRepl's on a page
        }
      },
      beforeStart: () => audioReady,
      afterEval: ({ code }: { code: string }) => setVersionDefaultsFrom(code),
      mondo,
    });
    // init settings
    editor.setCode(code);
    editorRef.current = editor;
  }, [canvasId, onTrigger, claviature, punchcard, punchcardLabels, actualDrawTime, mondo]);

  const [replState, setReplState] = useState<ReplState>({});
  const { started, isDirty, error } = replState;
  const editorRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const client = useClient();

  const [tuneIndex, setTuneIndex] = useState(0);
  const changeTune = (index: number) => {
    if (!tunes) return;
    index = _mod(index, tunes.length);
    setTuneIndex(index);
    editorRef.current?.setCode(tunes[index]);
    editorRef.current?.evaluate();
  };

  if (!client) {
    return <pre>{code}</pre>;
  }

  return (
    <div className="overflow-hidden rounded-t-md bg-background border border-lineHighlight">
      {!hideHeader && (
        <div className="flex justify-between bg-lineHighlight">
          <div className="flex">
            <button
              className={cx(
                'cursor-pointer w-16 flex items-center justify-center p-1 border-r border-lineHighlight text-foreground bg-lineHighlight hover:bg-background',
                started ? 'animate-pulse' : '',
              )}
              aria-label={started ? 'stop' : 'play'}
              onClick={() => editorRef.current?.toggle()}
            >
              <Icon type={started ? 'stop' : 'play'} />
            </button>
            <button
              className={cx(
                'w-16 flex items-center justify-center p-1 text-foreground border-lineHighlight bg-lineHighlight',
                isDirty ? 'text-foreground hover:bg-background cursor-pointer' : 'opacity-50 cursor-not-allowed',
              )}
              aria-label="update"
              onClick={() => editorRef.current?.evaluate()}
            >
              <Icon type="refresh" />
            </button>
          </div>
          {tunes && (
            <div className="flex">
              <button
                className={
                  'cursor-pointer w-16 flex items-center justify-center p-1 border-r border-lineHighlight text-foreground bg-lineHighlight hover:bg-background'
                }
                aria-label="previous example"
                onClick={() => changeTune(tuneIndex - 1)}
              >
                <div className="rotate-180">
                  <Icon type="skip" />
                </div>
              </button>
              <button
                className={
                  'cursor-pointer w-16 flex items-center justify-center p-1 border-r border-lineHighlight text-foreground bg-lineHighlight hover:bg-background'
                }
                aria-label="next example"
                onClick={() => changeTune(tuneIndex + 1)}
              >
                <Icon type="skip" />
              </button>
            </div>
          )}
        </div>
      )}
      <div className="overflow-auto relative p-1" style={maxHeight ? { maxHeight: `${maxHeight}px` } : {}}>
        <div
          ref={(el) => {
            if (!editorRef.current) {
              containerRef.current = el;
              init({ code, autodraw: autoDrawEnabled });
            }
          }}
        ></div>
        {error && <div className="text-right p-1 text-md text-red-200">{error.message}</div>}
      </div>
      {shouldShowCanvas && (
        <canvas
          id={canvasId || undefined}
          className="w-full pointer-events-none border-t border-lineHighlight"
          height={canvasHeight}
          ref={(el) => {
            if (el && el.width !== el.clientWidth) {
              el.width = el.clientWidth;
            }
          }}
        ></canvas>
      )}
      {claviature && (
        <Claviature
          options={{
            range: ['C2', 'C6'],
            scaleY: 0.75,
            colorize: [{ keys: activeNotes.map(String), color: 'steelblue' }],
            labels: claviatureLabels || {},
          }}
        />
      )}
    </div>
  );
}

function cx(...classes: (string | undefined | boolean)[]): string {
  return classes.filter(Boolean).join(' ');
}

function s4(): string {
  return Math.floor((1 + Math.random()) * 0x10000)
    .toString(16)
    .substring(1);
}