import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { logger } from '@strudel/core';
import { nanoid } from 'nanoid';
import { settingsMap } from './settings';
import { confirmDialog, parseJSON } from './repl/util';
import { supabase } from './lib/supabase';
import { DEFAULT_TRACK_CODE } from './constants/defaultCode';

// Type definitions
export interface PatternData {
  id: string;
  code: string;
  hash?: string;
  collection?: string;
  created_at?: number | string;
  public?: boolean;
  featured?: boolean;
  [key: string]: any;
}

interface PatternCollection {
  [key: string]: PatternData;
}

interface SupabaseResponse<T> {
  data: T[] | null;
  error: any;
}

interface UserPatternMethods {
  collection: string;
  getAll(): PatternCollection;
  getPatternData(id: string): PatternData | undefined;
  exists(id: string): boolean;
  isValidID(id: string | null | undefined): boolean;
  create(): { id: string; data: PatternData };
  createAndAddToDB(): { id: string; data: PatternData };
  update(id: string, data: Partial<PatternData>): { id: string; data: PatternData };
  duplicate(data: PatternData): { id: string; data: PatternData };
  clearAll(): Promise<{ id: string | null; data: PatternData } | undefined>;
  delete(id: string): { id: string | null; data: PatternData };
}

export let $publicPatterns = atom<PatternCollection>({});
export let $featuredPatterns = atom<PatternCollection>({});

const patternQueryLimit = 20;
export const patternFilterName = {
  public: 'latest',
  featured: 'featured',
  user: 'user',
  stock: 'stock examples',
} as const;

const sessionAtom = <T>(name: string, initial: T = undefined as T) => {
  const storage = typeof sessionStorage !== 'undefined' ? sessionStorage : {};
  const store = atom(typeof storage[name] !== 'undefined' ? storage[name] : initial);
  store.listen((newValue: T) => {
    if (typeof newValue === 'undefined') {
      delete storage[name];
    } else {
      storage[name] = newValue as any;
    }
  });
  return store;
};

export let $viewingPatternData = sessionAtom('viewingPatternData', JSON.stringify({
  id: '',
  code: '',
  collection: patternFilterName.user,
  created_at: Date.now(),
}));

export const getViewingPatternData = (): PatternData => {
  return parseJSON($viewingPatternData.get());
};

export const useViewingPatternData = () => {
  return useStore($viewingPatternData);
};

export const setViewingPatternData = (data: PatternData): void => {
  $viewingPatternData.set(JSON.stringify(data));
};

function parsePageNum(page: number | string): number {
  return isNaN(page as number) ? 0 : Number(page);
}

export function loadPublicPatterns(page: number | string = 0): Promise<SupabaseResponse<PatternData>> {
  const pageNum = parsePageNum(page);
  const offset = pageNum * patternQueryLimit;
  
  // Note: This functionality is currently disabled as it requires a different database
  // with a 'code_v1' table that contains public patterns
  console.warn('loadPublicPatterns: Public patterns functionality is currently disabled');
  return Promise.resolve({ data: [], error: null });
  
  // Original implementation (commented out):
  // return supabase
  //   .from('code_v1')
  //   .select()
  //   .eq('public', true)
  //   .range(offset, offset + patternQueryLimit)
  //   .order('id', { ascending: false }) as any;
}

export function loadFeaturedPatterns(page: number | string = 0): Promise<SupabaseResponse<PatternData>> {
  const pageNum = parsePageNum(page);
  const offset = pageNum * patternQueryLimit;
  
  // Note: This functionality is currently disabled as it requires a different database
  // with a 'code_v1' table that contains featured patterns
  console.warn('loadFeaturedPatterns: Featured patterns functionality is currently disabled');
  return Promise.resolve({ data: [], error: null });
  
  // Original implementation (commented out):
  // return supabase
  //   .from('code_v1')
  //   .select()
  //   .eq('featured', true)
  //   .range(offset, offset + patternQueryLimit)
  //   .order('id', { ascending: false }) as any;
}

export async function loadAndSetPublicPatterns(page?: number | string): Promise<void> {
  const p = await loadPublicPatterns(page || 0);
  const data = p?.data;
  const pats: PatternCollection = {};
  data?.forEach((data, key) => (pats[data.id ?? key] = data));
  $publicPatterns.set(pats);
}

export async function loadAndSetFeaturedPatterns(page?: number | string): Promise<void> {
  const p = await loadFeaturedPatterns(page || 0);
  const data = p?.data;
  const pats: PatternCollection = {};
  data?.forEach((data, key) => (pats[data.id ?? key] = data));
  $featuredPatterns.set(pats);
}

export async function loadDBPatterns(): Promise<void> {
  try {
    await loadAndSetPublicPatterns();
    await loadAndSetFeaturedPatterns();
  } catch (err) {
    console.error('error loading patterns', err);
  }
}

// reason: https://codeberg.org/uzu/strudel/issues/857
const $activePattern = sessionAtom('activePattern', '');

export function setActivePattern(key: string | null): void {
  const oldPattern = $activePattern.get();
  $activePattern.set(key);
  
  // If this is a new pattern (not just switching between existing ones), 
  // trigger synchronization check
  if (key && key !== oldPattern && typeof window !== 'undefined') {
    console.log('setActivePattern - pattern changed from', oldPattern, 'to', key);
    
    // Dispatch event to trigger FileManager synchronization
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('strudel-active-pattern-changed', {
        detail: { newPattern: key, oldPattern }
      }));
    }, 50);
  }
}

export function getActivePattern(): string {
  return $activePattern.get();
}

export function useActivePattern(): string {
  return useStore($activePattern);
}

export const setLatestCode = (code: string): void => settingsMap.setKey('latestCode', code);

// Re-export the default code for backward compatibility
export const defaultCode = DEFAULT_TRACK_CODE;

export const userPattern: UserPatternMethods = {
  collection: patternFilterName.user,
  
  getAll(): PatternCollection {
    const patterns = parseJSON(settingsMap.get().userPatterns);
    return patterns ?? {};
  },
  
  getPatternData(id: string): PatternData | undefined {
    const userPatterns = this.getAll();
    return userPatterns[id];
  },
  
  exists(id: string): boolean {
    return this.getPatternData(id) != null;
  },
  
  isValidID(id: string | null | undefined): boolean {
    return id != null && id.length > 0;
  },

  create(): { id: string; data: PatternData } {
    const newID = createPatternID();
    const code = DEFAULT_TRACK_CODE;
    const data: PatternData = { 
      code, 
      created_at: Date.now(), 
      id: newID, 
      collection: this.collection 
    };
    return { id: newID, data };
  },
  
  createAndAddToDB(): { id: string; data: PatternData } {
    const newPattern = this.create();
    return this.update(newPattern.id, newPattern.data);
  },

  update(id: string, data: Partial<PatternData>): { id: string; data: PatternData } {
    const userPatterns = this.getAll();
    const isNewPattern = !userPatterns[id];
    const updatedData: PatternData = { 
      ...data as PatternData, 
      id, 
      collection: this.collection 
    };
    setUserPatterns({ ...userPatterns, [id]: updatedData });
    
    // Dispatch event for new patterns to notify FileManager
    if (isNewPattern && typeof window !== 'undefined') {
      console.log('userPattern.update - dispatching user pattern created event for:', id);
      window.dispatchEvent(new CustomEvent('strudel-user-pattern-created', {
        detail: { patternId: id, patternData: updatedData }
      }));
    }
    
    return { id, data: updatedData };
  },
  
  duplicate(data: PatternData): { id: string; data: PatternData } {
    const newPattern = this.create();
    return this.update(newPattern.id, { ...newPattern.data, code: data.code });
  },
  
  async clearAll(): Promise<{ id: string | null; data: PatternData } | undefined> {
    const confirmed = await confirmDialog(`This will delete all your patterns. Are you really sure?`);
    if (confirmed === false) {
      return;
    }
    
    const viewingPatternData = getViewingPatternData();
    setUserPatterns({});

    if (viewingPatternData.collection !== this.collection) {
      return { id: viewingPatternData.id, data: viewingPatternData };
    }
    
    setActivePattern(null);
    const newPattern = this.create();
    return { id: newPattern.id, data: newPattern.data };
  },
  
  delete(id: string): { id: string | null; data: PatternData } {
    const userPatterns = this.getAll();
    delete userPatterns[id];
    
    if (getActivePattern() === id) {
      setActivePattern(null);
    }
    
    setUserPatterns(userPatterns);
    const viewingPatternData = getViewingPatternData();
    const viewingID = viewingPatternData?.id;
    
    if (viewingID === id) {
      return { 
        id: null, 
        data: { 
          id: '', 
          code: DEFAULT_TRACK_CODE, 
          collection: this.collection, 
          created_at: Date.now() 
        } 
      };
    }
    
    return { id: viewingID, data: userPatterns[viewingID] };
  },
};

function setUserPatterns(obj: PatternCollection): void {
  settingsMap.setKey('userPatterns', JSON.stringify(obj));
}

export const createPatternID = (): string => {
  return nanoid(12);
};

export async function importPatterns(fileList: FileList): Promise<void> {
  const files = Array.from(fileList);
  await Promise.all(
    files.map(async (file, i) => {
      const content = await file.text();
      if (file.type === 'application/json') {
        const userPatterns = userPattern.getAll();
        setUserPatterns({ ...userPatterns, ...parseJSON(content) });
      } else if (['text/x-markdown', 'text/plain'].includes(file.type)) {
        const id = file.name.replace(/\.[^/.]+$/, '');
        userPattern.update(id, { code: content });
      }
    }),
  );
  logger(`import done!`);
}

export async function exportPatterns(): Promise<void> {
  const userPatterns = userPattern.getAll();
  const blob = new Blob([JSON.stringify(userPatterns)], { type: 'application/json' });
  const downloadLink = document.createElement('a');
  downloadLink.href = window.URL.createObjectURL(blob);
  const date = new Date().toISOString().split('T')[0];
  downloadLink.download = `strudel_patterns_${date}.json`;
  document.body.appendChild(downloadLink);
  downloadLink.click();
  document.body.removeChild(downloadLink);
}