import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useTranslation } from 'react-i18next';
import { languages } from '../i18n';
// Import i18n to ensure it's initialized
import '../i18n/i18n';

interface LoginPageProps {
  error?: string;
  hasTrack?: boolean;
}

export default function LoginPage({ error, hasTrack }: LoginPageProps) {
  const { t, i18n } = useTranslation('auth');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [, forceUpdate] = useState({});

  useEffect(() => {
    // Load saved language preference
    const savedLanguage = localStorage.getItem('strudel-language') || 'en';
    console.log('Loading saved language:', savedLanguage);
    console.log('Available languages:', Object.keys(languages));

    if (languages[savedLanguage]) {
      setCurrentLanguage(savedLanguage);
      i18n.changeLanguage(savedLanguage).then(() => {
        console.log('Language changed to:', savedLanguage);
      }).catch(err => {
        console.error('Failed to change language:', err);
      });
    }
  }, [i18n]);

  // Listen for language changes
  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      console.log('Language changed event:', lng);
      setCurrentLanguage(lng);
      // Force component re-render
      forceUpdate({});
    };

    i18n.on('languageChanged', handleLanguageChange);
    return () => {
      i18n.off('languageChanged', handleLanguageChange);
    };
  }, [i18n]);

  const setLanguage = (code: string) => {
    console.log('Setting language to:', code);
    setCurrentLanguage(code);
    setShowLanguageDropdown(false);
    localStorage.setItem('strudel-language', code);

    i18n.changeLanguage(code).then(() => {
      console.log('Successfully changed language to:', code);
    }).catch(err => {
      console.error('Failed to change language to', code, ':', err);
    });
  };

  const signInWithGoogle = async () => {
    try {
      // Store redirect URL if we have track parameter
      const urlParams = new URLSearchParams(window.location.search);
      const trackId = urlParams.get('track');
      if (trackId) {
        sessionStorage.setItem('strudel_redirect_after_auth', `/repl?track=${trackId}`);
      } else {
        sessionStorage.setItem('strudel_redirect_after_auth', '/repl');
      }

      console.log('=== SIGN IN WITH GOOGLE DEBUG ===');
      const currentOrigin = window.location.origin;
      const callbackUrl = currentOrigin + '/auth/callback';
      console.log('Current origin:', currentOrigin);
      console.log('Callback URL:', callbackUrl);
      console.log('Starting OAuth flow...');

      // Use the standard Supabase auth method
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: callbackUrl
        }
      });

      console.log('OAuth result:', { data, error });
      console.log('=== END SIGN IN WITH GOOGLE DEBUG ===');

      if (error) {
        console.error('Sign in error:', error);
        alert('Sign in failed: ' + error.message);
      }
    } catch (error) {
      console.error('Sign in error:', error);
      alert('Sign in failed. Please try again.');
    }
  };

  // Helper function with fallbacks
  const getTranslation = (key: string, fallback: string) => {
    try {
      const translation = t(key);
      return translation !== key ? translation : fallback;
    } catch (error) {
      console.error(`Translation error for ${key}:`, error);
      return fallback;
    }
  };

  return (
    <div key={currentLanguage} className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 bg-white bg-opacity-10 backdrop-blur-md">
        <div className="flex items-center gap-2 text-white text-xl font-bold">
          <img src="/logo.svg" alt="Strudel Logo" className="w-8 h-8" />
          <span>{getTranslation('login.title', 'Strudel')}</span>
        </div>

        <div className="relative">
          <button
            className="bg-white bg-opacity-20 text-white border border-white border-opacity-30 px-4 py-2 rounded-md text-sm flex items-center gap-2 hover:bg-opacity-30"
            onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
          >
            <span>{languages[currentLanguage]?.nativeName || 'English'}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {showLanguageDropdown && (
            <div className="absolute top-full right-0 mt-2 bg-white rounded-md shadow-lg min-w-[150px] z-10">
              {Object.entries(languages).map(([code, lang]) => (
                <div
                  key={code}
                  className="px-4 py-3 cursor-pointer text-gray-700 border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
                  onClick={() => setLanguage(code)}
                >
                  {lang.nativeName}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="bg-white rounded-xl p-8 shadow-2xl max-w-md text-center text-gray-900">
          <div className="mb-8">
            <img src="/logo.svg" alt="Strudel Logo" width="64" height="64" className="mx-auto mb-4 text-blue-500" />
            <h1 className="text-3xl font-bold mb-2">{getTranslation('login.welcomeTitle', 'Welcome to Strudel')}</h1>
            <p className="text-gray-600">{getTranslation('login.welcomeSubtitle', 'Live coding environment for musical patterns')}</p>
          </div>

          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md mb-6 text-sm">
              <span>{getTranslation('login.errorPrefix', 'Authentication issue:')}</span> {error}. <span>{getTranslation('login.errorSuffix', 'Please sign in again.')}</span>
            </div>
          )}

          <div className="mb-6">
            <p className="mb-4 text-gray-700">
              {hasTrack ? getTranslation('login.trackAccessDescription', 'Sign in to access this shared track and sync your music across devices.') : getTranslation('login.signInDescription', 'Sign in to sync your tracks across devices and access cloud features.')}
            </p>

            <button
              className="inline-flex items-center gap-2 bg-blue-500 text-white px-6 py-3 rounded-lg text-base cursor-pointer hover:bg-blue-600 transition-colors"
              onClick={signInWithGoogle}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              <span>{getTranslation('login.signInButton', 'Continue with Google')}</span>
            </button>
          </div>

          <p className="text-sm text-gray-600">
            {getTranslation('login.signInFooter', 'Sign in to access all features and sync your tracks to the cloud.')}
          </p>
        </div>
      </div>
    </div>
  );
}
