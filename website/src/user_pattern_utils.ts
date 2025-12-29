import { atom } from 'nanostores';
import { useStore } from '@nanostores/react';
import { logger } from '@strudel/core';
import { nanoid } from 'nanoid';
import { settingsMap } from './settings';
import { confirmDialog, parseJSON, supabase } from './repl/util';

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

const sessionAtom = <T>(name: string, initial: T = undefined as T): any => {
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
  return supabase
    .from('code_v1')
    .select()
    .eq('public', true)
    .range(offset, offset + patternQueryLimit)
    .order('id', { ascending: false }) as any;
}

export function loadFeaturedPatterns(page: number | string = 0): Promise<SupabaseResponse<PatternData>> {
  const pageNum = parsePageNum(page);
  const offset = pageNum * patternQueryLimit;
  return supabase
    .from('code_v1')
    .select()
    .eq('featured', true)
    .range(offset, offset + patternQueryLimit)
    .order('id', { ascending: false }) as any;
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
  $activePattern.set(key);
}

export function getActivePattern(): string {
  return $activePattern.get();
}

export function useActivePattern() {
  return useStore($activePattern);
}

export const setLatestCode = (code: string): void => settingsMap.setKey('latestCode', code);

export const defaultCode = `/* ========== SETUP ========== */
setcps(160/60/4) // 160 BPM (2.666… cycles per second)

/* ========== DRUM SECTION ========== */
// Four‑on‑the‑floor kick with some drive and low‑pass
kick: s("bd*4").bank("RolandTR909").drive(2).lpf(2200).gain(0.85)

// Clap on the 2 and 4 for backbeat punch
clap: s("~ cp ~ cp").bank("RolandTR909").crush(12).room(0.2).gain(0.5)

// Closed hats: straight 16ths plus a quieter off‑beat shuffle
hats: stack(
  s("hh*16").bank("RolandTR909").dec(0.05).gain(0.25),
  s("~ hh ~ hh").bank("RolandTR909").dec(0.03).gain(0.15).pan(sine.range(-0.4, 0.4).slow(8))
).gain(1)

/* ========== BASS (DONK) ========== */
// Donk‑style bass in A major. Tweak note pattern to taste.
donk: note("<a1 g#1 a1 f#1> <e1 e1 d#1 e1>").sub(12).sound("z_sine").ftype("ladder").lpf(180).lpq(8).euclidRot(3,16,14).drive(3).distort("1.4:.65")

/* ========== STAB CHORDS ========== */
// A → F#m → D → E progression. Adjust timing/gain by ear.
stabs: chord("<A F#m D E>").dict("ireal").voicing().sound("square").gain("<0.1 0.15 0.1 0.15>").decay(0.3).room(0.5).delay(".18:.1:.26").gain("<0.1 0.15 0.1 0.15>")

/* ========== GLOBAL TOUCH ========== */
// Tint everything cyan (optional)
all(x => x.color("cyan"))`;

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
    const code = defaultCode;
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
    const updatedData: PatternData = { 
      ...data as PatternData, 
      id, 
      collection: this.collection 
    };
    setUserPatterns({ ...userPatterns, [id]: updatedData });
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
          code: defaultCode, 
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