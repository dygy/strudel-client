import { useMemo, useState, useEffect, useRef } from 'react';
import { Textbox } from '../textbox/Textbox';
import { useTranslation } from '@src/i18n';
import cx from '@src/cx';
import { useToastContext } from './Panel';
import { useSettings } from '../../../settings';
import {
  MusicalNoteIcon,
  AdjustmentsHorizontalIcon,
  SpeakerWaveIcon,
  ClockIcon,
  ArrowPathIcon,
  Cog6ToothIcon,
  ScaleIcon,
  Square3Stack3DIcon,
  PaintBrushIcon,
  ComputerDesktopIcon,
  WrenchScrewdriverIcon,
  GlobeAltIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  ClipboardDocumentIcon,
  CheckIcon
} from '@heroicons/react/24/outline';

import jsdocJson from '../../../../../doc.json';

interface DocParam {
  name: string;
  type?: {
    names?: string[];
  };
  description?: string;
}

interface DocEntry {
  name: string;
  longname?: string;
  description: string;
  synonyms?: string[];
  synonyms_text?: string;
  params?: DocParam[];
  examples?: string[];
  meta?: {
    filename: string;
  };
}

interface JSDocJson {
  docs: DocEntry[];
}

interface SyntaxHighlightedCodeProps {
  code: string;
  onCopy: () => void;
  isCopied: boolean;
}

function SyntaxHighlightedCode({ code, onCopy, isCopied }: SyntaxHighlightedCodeProps) {
  // Parse and highlight code using React elements instead of HTML strings
  const highlightCode = (code: string) => {
    const lines = code.split('\n');
    return lines.map((line, lineIndex) => {
      const tokens = [];
      let currentIndex = 0;
      
      // Simple tokenizer for Strudel syntax
      const patterns = [
        { regex: /"[^"]*"/g, style: { color: '#10b981' } }, // strings
        { regex: /'[^']*'/g, style: { color: '#10b981' } }, // strings
        { regex: /\/\/.*$/g, style: { color: '#6b7280', fontStyle: 'italic' } }, // comments
        { regex: /\b\d+(?:\.\d+)?\b/g, style: { color: '#3b82f6' } }, // numbers
        { regex: /\b\w+(?=\()/g, style: { color: '#f59e0b' } }, // functions
        { regex: /\.\w+(?=\()/g, style: { color: '#f59e0b' } }, // method calls
        { regex: /\.\w+(?!\()/g, style: { color: '#06b6d4' } }, // properties
        { regex: /[+\-*/%=<>!&|]+/g, style: { color: '#8b5cf6' } }, // operators
      ];
      
      let processedLine = line;
      const matches = [];
      
      // Find all matches
      patterns.forEach((pattern, patternIndex) => {
        const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
        let match;
        while ((match = regex.exec(line)) !== null) {
          matches.push({
            start: match.index,
            end: match.index + match[0].length,
            text: match[0],
            style: pattern.style,
            priority: patternIndex
          });
        }
      });
      
      // Sort matches by position and priority
      matches.sort((a, b) => a.start - b.start || a.priority - b.priority);
      
      // Remove overlapping matches (keep higher priority)
      const filteredMatches = [];
      let lastEnd = 0;
      matches.forEach(match => {
        if (match.start >= lastEnd) {
          filteredMatches.push(match);
          lastEnd = match.end;
        }
      });
      
      // Build the line with highlighted tokens
      const lineTokens = [];
      let pos = 0;
      
      filteredMatches.forEach((match, matchIndex) => {
        // Add text before match
        if (match.start > pos) {
          lineTokens.push(
            <span key={`text-${lineIndex}-${matchIndex}`}>
              {line.slice(pos, match.start)}
            </span>
          );
        }
        
        // Add highlighted match
        lineTokens.push(
          <span key={`match-${lineIndex}-${matchIndex}`} style={match.style}>
            {match.text}
          </span>
        );
        
        pos = match.end;
      });
      
      // Add remaining text
      if (pos < line.length) {
        lineTokens.push(
          <span key={`end-${lineIndex}`}>
            {line.slice(pos)}
          </span>
        );
      }
      
      return (
        <div key={lineIndex} className="whitespace-nowrap">
          {lineTokens.length > 0 ? lineTokens : line}
        </div>
      );
    });
  };

  return (
    <div className="relative group">
      <div className="bg-lineHighlight bg-opacity-50 rounded-lg border border-lineHighlight border-opacity-30 overflow-hidden">
        <pre className="p-4 pb-12 text-sm overflow-x-auto font-mono text-foreground">
          <code className="block">
            {highlightCode(code)}
          </code>
        </pre>
      </div>
      <button
        onClick={onCopy}
        className={cx(
          'absolute bottom-2 right-2 p-2 rounded-md transition-all duration-200 opacity-0 group-hover:opacity-100 focus:opacity-100',
          isCopied 
            ? 'bg-green-500 bg-opacity-20 text-green-600' 
            : 'bg-lineHighlight bg-opacity-50 hover:bg-opacity-80 text-foreground'
        )}
        title={isCopied ? 'Copied!' : 'Copy to clipboard'}
      >
        {isCopied ? (
          <CheckIcon className="w-4 h-4" />
        ) : (
          <ClipboardDocumentIcon className="w-4 h-4" />
        )}
      </button>
    </div>
  );
}

const typedJsdocJson = jsdocJson as JSDocJson;

// Function categories with their associated function names
const FUNCTION_CATEGORIES = {
  'Sound Sources': {
    icon: MusicalNoteIcon,
    description: 'Functions for selecting and generating sounds',
    functions: ['s', 'sound', 'n', 'note', 'chord', 'scale', 'freq', 'midi', 'midichan', 'ccn', 'ccv', 'bank', 'samples']
  },
  'Control Elements': {
    icon: AdjustmentsHorizontalIcon,
    description: 'Interactive controls like sliders, toggles, and buttons',
    functions: ['slider', 'toggle', 'radio', 'button', 'range', 'chooser', 'input', 'textarea', 'keyDown', 'mousex', 'mousey', 'press', 'pressBy']
  },
  'Audio Effects': {
    icon: SpeakerWaveIcon,
    description: 'Audio processing and effects',
    functions: [
      // Filters
      'lpf', 'hpf', 'bpf', 'djf', 'bandf', 'resonance', 'cutoff', 'lpq', 'hpq', 'bpq',
      'lpattack', 'lpdecay', 'lprelease', 'lpsustain', 'lpenv',
      'hpattack', 'hpdecay', 'hprelease', 'hpsustain', 'hpenv',
      'bpattack', 'bpdecay', 'bprelease', 'bpsustain', 'bpenv',
      // Spatial effects
      'delay', 'echo', 'reverb', 'room', 'roomsize', 'roomdim', 'roomfade', 'roomlp', 'dry', 'wet',
      'delayfeedback', 'delayspeed', 'delaysync',
      // Modulation effects
      'chorus', 'phaser', 'tremolo', 'leslie', 'vowel',
      'phasercenter', 'phaserdepth', 'phasersweep',
      'tremolodepth', 'tremolophase', 'tremoloshape', 'tremoloskew', 'tremolosync',
      // Distortion
      'crush', 'shape', 'drive', 'distort', 'distorttype', 'distortvol', 'clip', 'fold',
      // Dynamics
      'compressor', 'gain', 'amp', 'postgain'
    ]
  },
  'Timing & Rhythm': {
    icon: ClockIcon,
    description: 'Functions for controlling timing, speed, and rhythm',
    functions: [
      'fast', 'slow', 'hurry', 'early', 'late', 'swing', 'swingBy', 'cpm', 'setcpm', 'bpm', 'setcps', 'resetCycles',
      'hush', 'silence', 'rest', 'struct', 'mask', 'euclid', 'euclidRot', 'euclidInv', 'euclidLegato', 'euclidLegatoRot',
      'euclidish', 'density', 'beat', 'time', 'duration'
    ]
  },
  'Pattern Manipulation': {
    icon: ArrowPathIcon,
    description: 'Functions for transforming and combining patterns',
    functions: [
      // Sequencing
      'cat', 'seq', 'slowcat', 'fastcat', 'timeCat', 'timecat', 'stack', 'layer', 'superimpose',
      // Transformation
      'rev', 'palindrome', 'iter', 'iterBack', 'jux', 'juxBy', 'invert', 'scramble', 'shuffle',
      // Conditional
      'every', 'sometimesBy', 'sometimes', 'often', 'rarely', 'almostNever', 'almostAlways', 'never', 'always',
      'when', 'whenKey', 'someCycles', 'someCyclesBy',
      // Degradation
      'degradeBy', 'degrade', 'undegrade', 'undegradeBy',
      // Structure
      'compress', 'focus', 'zoom', 'within', 'without', 'whenmod', 'off', 'ply', 'plyWith', 'plyForEach',
      'striate', 'chop', 'slice', 'splice', 'loopAt', 'loopAtCps', 'chunk', 'chunkBack', 'chunkInto', 'chunkBackInto',
      // Repetition
      'stut', 'echo', 'echoWith', 'replicate', 'repeatCycles'
    ]
  },
  'Synthesis Parameters': {
    icon: Cog6ToothIcon,
    description: 'Synthesizer and sample playback parameters',
    functions: [
      // Envelope
      'attack', 'decay', 'sustain', 'release', 'adsr', 'legato', 'portamento', 'slide',
      // Sample control
      'begin', 'end', 'loop', 'loopBegin', 'loopEnd', 'speed', 'rate', 'accelerate', 'decelerate',
      // Synthesis
      'coarse', 'detune', 'fm', 'fmh', 'fmwave', 'fmattack', 'fmdecay', 'fmsustain', 'fmenv',
      // Wavetable
      'wt', 'wtenv', 'wtattack', 'wtdecay', 'wtsustain', 'wtrelease', 'wtrate', 'wtsync', 'wtdepth', 'wtshape', 'wtdc', 'wtskew', 'wtphaserand',
      // Warp
      'warp', 'warpmode', 'warpattack', 'warpdecay', 'warpsustain', 'warprelease', 'warprate', 'warpdepth', 'warpshape', 'warpdc', 'warpskew', 'warpsync', 'warpenv',
      // Other
      'orbit', 'cut', 'velocity', 'channel', 'channels'
    ]
  },
  'Scales & Harmony': {
    icon: ScaleIcon,
    description: 'Musical scales, chords, and harmonic functions',
    functions: [
      'scale', 'chord', 'voicing', 'voicings', 'addVoicings', 'inversion', 'drop', 'rootNotes',
      'scaleTranspose', 'transpose', 'up', 'down', 'octave', 'semitone', 'cent', 'harmonic', 'subharmonic',
      'add', 'sub', 'mul', 'div', 'mod', 'pow', 'arp', 'arpWith'
    ]
  },
  'Randomization': {
    icon: Square3Stack3DIcon,
    description: 'Functions for adding randomness and variation',
    functions: [
      'rand', 'rand2', 'irand', 'choose', 'choose2', 'chooseWith', 'chooseInWith', 'chooseCycles',
      'wchoose', 'wchooseCycles', 'shuffle', 'scramble', 'brand', 'brandBy',
      'perlin', 'sine', 'sine2', 'cosine', 'cosine2', 'saw', 'saw2', 'square', 'square2', 'tri', 'tri2',
      'isaw', 'isaw2', 'itri', 'itri2', 'noise'
    ]
  },
  'Visualization': {
    icon: PaintBrushIcon,
    description: 'Visual effects and drawing functions',
    functions: [
      'color', 'colour', 'punchcard', 'pianoroll', 'scope', 'fscope', 'spectrum', 'drawLine',
      'markcss', 'wordfall'
    ]
  },
  'MIDI & Control': {
    icon: ComputerDesktopIcon,
    description: 'MIDI and external control functions',
    functions: [
      'midichan', 'midicmd', 'midiport', 'midibend', 'midichan', 'miditouch', 'pitchwheel',
      'ccn', 'ccv', 'nrpnn', 'nrpv', 'sysex', 'sysexdata', 'sysexid', 'progNum'
    ]
  },
  'Utility Functions': {
    icon: WrenchScrewdriverIcon,
    description: 'Utility and helper functions',
    functions: [
      'pure', 'apply', 'fmap', 'appLeft', 'appRight', 'appBoth', 'appWhole',
      'range', 'range2', 'rangex', 'clip', 'wrap', 'fold', 'floor', 'ceil', 'round',
      'toBipolar', 'fromBipolar', 'log', 'logValues', 'fit', 'stretch', 'squeeze',
      'filterHaps', 'filterValues', 'filterWhen', 'withHaps', 'withHap', 'withValue',
      'withContext', 'setContext', 'stripContext', 'withQueryTime', 'withQuerySpan',
      'withHapTime', 'withHapSpan', 'withLoc', 'queryArc', 'splitQueries'
    ]
  },
  'Global Functions': {
    icon: GlobeAltIcon,
    description: 'Global settings and system functions',
    functions: [
      'all', 'hush', 'panic', 'setcps', 'getcps', 'resetCycles', 'samples', 'loadSample', 'loadSamples',
      'setBpm', 'setR', 'getDrawContext', 'initAudio', 'webaudio', 'superdough', 'csoundm'
    ]
  }
};

const isValid = ({ name, description }: DocEntry): boolean =>
  !!name && !name.startsWith('_') && !!description;

const availableFunctions = (() => {
  const seen = new Set<string>();
  const functions: DocEntry[] = [];

  for (const doc of typedJsdocJson.docs) {
    if (!isValid(doc)) continue;
    functions.push(doc);
    const synonyms = doc.synonyms || [];

    for (const s of synonyms) {
      if (!s || seen.has(s)) continue;
      seen.add(s);
      const synonymsWithDoc = [doc.name, ...synonyms].filter((x) => x && x !== s);
      functions.push({
        ...doc,
        name: s,
        longname: s,
        synonyms: synonymsWithDoc,
        synonyms_text: synonymsWithDoc.join(', '),
      });
    }
  }
  return functions;
})();

const categorizedFunctions = (() => {
  const categorized: Record<string, DocEntry[]> = {};
  const uncategorized: DocEntry[] = [];

  // Initialize categories
  Object.keys(FUNCTION_CATEGORIES).forEach(category => {
    categorized[category] = [];
  });

  // Categorize functions
  availableFunctions.forEach(func => {
    let foundCategory = false;

    for (const [categoryName, categoryData] of Object.entries(FUNCTION_CATEGORIES)) {
      if (categoryData.functions.includes(func.name)) {
        categorized[categoryName].push(func);
        foundCategory = true;
        break;
      }
    }

    if (!foundCategory) {
      uncategorized.push(func);
    }
  });

  // Add uncategorized functions to a special category
  if (uncategorized.length > 0) {
    categorized['Other Functions'] = uncategorized.sort((a, b) => a.name.localeCompare(b.name));
  }

  // Sort functions within each category
  Object.keys(categorized).forEach(category => {
    categorized[category].sort((a, b) => a.name.localeCompare(b.name));
  });

  return categorized;
})();

const getInnerText = (html: string): string => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
};

export function EnhancedReference() {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [currentFunction, setCurrentFunction] = useState<string | null>(null);
  const [copiedExample, setCopiedExample] = useState<string | null>(null);
  const { t } = useTranslation('common');
  const toast = useToastContext();

  // Copy to clipboard function
  const copyToClipboard = (text: string, exampleId: string) => {
    const toastActions = useToastContext();
    navigator.clipboard.writeText(text).then(() => {
      toastActions.success('Copied to clipboard');
      setCopiedExample(exampleId);
      // Reset the checkmark after 2 seconds
      setTimeout(() => setCopiedExample(null), 2000);
    }).catch(() => {
      toastActions.error('Failed to copy to clipboard');
    });
  };

  const filteredData = useMemo(() => {
    if (!search && !selectedCategory) {
      return categorizedFunctions;
    }

    const filtered: Record<string, DocEntry[]> = {};

    Object.entries(categorizedFunctions).forEach(([category, functions]) => {
      if (selectedCategory && category !== selectedCategory) {
        return;
      }

      const matchingFunctions = functions.filter((entry) => {
        if (!search) return true;

        const lowerCaseSearch = search.toLowerCase();
        return (
          entry.name.toLowerCase().includes(lowerCaseSearch) ||
          (entry.synonyms?.some((s) => s.toLowerCase().includes(lowerCaseSearch)) ?? false) ||
          getInnerText(entry.description).toLowerCase().includes(lowerCaseSearch)
        );
      });

      if (matchingFunctions.length > 0) {
        filtered[category] = matchingFunctions;
      }
    });

    return filtered;
  }, [search, selectedCategory]);

  const scrollToFunction = (category: string, index: number) => {
    const el = document.getElementById(`func-${category}-${index}`);
    const container = document.getElementById('reference-container');
    if (el && container) {
      container.scrollTo({
        top: el.offsetTop - 100,
        behavior: 'smooth'
      });
    }
  };

  // Track which function is currently visible
  useEffect(() => {
    const container = document.getElementById('reference-container');
    if (!container) return;

    const handleScroll = () => {
      const containerRect = container.getBoundingClientRect();
      const containerTop = containerRect.top;
      const containerCenter = containerTop + containerRect.height / 3; // Use top third for better UX

      let closestFunction: string | null = null;
      let closestDistance = Infinity;

      // Check all function elements
      Object.entries(filteredData).forEach(([category, functions]) => {
        functions.forEach((func, index) => {
          const el = document.getElementById(`func-${category}-${index}`);
          if (el) {
            const rect = el.getBoundingClientRect();
            const distance = Math.abs(rect.top - containerCenter);
            
            // Only consider functions that are at least partially visible
            if (rect.bottom > containerTop && rect.top < containerTop + containerRect.height) {
              if (distance < closestDistance) {
                closestDistance = distance;
                closestFunction = func.name;
              }
            }
          }
        });
      });

      setCurrentFunction(closestFunction);
    };

    container.addEventListener('scroll', handleScroll);
    // Initial check
    handleScroll();

    return () => container.removeEventListener('scroll', handleScroll);
  }, [filteredData]);

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">
      {/* Top Search Bar - Full Width */}
      <div className="p-3 border-b border-lineHighlight bg-background bg-opacity-50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <MagnifyingGlassIcon className="w-5 h-5 text-foreground opacity-60" />
          <Textbox
            className="flex-1"
            placeholder={t('reference.search')}
            value={search}
            onChange={setSearch}
          />
          <div className="text-sm text-foreground opacity-60">
            {Object.values(filteredData).flat().length} functions
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Categories Only */}
        <div className="w-64 flex-shrink-0 flex flex-col border-r border-lineHighlight bg-background bg-opacity-30">
          {/* Category Filter */}
          <div className="p-2">
            <button
              onClick={() => setSelectedCategory(null)}
              className={cx(
                'w-full px-2 py-1.5 text-sm rounded transition-all duration-200 flex items-center gap-2 mb-1',
                !selectedCategory
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-foreground hover:bg-lineHighlight'
              )}
            >
              <MagnifyingGlassIcon className="w-3 h-3" />
              All Categories
            </button>
            {Object.entries(FUNCTION_CATEGORIES).map(([category, categoryData]) => {
              const IconComponent = categoryData.icon;
              const functionCount = filteredData[category]?.length || 0;
              
              return (
                <button
                  key={category}
                  onClick={() => setSelectedCategory(selectedCategory === category ? null : category)}
                  className={cx(
                    'w-full px-2 py-1.5 text-sm rounded transition-all duration-200 flex items-center gap-2 text-left mb-1',
                    selectedCategory === category
                      ? 'bg-foreground text-background shadow-sm'
                      : 'text-foreground hover:bg-lineHighlight'
                  )}
                >
                  <IconComponent className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate flex-1">{category}</span>
                  {functionCount > 0 && (
                    <span className="text-xs opacity-60 bg-lineHighlight px-1 rounded">
                      {functionCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Function List for Selected Category */}
          {selectedCategory && filteredData[selectedCategory] && (
            <div className="flex-1 overflow-y-auto border-t border-lineHighlight">
              <div className="p-2">
                <div className="text-xs font-semibold text-foreground opacity-60 mb-2 px-2">
                  {selectedCategory} Functions
                </div>
                {filteredData[selectedCategory].map((func, index) => (
                  <button
                    key={`${func.name}-${index}`}
                    onClick={() => scrollToFunction(selectedCategory, index)}
                    className={cx(
                      'w-full p-1.5 text-left transition-all duration-200 rounded text-sm group',
                      currentFunction === func.name
                        ? 'bg-foreground text-background shadow-sm'
                        : 'hover:bg-lineHighlight'
                    )}
                  >
                    <div className={cx(
                      'font-mono truncate',
                      currentFunction === func.name
                        ? 'font-bold text-background'
                        : 'text-foreground group-hover:font-semibold'
                    )}>
                      {func.name}
                    </div>
                    {func.synonyms_text && (
                      <div className={cx(
                        'text-xs truncate',
                        currentFunction === func.name
                          ? 'text-background opacity-90'
                          : 'text-foreground opacity-70 group-hover:opacity-90'
                      )}>
                        aka: {func.synonyms_text}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Content Area - Function Details */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className="p-4 border-b border-lineHighlight bg-background bg-opacity-30 flex-shrink-0">
            <h2 className="text-xl font-bold text-foreground">API Reference</h2>
            <p className="text-sm text-foreground opacity-70 mt-1">
              {selectedCategory ? `${selectedCategory} Functions` : 'All Function Categories'}
            </p>
          </div>

          <div
            className="flex-1 overflow-y-auto overflow-x-hidden p-6"
            id="reference-container"
          >
            <div className="w-full max-w-none">
              {Object.entries(filteredData).map(([category, functions]) => {
                const categoryData = FUNCTION_CATEGORIES[category as keyof typeof FUNCTION_CATEGORIES];
                const IconComponent = categoryData?.icon || FolderIcon;
                
                return (
                  <div key={category} className="mb-10">
                    <div className="flex items-center gap-4 mb-6 pb-3 border-b border-lineHighlight">
                      <IconComponent className="w-8 h-8 text-foreground flex-shrink-0" />
                      <div className="min-w-0 flex-1">
                        <h3 className="text-2xl font-bold text-foreground m-0 break-words">{category}</h3>
                        <p className="text-foreground opacity-70 mt-1 break-words">
                          {categoryData?.description || 'Various functions'} • {functions.length} function{functions.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-6">
                      {functions.map((entry, index) => (
                        <section
                          key={`${entry.name}-${index}`}
                          id={`func-${category}-${index}`}
                          className="bg-background bg-opacity-40 rounded-xl p-6 border border-lineHighlight border-opacity-30 hover:border-opacity-60 transition-all duration-200 hover:shadow-lg w-full overflow-hidden"
                        >
                          <div className="flex items-start justify-between mb-4 gap-4">
                            <h4 className="text-foreground font-mono text-2xl font-bold min-w-0 flex-shrink-0">
                              {entry.name}
                            </h4>
                            {entry.synonyms_text && (
                              <div className="text-sm text-foreground opacity-70 bg-lineHighlight px-3 py-1 rounded-full flex-shrink-0">
                                aka: {entry.synonyms_text}
                              </div>
                            )}
                          </div>

                          <div
                            className="text-foreground mb-4 text-base leading-relaxed break-words overflow-wrap-anywhere"
                            dangerouslySetInnerHTML={{ __html: entry.description }}
                          />

                          {entry.params && entry.params.length > 0 && (
                            <div className="mb-4">
                              <h5 className="text-foreground font-bold text-lg mb-3">Parameters</h5>
                              <div className="space-y-2">
                                {entry.params.map(({ name, type, description }, i) => (
                                  <div key={i} className="bg-lineHighlight bg-opacity-30 rounded-lg p-3 w-full overflow-hidden">
                                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                                      <code className="bg-lineHighlight px-2 py-1 rounded text-foreground font-mono font-semibold break-all">
                                        {name}
                                      </code>
                                      {type?.names && (
                                        <span className="text-foreground opacity-60 text-sm break-words">
                                          ({type.names.join(' | ')})
                                        </span>
                                      )}
                                    </div>
                                    {description && (
                                      <p className="text-foreground opacity-80 text-sm ml-0 break-words overflow-wrap-anywhere">
                                        {getInnerText(description)}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {entry.examples && entry.examples.length > 0 && (
                            <div>
                              <h5 className="text-foreground font-bold text-lg mb-3">Examples</h5>
                              <div className="space-y-3">
                                {entry.examples.map((example, j) => {
                                  const exampleId = `${entry.name}-${j}`;
                                  const isCopied = copiedExample === exampleId;
                                  
                                  return (
                                    <SyntaxHighlightedCode
                                      key={j}
                                      code={example}
                                      onCopy={() => copyToClipboard(example, exampleId)}
                                      isCopied={isCopied}
                                    />
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </section>
                      ))}
                    </div>
                  </div>
                );
              })}

              {Object.keys(filteredData).length === 0 && (
                <div className="text-center py-16">
                  <MagnifyingGlassIcon className="w-16 h-16 text-foreground opacity-20 mx-auto mb-6" />
                  <h3 className="text-foreground text-2xl font-bold mb-3">No functions found</h3>
                  <p className="text-foreground opacity-60 text-lg">
                    Try adjusting your search terms or selecting a different category
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
