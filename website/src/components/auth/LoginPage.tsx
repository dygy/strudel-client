import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const LoginPage: React.FC = () => {
  const [error, setError] = useState<string | null>(null);
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [showDropdown, setShowDropdown] = useState(false);

  // Get environment variables
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL || 'https://iarlunyimplczudavrcl.supabase.co';
  const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlhcmx1bnlpbXBsY3p1ZGF2cmNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcyODczMzksImV4cCI6MjA4Mjg2MzMzOX0.px2ShuMyEogGaoUrRKWupogB1D0Ra2gPF4wNMCGV63w';

  // Create Supabase client
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
    },
  });

  // Language names mapping
  const languageNames = {
    'en': 'English',
    'es': 'Español', 
    'fr': 'Français',
    'ru': 'Русский',
    'ar': 'العربية',
    'he': 'עברית',
    'sr': 'Српски'
  };

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

  useEffect(() => {
    // Only run on client side
    if (typeof window === 'undefined') return;
    
    // Get error from URL params
    const urlParams = new URLSearchParams(window.location.search);
    const errorParam = urlParams.get('error');
    if (errorParam) {
      setError(errorParam);
    }

    // Load saved language preference
    const savedLanguage = localStorage.getItem('strudel-language') || 'en';
    if (languageNames[savedLanguage as keyof typeof languageNames]) {
      setCurrentLanguage(savedLanguage);
    }

    // Close dropdown when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.language-selector')) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const signInWithGoogle = async () => {
    try {
      // Only run on client side
      if (typeof window === 'undefined') return;
      
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
        setError(error.message);
      }
    } catch (error) {
      console.error('Sign in error:', error);
      setError('Sign in failed. Please try again.');
    }
  };

  const toggleLanguageDropdown = () => {
    setShowDropdown(!showDropdown);
  };

  const setLanguage = (code: string, name: string) => {
    setCurrentLanguage(code);
    setShowDropdown(false);
    localStorage.setItem('strudel-language', code);
  };

  const t = (key: string) => {
    const langTranslations = translations[currentLanguage as keyof typeof translations] || translations.en;
    return langTranslations[key as keyof typeof langTranslations] || key;
  };

  // Check for track parameter safely
  const hasTrack = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).has('track') : false;

  const styles = {
    body: {
      margin: 0,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column' as const,
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '1rem 2rem',
      background: 'rgba(255, 255, 255, 0.1)',
      backdropFilter: 'blur(10px)',
    },
    logo: {
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      color: 'white',
      fontSize: '1.25rem',
      fontWeight: 'bold',
    },
    logoImg: {
      width: '32px',
      height: '32px',
    },
    languageSelector: {
      position: 'relative' as const,
    },
    languageButton: {
      background: 'rgba(255, 255, 255, 0.2)',
      color: 'white',
      border: '1px solid rgba(255, 255, 255, 0.3)',
      padding: '0.5rem 1rem',
      borderRadius: '6px',
      cursor: 'pointer',
      fontSize: '0.875rem',
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
    },
    languageDropdown: {
      position: 'absolute' as const,
      top: '100%',
      right: 0,
      marginTop: '0.5rem',
      background: 'white',
      borderRadius: '6px',
      boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
      minWidth: '150px',
      display: showDropdown ? 'block' : 'none',
      zIndex: 10,
    },
    languageOption: {
      padding: '0.75rem 1rem',
      cursor: 'pointer',
      color: '#374151',
      borderBottom: '1px solid #f3f4f6',
    },
    mainContent: {
      flex: 1,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    },
    authCard: {
      background: 'white',
      borderRadius: '12px',
      padding: '2rem',
      boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1)',
      maxWidth: '400px',
      textAlign: 'center' as const,
      color: '#1a1a1a',
    },
    authButton: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '0.5rem',
      background: '#4285f4',
      color: 'white',
      padding: '0.75rem 1.5rem',
      border: 'none',
      borderRadius: '8px',
      fontSize: '1rem',
      cursor: 'pointer',
      textDecoration: 'none',
      transition: 'background-color 0.2s',
      margin: '0.5rem',
    },
    errorMessage: {
      background: '#fee2e2',
      color: '#dc2626',
      padding: '0.75rem',
      borderRadius: '6px',
      marginBottom: '1rem',
      fontSize: '0.875rem',
    },
  };

  return (
    <div style={styles.body}>
      <div style={styles.header}>
        <div style={styles.logo}>
          <img src="/logo.svg" alt="Strudel Logo" style={styles.logoImg} />
          <span>{t('title')}</span>
        </div>
        
        <div className="language-selector" style={styles.languageSelector}>
          <button style={styles.languageButton} onClick={toggleLanguageDropdown}>
            <span>{languageNames[currentLanguage as keyof typeof languageNames]}</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
          <div style={styles.languageDropdown}>
            {Object.entries(languageNames).map(([code, name]) => (
              <div
                key={code}
                style={styles.languageOption}
                onClick={() => setLanguage(code, name)}
                onMouseEnter={(e) => (e.target as HTMLElement).style.background = '#f9fafb'}
                onMouseLeave={(e) => (e.target as HTMLElement).style.background = 'transparent'}
              >
                {name}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={styles.mainContent}>
        <div style={styles.authCard}>
          <div style={{ marginBottom: '2rem' }}>
            <img src="/logo.svg" alt="Strudel Logo" width="64" height="64" style={{ margin: '0 auto 1rem', color: '#667eea' }} />
            <h1 style={{ margin: '0 0 0.5rem', fontSize: '2rem', fontWeight: 'bold' }}>{t('welcome-title')}</h1>
            <p style={{ margin: 0, color: '#6b7280' }}>{t('welcome-subtitle')}</p>
          </div>
          
          {error && (
            <div style={styles.errorMessage}>
              <span>{t('error-prefix')}</span> {error}. <span>{t('error-suffix')}</span>
            </div>
          )}
          
          <div style={{ marginBottom: '1.5rem' }}>
            <p style={{ margin: '0 0 1rem', color: '#374151' }}>
              {hasTrack ? t('track-access-description') : t('sign-in-description')}
            </p>
            
            <button 
              style={styles.authButton} 
              onClick={signInWithGoogle}
              onMouseEnter={(e) => (e.target as HTMLElement).style.background = '#3367d6'}
              onMouseLeave={(e) => (e.target as HTMLElement).style.background = '#4285f4'}
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
          
          <p style={{ margin: 0, fontSize: '0.875rem', color: '#6b7280' }}>
            {t('sign-in-footer')}
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;