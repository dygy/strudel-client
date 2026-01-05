import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface LoginPageProps {
  error?: string;
  hasTrack?: boolean;
}

export default function LoginPage({ error, hasTrack }: LoginPageProps) {
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [showLanguageDropdown, setShowLanguageDropdown] = useState(false);

  // Translations
  const translations = {
    en: {
      'title': 'Strudel',
      'welcome-title': 'Welcome to Strudel',
      'welcome-subtitle': 'Live coding environment for musical patterns',
      'error-prefix': 'Authentication issue:',
      'error-suffix': 'Please sign in again.',
      'track-access-description': 'Sign in to access this shared track and sync your music across devices.',
      'sign-in-description': 'Sign in to sync your tracks across devices and access cloud features.',
      'sign-in-button': 'Continue with Google',
      'sign-in-footer': 'Sign in to access all features and sync your tracks to the cloud.'
    },
    es: {
      'title': 'Strudel',
      'welcome-title': 'Bienvenido a Strudel',
      'welcome-subtitle': 'Entorno de codificación en vivo para patrones musicales',
      'error-prefix': 'Problema de autenticación:',
      'error-suffix': 'Por favor, inicia sesión de nuevo.',
      'track-access-description': 'Inicia sesión para acceder a esta pista compartida y sincronizar tu música en todos los dispositivos.',
      'sign-in-description': 'Inicia sesión para sincronizar tus pistas en todos los dispositivos y acceder a las funciones de la nube.',
      'sign-in-button': 'Continuar con Google',
      'sign-in-footer': 'Inicia sesión para acceder a todas las funciones y sincronizar tus pistas en la nube.'
    },
    fr: {
      'title': 'Strudel',
      'welcome-title': 'Bienvenue sur Strudel',
      'welcome-subtitle': 'Environnement de codage en direct pour les motifs musicaux',
      'error-prefix': 'Problème d\'authentification:',
      'error-suffix': 'Veuillez vous reconnecter.',
      'track-access-description': 'Connectez-vous pour accéder à cette piste partagée et synchroniser votre musique sur tous vos appareils.',
      'sign-in-description': 'Connectez-vous pour synchroniser vos pistes sur tous vos appareils et accéder aux fonctionnalités cloud.',
      'sign-in-button': 'Continuer avec Google',
      'sign-in-footer': 'Connectez-vous pour accéder à toutes les fonctionnalités et synchroniser vos pistes dans le cloud.'
    },
    ru: {
      'title': 'Strudel',
      'welcome-title': 'Добро пожаловать в Strudel',
      'welcome-subtitle': 'Среда живого кодирования для музыкальных паттернов',
      'error-prefix': 'Проблема аутентификации:',
      'error-suffix': 'Пожалуйста, войдите снова.',
      'track-access-description': 'Войдите, чтобы получить доступ к этому общему треку и синхронизировать музыку на всех устройствах.',
      'sign-in-description': 'Войдите, чтобы синхронизировать треки на всех устройствах и получить доступ к облачным функциям.',
      'sign-in-button': 'Продолжить с Google',
      'sign-in-footer': 'Войдите, чтобы получить доступ ко всем функциям и синхронизировать треки в облаке.'
    },
    ar: {
      'title': 'Strudel',
      'welcome-title': 'مرحباً بك في Strudel',
      'welcome-subtitle': 'بيئة البرمجة المباشرة للأنماط الموسيقية',
      'error-prefix': 'مشكلة في المصادقة:',
      'error-suffix': 'يرجى تسجيل الدخول مرة أخرى.',
      'track-access-description': 'سجل الدخول للوصول إلى هذا المسار المشترك ومزامنة موسيقاك عبر الأجهزة.',
      'sign-in-description': 'سجل الدخول لمزامنة مساراتك عبر الأجهزة والوصول إلى ميزات السحابة.',
      'sign-in-button': 'المتابعة مع Google',
      'sign-in-footer': 'سجل الدخول للوصول إلى جميع الميزات ومزامنة مساراتك في السحابة.'
    },
    he: {
      'title': 'Strudel',
      'welcome-title': 'ברוכים הבאים ל-Strudel',
      'welcome-subtitle': 'סביבת קידוד חי לדפוסים מוזיקליים',
      'error-prefix': 'בעיית אימות:',
      'error-suffix': 'אנא התחבר שוב.',
      'track-access-description': 'התחבר כדי לגשת לרצועה המשותפת הזו ולסנכרן את המוזיקה שלך בין המכשירים.',
      'sign-in-description': 'התחבר כדי לסנכרן את הרצועות שלך בין המכשירים ולגשת לתכונות הענן.',
      'sign-in-button': 'המשך עם Google',
      'sign-in-footer': 'התחבר כדי לגשת לכל התכונות ולסנכרן את הרצועות שלך בענן.'
    },
    sr: {
      'title': 'Strudel',
      'welcome-title': 'Добродошли у Strudel',
      'welcome-subtitle': 'Окружење за живо кодирање музичких образаца',
      'error-prefix': 'Проблем са аутентификацијом:',
      'error-suffix': 'Молимо пријавите се поново.',
      'track-access-description': 'Пријавите се да приступите овој дељеној нумери и синхронизујете музику на свим уређајима.',
      'sign-in-description': 'Пријавите се да синхронизујете нумере на свим уређајима и приступите функцијама облака.',
      'sign-in-button': 'Настави са Google',
      'sign-in-footer': 'Пријавите се да приступите свим функцијама и синхронизујете нумере у облаку.'
    }
  };

  const languageNames = {
    'en': 'English',
    'es': 'Español', 
    'fr': 'Français',
    'ru': 'Русский',
    'ar': 'العربية',
    'he': 'עברית',
    'sr': 'Српски'
  };

  useEffect(() => {
    // Load saved language preference
    const savedLanguage = localStorage.getItem('strudel-language') || 'en';
    if (languageNames[savedLanguage as keyof typeof languageNames]) {
      setCurrentLanguage(savedLanguage);
    }

    // Set document direction for RTL languages
    if (savedLanguage === 'ar' || savedLanguage === 'he') {
      document.documentElement.dir = 'rtl';
      document.documentElement.classList.add('rtl');
    } else {
      document.documentElement.dir = 'ltr';
      document.documentElement.classList.remove('rtl');
    }
    
    document.documentElement.lang = savedLanguage;
  }, []);

  const t = (key: string) => {
    const langTranslations = translations[currentLanguage as keyof typeof translations] || translations.en;
    return langTranslations[key as keyof typeof langTranslations] || key;
  };

  const setLanguage = (code: string, name: string) => {
    setCurrentLanguage(code);
    setShowLanguageDropdown(false);
    
    // Store language preference
    localStorage.setItem('strudel-language', code);
    
    // Set document direction for RTL languages
    if (code === 'ar' || code === 'he') {
      document.documentElement.dir = 'rtl';
      document.documentElement.classList.add('rtl');
    } else {
      document.documentElement.dir = 'ltr';
      document.documentElement.classList.remove('rtl');
    }
    
    document.documentElement.lang = code;
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-500 to-purple-600 flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center p-4 bg-white bg-opacity-10 backdrop-blur-md">
        <div className="flex items-center gap-2 text-white text-xl font-bold">
          <img src="/logo.svg" alt="Strudel Logo" className="w-8 h-8" />
          <span>{t('title')}</span>
        </div>
        
        <div className="relative">
          <button
            className="bg-white bg-opacity-20 text-white border border-white border-opacity-30 px-4 py-2 rounded-md text-sm flex items-center gap-2 hover:bg-opacity-30"
            onClick={() => setShowLanguageDropdown(!showLanguageDropdown)}
          >
            <span>{languageNames[currentLanguage as keyof typeof languageNames]}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          
          {showLanguageDropdown && (
            <div className="absolute top-full right-0 mt-2 bg-white rounded-md shadow-lg min-w-[150px] z-10">
              {Object.entries(languageNames).map(([code, name]) => (
                <div
                  key={code}
                  className="px-4 py-3 cursor-pointer text-gray-700 border-b border-gray-100 last:border-b-0 hover:bg-gray-50"
                  onClick={() => setLanguage(code, name)}
                >
                  {name}
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
            <h1 className="text-3xl font-bold mb-2">{t('welcome-title')}</h1>
            <p className="text-gray-600">{t('welcome-subtitle')}</p>
          </div>
          
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-md mb-6 text-sm">
              <span>{t('error-prefix')}</span> {error}. <span>{t('error-suffix')}</span>
            </div>
          )}
          
          <div className="mb-6">
            <p className="mb-4 text-gray-700">
              {hasTrack ? t('track-access-description') : t('sign-in-description')}
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
              <span>{t('sign-in-button')}</span>
            </button>
          </div>
          
          <p className="text-sm text-gray-600">
            {t('sign-in-footer')}
          </p>
        </div>
      </div>
    </div>
  );
}