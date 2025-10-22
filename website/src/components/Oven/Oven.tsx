import { useState, useEffect } from 'react';
import { loadFeaturedPatterns, loadPublicPatterns } from '@src/user_pattern_utils';
import { MiniRepl } from '@src/docs/MiniRepl';
import { PatternLabel } from '@src/repl/components/panel/PatternsTab';
import { logger } from '@strudel/core';

interface Pattern {
  id: string;
  code: string;
  hash: string;
  created_at: string;
}

interface PatternListProps {
  patterns: Pattern[];
}

function PatternList({ patterns }: PatternListProps) {
  return (
    <div className="space-y-4">
      {/* <MiniRepl tunes={patterns.map((pat) => pat.code.trim())} /> */}
      {patterns.map((pat) => (
        <div key={pat.id}>
          <div className="flex justify-between not-prose pb-2">
            <h2 className="text-lg">
              <a href={`/?${pat.hash}`} target="_blank" className="underline">
                <PatternLabel pattern={pat} />
              </a>
            </h2>
          </div>
          <MiniRepl tune={pat.code.trim()} maxHeight={300} />
        </div>
      ))}
    </div>
  );
}

export function Oven() {
  const [featuredPatterns, setFeaturedPatterns] = useState<Pattern[]>([]);
  const [publicPatterns, setPublicPatterns] = useState<Pattern[]>([]);
  
  useEffect(() => {
    loadPublicPatterns().then(({ data: pats }: { data: Pattern[] }) => {
      logger(`Loaded ${pats.length} public patterns`, 'success');
      setPublicPatterns(pats);
    });
    loadFeaturedPatterns().then(({ data: pats }: { data: Pattern[] }) => {
      logger(`Loaded ${pats.length} featured patterns`, 'success');
      setFeaturedPatterns(pats);
    });
  }, []);
  
  return (
    <div>
      <h2 id="featured">Featured Patterns</h2>
      <PatternList patterns={featuredPatterns} />
      <h2 id="latest">Last Creations</h2>
      <PatternList patterns={publicPatterns} />
    </div>
  );
}