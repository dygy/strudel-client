/**
 * Settings → Connected assistants (spec 018, functional 2.2): who is connected, since when, and a
 * Disconnect button. Reads and revokes through Supabase's OAuth server with the user's own token.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { HELPER_COMMAND, HELPER_PUBLISHED } from '@src/lib/mcpHelper';

export { HELPER_COMMAND, HELPER_PUBLISHED };

import { createOAuthServerApi, type OAuthGrant, type OAuthServerApi } from '@src/lib/oauthServerApi';
import { supabase } from '@src/lib/supabase';
import { usePanelViewport } from './panelViewport';

const { BASE_URL } = import.meta.env;
export const SETUP_PAGE = `${BASE_URL.endsWith('/') ? BASE_URL : `${BASE_URL}/`}learn/ai-assistants`;
export const MCP_ADDRESS = 'https://strudel.dygy.app/mcp';
export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http strudel ${MCP_ADDRESS}`;
/** A new assistant shows up within this long while the section is open (functional 2.2). */
export const LIST_REFRESH_MS = 30_000;
const COPIED_MS = 2_000;

/** A line of text to copy. If the browser refuses, it's selected so it can be copied by hand. */
function CopyLine({ text, label }: { text: string; label: string }) {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<'idle' | 'copied' | 'refused'>('idle');
  const codeRef = useRef<HTMLElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState('idle'), COPIED_MS);
    } catch {
      setState('refused');
      const selection = window.getSelection();
      if (selection && codeRef.current) selection.selectAllChildren(codeRef.current);
    }
  };

  return (
    <div>
      <p className="text-xs text-foreground opacity-70 mb-1">{label}</p>
      {/* Commands read left to right, whatever the page's direction. */}
      <div className="flex items-stretch gap-2">
        <code
          ref={codeRef}
          dir="ltr"
          className="flex-1 min-w-0 px-2 py-1 rounded-md bg-lineHighlight text-xs text-foreground break-all select-all"
        >
          {text}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="min-h-11 sm:min-h-0 px-3 py-1 rounded-md text-sm border border-foreground text-foreground hover:bg-lineHighlight whitespace-nowrap"
        >
          {state === 'copied' ? t('connectedAssistants.copied') : t('connectedAssistants.copy')}
        </button>
      </div>
      {state === 'refused' && (
        <p role="alert" className="text-xs text-foreground mt-1">
          {t('connectedAssistants.copyRefused')}
        </p>
      )}
    </div>
  );
}

function ConnectSteps() {
  const { t } = useTranslation('settings');
  return (
    <div data-testid="connect-steps" className="space-y-3">
      <CopyLine text={MCP_ADDRESS} label={t('connectedAssistants.address')} />
      <div>
        <p className="text-sm font-medium text-foreground">{t('connectedAssistants.claudeWebTitle')}</p>
        <p className="text-xs text-foreground opacity-80 leading-relaxed">{t('connectedAssistants.claudeWebSteps')}</p>
      </div>
      <div>
        <p className="text-sm font-medium text-foreground">{t('connectedAssistants.claudeDesktopTitle')}</p>
        <p className="text-xs text-foreground opacity-80 leading-relaxed">
          {t('connectedAssistants.claudeDesktopSteps')}
        </p>
      </div>
      <CopyLine text={CLAUDE_CODE_COMMAND} label={t('connectedAssistants.claudeCodeTitle')} />
      <a
        href={SETUP_PAGE}
        target="_blank"
        rel="noreferrer"
        data-testid="assistants-setup-link"
        className="inline-block text-sm text-foreground underline min-h-11 sm:min-h-0 leading-[2.75rem] sm:leading-normal"
      >
        {t('connectedAssistants.setupGuide')}
      </a>
      {HELPER_PUBLISHED && (
        <>
          <CopyLine text={HELPER_COMMAND} label={t('connectedAssistants.helperTitle')} />
          <p className="text-xs text-foreground opacity-80 leading-relaxed">{t('connectedAssistants.helperAdds')}</p>
        </>
      )}
    </div>
  );
}

function defaultApi(): OAuthServerApi {
  return createOAuthServerApi({
    supabaseUrl: import.meta.env.PUBLIC_SUPABASE_URL,
    anonKey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
    getAccessToken: async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      return data.session?.access_token ?? null;
    },
  });
}

function connectedDate(iso: string, locale: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

type ListState = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; grants: OAuthGrant[] };

export function ConnectedAssistants({ api: injected }: { api?: OAuthServerApi }) {
  const { t, i18n } = useTranslation('settings');
  const { compact } = usePanelViewport();
  const [api] = useState(() => injected ?? defaultApi());
  const [list, setList] = useState<ListState>({ status: 'loading' });
  const [disconnecting, setDisconnecting] = useState<string | null>(null);
  const [disconnectFailed, setDisconnectFailed] = useState<string | null>(null);

  // A list read before a Disconnect finished still holds that assistant, and mustn't bring it back.
  const revokes = useRef(0);

  const load = useCallback(async () => {
    const asked = revokes.current;
    try {
      const grants = await api.listGrants();
      if (asked === revokes.current) setList({ status: 'ready', grants });
    } catch (error: unknown) {
      console.warn('Connected assistants - could not load the list:', error);
      setList({ status: 'failed' });
    }
  }, [api]);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      const asked = revokes.current;
      // A refresh that fails leaves the list as it was; only the first load reports a failure.
      void api
        .listGrants()
        .then((grants) => {
          if (asked === revokes.current) setList({ status: 'ready', grants });
        })
        .catch((error: unknown) => console.warn('Connected assistants - could not refresh the list:', error));
    };
    const timer = setInterval(refresh, LIST_REFRESH_MS);
    // A tab that was hidden has missed its refreshes.
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [api, load]);

  const disconnect = async (clientId: string) => {
    setDisconnecting(clientId);
    setDisconnectFailed(null);
    revokes.current++;
    try {
      await api.revokeGrant(clientId);
      revokes.current++;
      setList((previous) =>
        previous.status === 'ready'
          ? { status: 'ready', grants: previous.grants.filter((grant) => grant.client.id !== clientId) }
          : previous,
      );
    } catch (error: unknown) {
      console.warn('Connected assistants - could not disconnect:', error);
      setDisconnectFailed(clientId);
    } finally {
      setDisconnecting(null);
    }
  };

  const button = cx(
    'px-3 py-1 rounded-md text-sm border border-foreground text-foreground hover:bg-lineHighlight disabled:opacity-50',
    compact && 'min-h-11',
  );

  return (
    <div data-testid="connected-assistants" className="space-y-3">
      {list.status === 'loading' && (
        <p className="text-sm text-foreground opacity-70">{t('connectedAssistants.loading')}</p>
      )}

      {list.status === 'failed' && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <p role="alert" className="text-sm text-foreground">
              {t('connectedAssistants.failed')}
            </p>
            <button
              type="button"
              onClick={() => {
                setList({ status: 'loading' });
                void load();
              }}
              className={button}
            >
              {t('connectedAssistants.retry')}
            </button>
          </div>
          <ConnectSteps />
        </>
      )}

      {list.status === 'ready' && list.grants.length === 0 && (
        <>
          <p className="text-sm text-foreground opacity-80">{t('connectedAssistants.empty')}</p>
          <ConnectSteps />
        </>
      )}

      {list.status === 'ready' && list.grants.length > 0 && (
        <>
          <ul className="space-y-2">
            {list.grants.map((grant) => (
              <li key={grant.client.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground break-words">
                    {grant.client.name || t('connectedAssistants.unnamed')}
                  </p>
                  <p className="text-xs text-foreground opacity-70">
                    {t('connectedAssistants.connectedOn', { date: connectedDate(grant.granted_at, i18n.language) })}
                  </p>
                  {disconnectFailed === grant.client.id && (
                    <p role="alert" className="text-xs text-foreground">
                      {t('connectedAssistants.disconnectFailed')}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  disabled={disconnecting !== null}
                  onClick={() => void disconnect(grant.client.id)}
                  className={button}
                >
                  {disconnecting === grant.client.id
                    ? t('connectedAssistants.disconnecting')
                    : t('connectedAssistants.disconnect')}
                </button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-foreground opacity-60 leading-relaxed">{t('connectedAssistants.help')}</p>
          <details data-testid="connect-another">
            <summary className={cx('cursor-pointer text-sm text-foreground', compact && 'min-h-11 flex items-center')}>
              {t('connectedAssistants.connectAnother')}
            </summary>
            <div className="mt-3">
              <ConnectSteps />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
