import { code2hash } from '@strudel/core';
import { UdelFrame } from './UdelFrame';
import { useState } from 'react';
import UdelsHeader from './UdelsHeader';

const defaultHash = 'c3RhY2soCiAgCik%3D';

const getHashesFromUrl = (): string[] => {
  return window.location.hash?.slice(1).split(',') || [];
};

const updateURLHashes = (hashes: string[]): void => {
  const newHash = '#' + hashes.join(',');
  window.location.hash = newHash;
};

export function Udels() {
  const hashes = getHashesFromUrl();

  const [numWindows, setNumWindows] = useState(hashes?.length ?? 1);
  
  const numWindowsOnChange = (num: number) => {
    setNumWindows(num);
    const hashes = getHashesFromUrl();
    const newHashes: string[] = [];
    for (let i = 0; i < num; i++) {
      newHashes[i] = hashes[i] ?? defaultHash;
    }
    updateURLHashes(newHashes);
  };

  const onEvaluate = (key: number, code: string) => {
    const hashes = getHashesFromUrl();
    hashes[key] = code2hash(code);
    updateURLHashes(hashes);
  };

  return (
    <div
      style={{
        margin: 0,
        display: 'flex',
        flex: 1,
        height: '100vh',
        width: '100%',
        flexDirection: 'column',
      }}
    >
      <UdelsHeader numWindows={numWindows} setNumWindows={numWindowsOnChange} />
      <div
        style={{
          display: 'flex',
          flex: 1,
          flexDirection: 'row',
          flexWrap: 'wrap',
        }}
      >
        {hashes.map((hash, key) => {
          return (
            <UdelFrame
              instance={key.toString()}
              onEvaluate={(code) => {
                onEvaluate(key, code);
              }}
              hash={hash}
              key={key}
            />
          );
        })}
      </div>
    </div>
  );
}