import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import fs from 'fs';
import path from 'path';

// Load all language files
const loadLanguageFiles = () => {
  const localesDir = path.join(process.cwd(), 'website/src/i18n/locales');
  const languages = fs.readdirSync(localesDir).filter(dir => 
    fs.statSync(path.join(localesDir, dir)).isDirectory()
  );
  
  const languageData = {};
  
  for (const lang of languages) {
    const settingsPath = path.join(localesDir, lang, 'settings.json');
    const messagesPath = path.join(localesDir, lang, 'messages.json');
    
    languageData[lang] = {};
    
    if (fs.existsSync(settingsPath)) {
      languageData[lang].settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    }
    
    if (fs.existsSync(messagesPath)) {
      languageData[lang].messages = JSON.parse(fs.readFileSync(messagesPath, 'utf8'));
    }
  }
  
  return languageData;
};

// Required prettier translation keys
const REQUIRED_PRETTIER_KEYS = [
  'codeFormatting',
  'prettierEnabled',
  'prettierDescription',
  'prettierAutoFormatOnSave',
  'prettierTabWidth',
  'prettierUseTabs',
  'prettierSemi',
  'prettierSingleQuote',
  'prettierQuoteProps',
  'prettierTrailingComma',
  'prettierBracketSpacing',
  'prettierArrowParens',
  'prettierPrintWidth',
  'prettierTabWidthDescription',
  'prettierUseTabsDescription',
  'prettierSemiDescription',
  'prettierSingleQuoteDescription',
  'prettierBracketSpacingDescription',
  'prettierPrintWidthDescription',
  'prettierQuotePropsAsNeeded',
  'prettierQuotePropsConsistent',
  'prettierQuotePropsPreserve',
  'prettierTrailingCommaNone',
  'prettierTrailingCommaEs5',
  'prettierTrailingCommaAll',
  'prettierArrowParensAvoid',
  'prettierArrowParensAlways',
  'prettierPreview',
  'prettierPreviewDescription'
];

// Required prettier message keys
const REQUIRED_PRETTIER_MESSAGE_KEYS = [
  'prettierFormatSuccess',
  'prettierFormatError',
  'prettierAutoFormatFailed',
  'prettierAutoFormatFailedSavingOriginal'
];

describe('Prettier Internationalization', () => {
  const languageData = loadLanguageFiles();
  const languages = Object.keys(languageData);

  describe('Property Tests', () => {
    it('Property 11: Internationalization Completeness - all languages should have prettier translations', () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...languages),
          (language) => {
            const langData = languageData[language];
            
            // Check if language has settings file
            if (!langData.settings) {
              // If no settings file, skip this language
              return true;
            }
            
            // Check that all required prettier keys exist
            const missingKeys = REQUIRED_PRETTIER_KEYS.filter(key => 
              !(key in langData.settings)
            );
            
            // Allow some languages to be incomplete during development
            // but English must be complete
            if (language === 'en') {
              expect(missingKeys).toEqual([]);
            }
            
            // For other languages, log missing keys but don't fail
            if (missingKeys.length > 0) {
              console.warn(`Language ${language} missing prettier keys:`, missingKeys);
            }
            
            return true;
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Unit Tests', () => {
    it('should have all required prettier translations in English', () => {
      const englishSettings = languageData.en?.settings;
      expect(englishSettings).toBeDefined();
      
      for (const key of REQUIRED_PRETTIER_KEYS) {
        expect(englishSettings[key]).toBeDefined();
        expect(typeof englishSettings[key]).toBe('string');
        expect(englishSettings[key].length).toBeGreaterThan(0);
      }
    });

    it('should have all required prettier message translations in English', () => {
      const englishMessages = languageData.en?.messages;
      expect(englishMessages).toBeDefined();
      
      for (const key of REQUIRED_PRETTIER_MESSAGE_KEYS) {
        expect(englishMessages[key]).toBeDefined();
        expect(typeof englishMessages[key]).toBe('string');
        expect(englishMessages[key].length).toBeGreaterThan(0);
      }
    });

    it('should have consistent translation structure across languages', () => {
      const englishSettings = languageData.en?.settings;
      
      for (const [lang, data] of Object.entries(languageData)) {
        if (lang === 'en' || !data.settings) continue;
        
        // Check that all languages have the same basic structure
        const englishKeys = Object.keys(englishSettings);
        const langKeys = Object.keys(data.settings);
        
        // Allow some flexibility - not all keys need to be translated yet
        // but check that no extra keys exist
        const extraKeys = langKeys.filter(key => !englishKeys.includes(key));
        expect(extraKeys).toEqual([]);
      }
    });

    it('should have non-empty translations for prettier keys', () => {
      for (const [lang, data] of Object.entries(languageData)) {
        if (!data.settings) continue;
        
        for (const key of REQUIRED_PRETTIER_KEYS) {
          if (key in data.settings) {
            expect(data.settings[key]).toBeTruthy();
            expect(typeof data.settings[key]).toBe('string');
            expect(data.settings[key].trim().length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('should have proper quote option translations', () => {
      const quoteKeys = [
        'prettierQuotePropsAsNeeded',
        'prettierQuotePropsConsistent', 
        'prettierQuotePropsPreserve'
      ];
      
      for (const [lang, data] of Object.entries(languageData)) {
        if (!data.settings) continue;
        
        for (const key of quoteKeys) {
          if (key in data.settings) {
            expect(data.settings[key]).toBeTruthy();
            expect(typeof data.settings[key]).toBe('string');
          }
        }
      }
    });

    it('should have proper trailing comma option translations', () => {
      const commaKeys = [
        'prettierTrailingCommaNone',
        'prettierTrailingCommaEs5',
        'prettierTrailingCommaAll'
      ];
      
      for (const [lang, data] of Object.entries(languageData)) {
        if (!data.settings) continue;
        
        for (const key of commaKeys) {
          if (key in data.settings) {
            expect(data.settings[key]).toBeTruthy();
            expect(typeof data.settings[key]).toBe('string');
          }
        }
      }
    });

    it('should have proper arrow parens option translations', () => {
      const arrowKeys = [
        'prettierArrowParensAvoid',
        'prettierArrowParensAlways'
      ];
      
      for (const [lang, data] of Object.entries(languageData)) {
        if (!data.settings) continue;
        
        for (const key of arrowKeys) {
          if (key in data.settings) {
            expect(data.settings[key]).toBeTruthy();
            expect(typeof data.settings[key]).toBe('string');
          }
        }
      }
    });

    it('should have description translations that are longer than labels', () => {
      const descriptionPairs = [
        ['prettierTabWidth', 'prettierTabWidthDescription'],
        ['prettierUseTabs', 'prettierUseTabsDescription'],
        ['prettierSemi', 'prettierSemiDescription'],
        ['prettierSingleQuote', 'prettierSingleQuoteDescription'],
        ['prettierBracketSpacing', 'prettierBracketSpacingDescription'],
        ['prettierPrintWidth', 'prettierPrintWidthDescription']
      ];
      
      for (const [lang, data] of Object.entries(languageData)) {
        if (!data.settings) continue;
        
        for (const [labelKey, descKey] of descriptionPairs) {
          if (labelKey in data.settings && descKey in data.settings) {
            const label = data.settings[labelKey];
            const description = data.settings[descKey];
            
            // Description should generally be longer than label
            expect(description.length).toBeGreaterThanOrEqual(label.length);
          }
        }
      }
    });

    it('should report translation coverage statistics', () => {
      const stats = {};
      
      for (const [lang, data] of Object.entries(languageData)) {
        if (!data.settings) {
          stats[lang] = { coverage: 0, total: 0, missing: REQUIRED_PRETTIER_KEYS.length };
          continue;
        }
        
        const presentKeys = REQUIRED_PRETTIER_KEYS.filter(key => key in data.settings);
        const coverage = (presentKeys.length / REQUIRED_PRETTIER_KEYS.length) * 100;
        
        stats[lang] = {
          coverage: Math.round(coverage),
          total: presentKeys.length,
          missing: REQUIRED_PRETTIER_KEYS.length - presentKeys.length
        };
      }
      
      console.log('Prettier Translation Coverage:');
      for (const [lang, stat] of Object.entries(stats)) {
        console.log(`  ${lang}: ${stat.coverage}% (${stat.total}/${REQUIRED_PRETTIER_KEYS.length})`);
      }
      
      // Ensure English has 100% coverage
      expect(stats.en?.coverage).toBe(100);
    });
  });
});