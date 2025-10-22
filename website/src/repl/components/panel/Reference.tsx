import { useMemo, useState } from 'react';
import { Textbox } from '../textbox/Textbox';
import { useTranslation } from '@src/i18n';

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

const typedJsdocJson = jsdocJson as JSDocJson;

const isValid = ({ name, description }: DocEntry): boolean => 
  !!name && !name.startsWith('_') && !!description;

const availableFunctions = (() => {
  const seen = new Set<string>(); // avoid repetition
  const functions: DocEntry[] = [];
  
  for (const doc of typedJsdocJson.docs) {
    if (!isValid(doc)) continue;
    functions.push(doc);
    const synonyms = doc.synonyms || [];
    
    for (const s of synonyms) {
      if (!s || seen.has(s)) continue;
      seen.add(s);
      // Swap `doc.name` in for `s` in the list of synonyms
      const synonymsWithDoc = [doc.name, ...synonyms].filter((x) => x && x !== s);
      functions.push({
        ...doc,
        name: s, // update names for the synonym
        longname: s,
        synonyms: synonymsWithDoc,
        synonyms_text: synonymsWithDoc.join(', '),
      });
    }
  }
  return functions.sort((a, b) => a.name.localeCompare(b.name));
})();

const getInnerText = (html: string): string => {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
};

export function Reference() {
  const [search, setSearch] = useState('');
  const { t } = useTranslation('common');

  const visibleFunctions = useMemo(() => {
    return availableFunctions.filter((entry) => {
      if (!search) {
        return true;
      }

      const lowerCaseSearch = search.toLowerCase();
      return (
        entry.name.toLowerCase().includes(lowerCaseSearch) ||
        (entry.synonyms?.some((s) => s.toLowerCase().includes(lowerCaseSearch)) ?? false)
      );
    });
  }, [search]);

  return (
    <div className="flex h-full w-full p-2 overflow-hidden">
      <div className="h-full  flex flex-col gap-2 w-1/3 max-w-72 ">
        <div className="w-full flex">
          <Textbox 
            className="w-full" 
            placeholder={t('reference.search')} 
            value={search} 
            onChange={setSearch} 
          />
        </div>
        <div className="flex flex-col h-full overflow-y-auto  gap-1.5 bg-background bg-opacity-50  rounded-md">
          {visibleFunctions.length === 0 ? (
            <div className="p-2 text-gray-400 text-sm">{t('reference.noResults')}</div>
          ) : (
            visibleFunctions.map((entry, i) => (
              <a
                key={i}
                className="cursor-pointer text-foreground flex-none hover:bg-lineHighlight overflow-x-hidden  px-1 text-ellipsis"
                onClick={() => {
                  const el = document.getElementById(`doc-${i}`);
                  const container = document.getElementById('reference-container');
                  if (el && container) {
                    container.scrollTo(0, el.offsetTop);
                  }
                }}
              >
                {entry.name}
              </a>
            ))
          )}
        </div>
      </div>
      <div
        className="break-normal flex-grow flex-col overflow-y-auto overflow-x-hidden   px-2 flex relative"
        id="reference-container"
      >
        <div className="prose dark:prose-invert min-w-full px-1 ">
          <h2>API Reference</h2>
          <p>
            This is the long list of functions you can use. Remember that you don't need to remember all of those and
            that you can already make music with a small set of functions!
          </p>
          {visibleFunctions.map((entry, i) => (
            <section key={i}>
              <h3 id={`doc-${i}`}>{entry.name}</h3>
              {!!entry.synonyms_text && (
                <p>
                  Synonyms: <code>{entry.synonyms_text}</code>
                </p>
              )}
              <p dangerouslySetInnerHTML={{ __html: entry.description }}></p>
              {entry.params && entry.params.length > 0 && (
                <ul>
                  {entry.params.map(({ name, type, description }, i) => (
                    <li key={i}>
                      {name} : {type?.names?.join(' | ')} {description ? <> - {getInnerText(description)}</> : ''}
                    </li>
                  ))}
                </ul>
              )}
              {entry.examples?.map((example, j) => (
                <pre className="bg-background" key={j}>
                  {example}
                </pre>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}