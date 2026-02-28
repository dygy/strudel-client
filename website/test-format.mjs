import { FormatEngine } from './src/repl/formatEngine.ts';

const formatEngine = FormatEngine.getInstance();
const defaultOptions = {
  tabWidth: 2,
  useTabs: false,
  semi: true,
  singleQuote: true,
  quoteProps: 'as-needed',
  trailingComma: 'es5',
  bracketSpacing: true,
  arrowParens: 'always',
  printWidth: 80,
};

const code = `arrange([s("bd sd"), s("hh*4")], [s("bass:0 bass:1"), s("pad:2")])`;
const result = await formatEngine.formatCode(code, defaultOptions);

console.log('Input:', code);
console.log('Output:', result.formattedCode);
console.log('Lines:', result.formattedCode.split('\n'));
