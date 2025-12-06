import { getMetadata } from './metadata_parser';
import type { PatternData } from './user_pattern_utils';

// Type definitions
interface PatternCollection {
  [key: string]: PatternData;
}

/**
 * Loads patterns from the my-patterns directory
 * @returns Object mapping pattern names to their code content
 */
export function getMyPatterns(): PatternCollection {
  const my = import.meta.glob('../../my-patterns/**', { as: 'raw', eager: true });
  return Object.fromEntries(
    Object.entries(my)
      .filter(([name]) => name.endsWith('.txt'))
      .map(([name, raw]) => {
        const code = raw as string;
        const metadata = getMetadata(code);
        const title = metadata['title'] || name.split('/').slice(-1)[0];
        return [title, { id: title, code, collection: 'my-patterns' }];
      }),
  );
}