/**
 * Settings → Connected assistants (spec 018, functional 2.2): who is connected, since when, and a
 * Disconnect button. Reads and revokes through Supabase's OAuth server with the user's own token.
 */
import { useCallback, useEffect, useState } from 'react';
import cx from '@src/cx';
import { useTranslation } from '@src/i18n';
import { createOAuthServerApi, type OAuthGrant, type OAuthServerApi } from '@src/lib/oauthServerApi';
import { supabase } from '@src/lib/supabase';
import { usePanelViewport } from './panelViewport';

/** The setup page (spec 018, task slice 9). */
export const SETUP_PAGE_URL = '/learn/ai-assistants';

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

  const load = useCallback(async () => {
    setList({ status: 'loading' });
    try {
      setList({ status: 'ready', grants: await api.listGrants() });
    } catch (error: unknown) {
      console.warn('Connected assistants - could not load the list:', error);
      setList({ status: 'failed' });
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = async (clientId: string) => {
    setDisconnecting(clientId);
    setDisconnectFailed(null);
    try {
      await api.revokeGrant(clientId);
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
        <div className="flex flex-wrap items-center gap-3">
          <p role="alert" className="text-sm text-foreground">
            {t('connectedAssistants.failed')}
          </p>
          <button type="button" onClick={() => void load()} className={button}>
            {t('connectedAssistants.retry')}
          </button>
        </div>
      )}

      {list.status === 'ready' && list.grants.length === 0 && (
        <p className="text-sm text-foreground opacity-80">
          {t('connectedAssistants.empty')}{' '}
          <a href={SETUP_PAGE_URL} className="underline">
            {t('connectedAssistants.setupLink')}
          </a>
        </p>
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
        </>
      )}
    </div>
  );
}
