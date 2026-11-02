/**
 * /oauth/consent: where Supabase's OAuth server sends the user to approve an assistant (spec 018).
 * Minimum form for now: the client's name, what it may do, where it returns, Allow and Deny.
 *
 * The only navigations here are to /login, keeping `authorization_id`, and to a `redirect_url`
 * exactly as the API returned it. Nothing from this page's own URL can choose where the browser goes.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loginUrlFor } from '../../lib/authRedirect';
import {
  createOAuthServerApi,
  isOAuthRedirect,
  isSessionRejected,
  type OAuthAuthorizationDetails,
  type OAuthServerApi,
} from '../../lib/oauthServerApi';
import { supabase } from '../../lib/supabase';
import '../../i18n/i18n';

export interface ConsentPageDeps {
  api: OAuthServerApi;
  navigate: (url: string) => void;
}

function defaultDeps(): ConsentPageDeps {
  return {
    api: createOAuthServerApi({
      supabaseUrl: import.meta.env.PUBLIC_SUPABASE_URL,
      anonKey: import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
      getAccessToken: async () => {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        return data.session?.access_token ?? null;
      },
    }),
    navigate: (url) => window.location.replace(url),
  };
}

/** A client chooses its own name but not this: the place the browser really goes back to. */
function returnHost(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    return url.host || url.protocol;
  } catch {
    return redirectUri;
  }
}

type State =
  | { status: 'loading' }
  | { status: 'redirecting' }
  | { status: 'missing' }
  | { status: 'failed' }
  | { status: 'ready'; details: OAuthAuthorizationDetails; busy: boolean; actionFailed: boolean };

export default function ConsentPage({ deps: injected }: { deps?: ConsentPageDeps }) {
  const { t } = useTranslation('auth');
  const [deps] = useState(() => injected ?? defaultDeps());
  const [state, setState] = useState<State>({ status: 'loading' });

  const authorizationId = new URLSearchParams(window.location.search).get('authorization_id');
  const goToLogin = () => deps.navigate(loginUrlFor(window.location.pathname + window.location.search));

  useEffect(() => {
    document.title = `${t('consent.title')} - Strudel`;
  }, [t]);

  useEffect(() => {
    if (!authorizationId) {
      setState({ status: 'missing' });
      return;
    }
    let cancelled = false;
    deps.api
      .getAuthorizationDetails(authorizationId)
      .then((data) => {
        if (cancelled) return;
        if (isOAuthRedirect(data)) {
          // Consent was given before, so Supabase needs no decision.
          setState({ status: 'redirecting' });
          deps.navigate(data.redirect_url);
        } else {
          setState({ status: 'ready', details: data, busy: false, actionFailed: false });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (isSessionRejected(error)) {
          goToLogin();
        } else {
          console.warn('Consent page - could not read the authorization request:', error);
          setState({ status: 'failed' });
        }
      });
    return () => {
      cancelled = true;
    };
    // Runs once: the id is fixed for the life of the page, and deps never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (details: OAuthAuthorizationDetails, action: 'approve' | 'deny') => {
    setState({ status: 'ready', details, busy: true, actionFailed: false });
    try {
      const { redirect_url } = await deps.api[action](details.authorization_id);
      setState({ status: 'redirecting' });
      deps.navigate(redirect_url);
    } catch (error: unknown) {
      if (isSessionRejected(error)) {
        goToLogin();
      } else {
        console.warn('Consent page - could not send the decision:', error);
        setState({ status: 'ready', details, busy: false, actionFailed: true });
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center p-4 sm:p-8">
      <div className="bg-white rounded-xl p-4 sm:p-8 shadow-2xl w-full max-w-md text-center text-gray-900">
        <img src="/logo.svg" alt="" width="64" height="64" className="mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-4">{t('consent.title')}</h1>

        {state.status === 'loading' && <p className="text-gray-600">{t('consent.loading')}</p>}
        {state.status === 'redirecting' && <p className="text-gray-600">{t('consent.redirecting')}</p>}
        {state.status === 'missing' && <p className="text-red-600">{t('consent.missingRequest')}</p>}
        {state.status === 'failed' && <p className="text-red-600">{t('consent.failed')}</p>}

        {state.status === 'ready' && (
          <>
            <p className="mb-3 text-gray-700">
              {t('consent.request', { client: state.details.client?.name || t('consent.unnamedClient') })}
            </p>
            <p className="mb-3 text-gray-700">{t('consent.access')}</p>
            <p className="mb-6 text-sm text-gray-600">
              {t('consent.returnsTo', { host: returnHost(state.details.redirect_uri) })}
            </p>
            {state.actionFailed && (
              <p role="alert" className="mb-4 text-red-600 text-sm">
                {t('consent.actionFailed')}
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                type="button"
                data-testid="consent-deny"
                disabled={state.busy}
                onClick={() => void decide(state.details, 'deny')}
                className="min-h-11 px-6 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 disabled:opacity-50"
              >
                {t('consent.deny')}
              </button>
              <button
                type="button"
                data-testid="consent-allow"
                disabled={state.busy}
                onClick={() => void decide(state.details, 'approve')}
                className="min-h-11 px-6 py-2 rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {t('consent.allow')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
