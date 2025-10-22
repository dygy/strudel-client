import { getMetadata } from './metadata_parser';

// Type definitions
interface PatternCollection {
  [key: string]: string;
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
      .map(([name, raw]) => [getMetadata(raw as string)['title'] || name.split('/').slice(-1), raw as string]),
  );
}