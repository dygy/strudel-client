// Login page authentication script
import { createClient } from 'https://cdn.skypack.dev/@supabase/supabase-js@2';

// Create Supabase client using environment variables
const supabase = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
    },
});

// Import translations from the existing auth.json files
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

let currentLanguage = 'en';

// Apply translations
function applyTranslations(lang) {
    const langTranslations = translations[lang] || translations.en;
    document.querySelectorAll('[data-i18n]').forEach(element => {
        const key = element.getAttribute('data-i18n');
        if (langTranslations[key]) {
            element.textContent = langTranslations[key];
        }
    });
    
    // Set document direction for RTL languages
    if (lang === 'ar' || lang === 'he') {
        document.documentElement.dir = 'rtl';
        document.documentElement.classList.add('rtl');
    } else {
        document.documentElement.dir = 'ltr';
        document.documentElement.classList.remove('rtl');
    }
    
    document.documentElement.lang = lang;
}

async function signInWithGoogle() {
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
        
        // Use the standard Supabase auth method with the already initialized client
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
}

function toggleLanguageDropdown() {
    const dropdown = document.getElementById('language-dropdown');
    dropdown.classList.toggle('show');
}

function setLanguage(code, name) {
    currentLanguage = code;
    document.getElementById('current-language').textContent = name;
    document.getElementById('language-dropdown').classList.remove('show');
    
    // Store language preference
    localStorage.setItem('strudel-language', code);
    
    // Apply translations
    applyTranslations(code);
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    const selector = document.querySelector('.language-selector');
    if (!selector.contains(event.target)) {
        document.getElementById('language-dropdown').classList.remove('show');
    }
});

// Load saved language preference and apply translations
const savedLanguage = localStorage.getItem('strudel-language') || 'en';
if (languageNames[savedLanguage]) {
    currentLanguage = savedLanguage;
    document.getElementById('current-language').textContent = languageNames[savedLanguage];
    applyTranslations(savedLanguage);
}

// Make functions global
window.signInWithGoogle = signInWithGoogle;
window.toggleLanguageDropdown = toggleLanguageDropdown;
window.setLanguage = setLanguage;