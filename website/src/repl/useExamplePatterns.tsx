import { $featuredPatterns, $publicPatterns, patternFilterName } from '../user_pattern_utils';
import { useStore } from '@nanostores/react';
import { useMemo } from 'react';
import * as tunes from '../repl/tunes';

// Type definitions
interface PatternData {
  id: string | number;
  code: string;
  collection: string;
}

interface PatternCollection {
  [key: string]: PatternData;
}

interface Collections extends Map<string, PatternCollection> {}

interface UseExamplePatternsReturn {
  patterns: PatternCollection;
  collections: Collections;
}

export const stockPatterns: PatternCollection = Object.fromEntries(
  Object.entries(tunes).map(([key, code], i) => [i, { id: i, code, collection: 'Stock Examples' }]),
);

export const useExamplePatterns = (): UseExamplePatternsReturn => {
  const featuredPatterns = useStore($featuredPatterns);
  const publicPatterns = useStore($publicPatterns);
  
  const collections = useMemo(() => {
    const pats = new Map<string, PatternCollection>();
    pats.set(patternFilterName.featured, featuredPatterns);
    pats.set(patternFilterName.public, publicPatterns);
    // pats.set(patternFilterName.stock, stockPatterns);
    return pats;
  }, [featuredPatterns, publicPatterns]);

  const patterns = useMemo(() => {
    return Object.assign({}, ...collections.values());
  }, [collections]);

  return { patterns, collections };
};