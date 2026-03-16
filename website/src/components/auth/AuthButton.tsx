import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { isAdmin } from '../../lib/adminAuth';

interface AuthButtonProps {
  className?: string;
  showProfile?: boolean;
}

/**
 * Cache avatar as a blob URL to avoid hammering Google's CDN (429s).
 * Stored in sessionStorage so it survives re-renders but not tabs.
 */
const AVATAR_CACHE_KEY = 'strudel-avatar-blob';
const AVATAR_SRC_KEY = 'strudel-avatar-src';

function useCachedAvatar(remoteUrl: string | undefined) {
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!remoteUrl) {
      setLocalUrl(null);
      return;
    }

    // If we already cached this exact URL, reuse it
    try {
      const cachedSrc = sessionStorage.getItem(AVATAR_SRC_KEY);
      const cachedBlob = sessionStorage.getItem(AVATAR_CACHE_KEY);
      if (cachedSrc === remoteUrl && cachedBlob) {
        setLocalUrl(cachedBlob);
        return;
      }
    } catch { /* sessionStorage unavailable */ }

    let cancelled = false;

    fetch(remoteUrl)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        setLocalUrl(url);
        try {
          // Store as data URL for sessionStorage persistence
          const reader = new FileReader();
          reader.onloadend = () => {
            if (typeof reader.result === 'string') {
              sessionStorage.setItem(AVATAR_CACHE_KEY, reader.result);
              sessionStorage.setItem(AVATAR_SRC_KEY, remoteUrl);
            }
          };
          reader.readAsDataURL(blob);
        } catch { /* non-fatal */ }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [remoteUrl]);

  return { avatarUrl: localUrl, avatarFailed: failed || !remoteUrl };
}


export function AuthButton({ className = '', showProfile = true }: AuthButtonProps) {
  const { user, signInWithGoogle, signOut, loading } = useAuth();
  const { t } = useTranslation(['auth', 'common']);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    if (showDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showDropdown]);

  const handleSignIn = async () => {
    try {
      setIsSigningIn(true);
      await signInWithGoogle();
    } catch (error) {
      console.error('Sign in failed:', error);
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    try {
      await signOut();
      setShowDropdown(false);
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  const getUserDisplayInfo = () => {
    if (!user) return null;
    const metadata = user.user_metadata || {};
    const fullName = metadata.full_name || metadata.name || user.name || '';
    const firstName = metadata.given_name || '';
    const lastName = metadata.family_name || '';
    const avatarUrl = metadata.avatar_url || metadata.picture || user.avatar || '';
    const email = user.email || '';

    let displayName = fullName;
    if (!displayName && (firstName || lastName)) {
      displayName = `${firstName} ${lastName}`.trim();
    }
    if (!displayName) displayName = email;

    let initials = 'U';
    if (firstName && lastName) {
      initials = `${firstName[0]}${lastName[0]}`.toUpperCase();
    } else if (displayName) {
      const parts = displayName.split(' ');
      initials = parts.length >= 2
        ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
        : displayName[0].toUpperCase();
    }

    return { displayName, email, avatarUrl, initials };
  };

  const userInfo = getUserDisplayInfo();

  // Cache avatar to avoid 429s from Google CDN
  const { avatarUrl: cachedAvatar, avatarFailed } = useCachedAvatar(userInfo?.avatarUrl);

  if (loading) {
    return (
      <div className={`flex items-center ${className}`}>
        <div className="w-6 h-6 border-2 border-lineHighlight border-t-blue-400 rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return (
      <button
        onClick={handleSignIn}
        disabled={isSigningIn}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-md
          bg-lineHighlight border border-lineHighlight
          hover:bg-background hover:scale-105
          focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50
          disabled:opacity-50 disabled:cursor-not-allowed
          transition-all duration-200 ease-out
          text-foreground text-sm cursor-pointer
          ${className}
        `}
      >
        {isSigningIn ? (
          <div className="w-4 h-4 border-2 border-lineHighlight border-t-blue-400 rounded-full animate-spin" />
        ) : (
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
        )}
        <span className="font-medium">
          {isSigningIn ? t('auth:signingIn') : 'Sign in'}
        </span>
      </button>
    );
  }

  if (!showProfile) {
    return (
      <button
        onClick={handleSignOut}
        className={`
          px-3 py-1.5 text-sm font-medium text-red-400 hover:text-red-300
          hover:bg-red-900 hover:bg-opacity-20 rounded-md transition-all duration-200
          ${className}
        `}
      >
        {t('auth:signOut')}
      </button>
    );
  }

  if (!userInfo) return null;

  /* Avatar circle — reused in trigger and dropdown */
  const Avatar = ({ size = 'w-7 h-7' }: { size?: string }) => (
    <div className={`${size} rounded-full overflow-hidden border border-lineHighlight bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0`}>
      {cachedAvatar && !avatarFailed ? (
        <img src={cachedAvatar} alt="" className="w-full h-full object-cover" />
      ) : (
        <span>{userInfo.initials}</span>
      )}
    </div>
  );

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Trigger — avatar only, compact for header */}
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center rounded-full hover:scale-110 hover:shadow-[0_0_8px_rgba(59,130,246,0.3)] transition-all duration-200 focus:outline-none cursor-pointer"
        aria-expanded={showDropdown}
        aria-haspopup="true"
        title={userInfo.displayName}
      >
        <Avatar />
      </button>

      {/* Dropdown */}
      {showDropdown && (
        <div className="absolute right-0 mt-2 w-64 bg-background rounded-lg shadow-[0_8px_32px_rgba(0,0,0,0.6)] border border-lineHighlight z-[100] overflow-hidden animate-[popoverIn_0.18s_ease-out]">
          {/* User info header */}
          <div className="p-4 border-b border-lineHighlight bg-lineHighlight">
            <div className="flex items-center gap-3">
              <Avatar size="w-10 h-10" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-foreground truncate">
                  {userInfo.displayName}
                </div>
                <div className="text-xs text-foreground opacity-70 truncate">
                  {userInfo.email}
                </div>
              </div>
            </div>
          </div>

          <div className="p-1">
            {isAdmin(userInfo.email) && (
              <a
                href="/admin"
                className="w-full text-left px-3 py-2 text-sm text-yellow-400 hover:bg-yellow-900 hover:bg-opacity-20 rounded-md transition-colors duration-200 flex items-center gap-2"
                onClick={() => setShowDropdown(false)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Admin Dashboard
              </a>
            )}

            <button
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-900 hover:bg-opacity-20 rounded-md transition-colors duration-200 flex items-center gap-2 cursor-pointer"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              {t('auth:signOut')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
