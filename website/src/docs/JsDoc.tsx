import jsdoc from '../../doc.json'; // doc.json is built with `npm run jsdoc-json`
import { MiniRepl } from './MiniRepl';
import React from 'react';

interface DocParam {
  name: string;
  type?: {
    names?: string[];
  };
  description?: string;
}

interface DocItem {
  longname: string;
  description?: string;
  synonyms_text?: string;
  params?: DocParam[];
  examples?: string[];
}

interface JSDocData {
  docs: DocItem[];
}

const typedJsdoc = jsdoc as JSDocData;
const docs = typedJsdoc.docs.reduce((acc, obj) => Object.assign(acc, { [obj.longname]: obj }), {} as Record<string, DocItem>);

interface JsDocProps {
  name: string;
  h?: 1 | 2 | 3 | 4 | 5 | 6;
  hideDescription?: boolean;
  punchcard?: boolean;
  canvasHeight?: number;
}

export function JsDoc({ name, h = 3, hideDescription, punchcard, canvasHeight }: JsDocProps) {
  const item = docs[name];
  if (!item) {
    console.warn('Not found: ' + name);
    return <div />;
  }
  
  const CustomHeading = `h${h}` as keyof JSX.IntrinsicElements;
  const description =
    item.description?.replaceAll(/\{@link ([a-zA-Z\.]+)?#?([a-zA-Z]*)\}/g, (_, a, b) => {
      return `<a href="#${a.replaceAll('.', '').toLowerCase()}${b ? `-${b}` : ''}">${a}${b ? `#${b}` : ''}</a>`;
    }) || '';
    
  return (
    <>
      {!!h && <CustomHeading>{item.longname}</CustomHeading>}
      {!hideDescription && (
        <>
          {!!item.synonyms_text && (
            <span>
              Synonyms: <code>{item.synonyms_text}</code>
            </span>
          )}
          <div dangerouslySetInnerHTML={{ __html: description }} />
        </>
      )}
      <ul>
        {item.params?.map((param, i) => (
          <li key={i}>
            {param.name} ({param.type?.names?.join('|')}): {param.description?.replace(/(<([^>]+)>)/gi, '')}
          </li>
        ))}
      </ul>

      {item.examples?.length ? (
        <div className="space-y-2">
          {item.examples?.map((example, k) => (
            <MiniRepl tune={example} key={k} {...{ punchcard, canvasHeight }} />
          ))}
        </div>
      ) : (
        <div />
      )}
    </>
  );
}