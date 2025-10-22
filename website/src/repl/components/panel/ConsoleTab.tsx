import cx from '@src/cx';
import { useSettings } from '../../../settings';
import { useStore } from '@nanostores/react';
import { $strudel_log_history } from '../useLogger';

interface LogEntry {
  id: string;
  message: string;
  type: 'error' | 'highlight' | 'info';
  count?: number;
  data?: {
    hap?: {
      value?: {
        color?: string;
      };
    };
  };
}

export function ConsoleTab() {
  const log = useStore($strudel_log_history) as LogEntry[];
  const { fontFamily } = useSettings();
  
  return (
    <div id="console-tab" className="break-all w-full  first-line:text-sm p-2  h-full" style={{ fontFamily }}>
      <div className="bg-background h-full w-full overflow-auto space-y-1 p-2 rounded-md">
        {log.map((l, i) => {
          const message = linkify(l.message);
          const color = l.data?.hap?.value?.color;
          return (
            <div
              key={l.id}
              className={cx(
                l.type === 'error' ? 'text-background bg-foreground' : 'text-foreground',
                l.type === 'highlight' && 'underline',
              )}
              style={color ? { color } : {}}
            >
              <span dangerouslySetInnerHTML={{ __html: message }} />
              {l.count ? ` (${l.count})` : ''}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function linkify(inputText: string): string {
  let replacedText: string;
  let replacePattern1: RegExp;
  let replacePattern2: RegExp;
  let replacePattern3: RegExp;

  //URLs starting with http://, https://, or ftp://
  replacePattern1 = /(\b(https?|ftp):\/\/[-A-Z0-9+&@#\/%?=~_|!:,.;]*[-A-Z0-9+&@#\/%=~_|])/gim;
  replacedText = inputText.replace(replacePattern1, '<a class="underline" href="$1" target="_blank">$1</a>');

  //URLs starting with "www." (without // before it, or it'd re-link the ones done above).
  replacePattern2 = /(^|[^\/])(www\.[\S]+(\b|$))/gim;
  replacedText = replacedText.replace(
    replacePattern2,
    '$1<a class="underline" href="http://$2" target="_blank">$2</a>',
  );

  //Change email addresses to mailto:: links.
  replacePattern3 = /(([a-zA-Z0-9\-\_\.])+@[a-zA-Z\_]+?(\.[a-zA-Z]{2,6})+)/gim;
  replacedText = replacedText.replace(replacePattern3, '<a class="underline" href="mailto:$1">$1</a>');

  return replacedText;
}