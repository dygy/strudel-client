/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />
/// <reference types="react" />
/// <reference types="react-dom" />

declare module 'date-fns';

// Environment variables
interface ImportMetaEnv {
  readonly PUBLIC_SUPABASE_URL: string;
  readonly PUBLIC_SUPABASE_ANON_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Fix JSX types for React components
import type { DetailedHTMLProps, HTMLAttributes } from 'react';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      [elemName: string]: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
    interface Element extends React.ReactElement<any, any> { }
    interface ElementClass extends React.Component<any> {
      render(): React.ReactNode;
    }
    interface ElementAttributesProperty { props: {}; }
    interface ElementChildrenAttribute { children: {}; }
  }
}
