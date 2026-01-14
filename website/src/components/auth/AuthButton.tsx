import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { useTranslation } from 'react-i18next';

interface AuthButtonProps {
  className?: string;
  showProfile?: boolean;
}

export function AuthButton({ className = '', showProfile = true }: AuthButtonProps) {
  const { user, signInWithGoogle, signOut, loading } = useAuth();
  const { t } = useTranslation(['auth', 'common']);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
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
      // You might want to show a toast notification here
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

  // Extract user display information
  const getUserDisplayInfo = () => {
    if (!user) return null;

    const metadata = user.user_metadata || {};
    const fullName = metadata.full_name || metadata.name || user.name || '';
    const firstName = metadata.given_name || '';
    const lastName = metadata.family_name || '';
    const avatarUrl = metadata.avatar_url || metadata.picture || user.avatar || '';
    const email = user.email || '';

    // Try to construct full name from parts if not available
    let displayName = fullName;
    if (!displayName && (firstName || lastName)) {
      displayName = `${firstName} ${lastName}`.trim();
    }
    if (!displayName) {
      displayName = email;
    }

    // Get initials for avatar fallback
    let initials = 'U';
    if (firstName && lastName) {
      initials = `${firstName[0]}${lastName[0]}`.toUpperCase();
    } else if (displayName) {
      const nameParts = displayName.split(' ');
      if (nameParts.length >= 2) {
        initials = `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
      } else {
        initials = displayName[0].toUpperCase();
      }
    }

    return {
      displayName,
      firstName,
      lastName,
      email,
      avatarUrl,
      initials,
    };
  };

  if (loading) {
    return (
      <div className={`flex items-center ${className}`}>
        <div className="w-8 h-8 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="w-full flex justify-center">
        <button
          onClick={handleSignIn}
          disabled={isSigningIn}
          className={`
            flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg
            hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
            disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200
            ${className}
          `}
        >
          {isSigningIn ? (
            <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
          ) : (
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path
                fill="currentColor"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="currentColor"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="currentColor"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              />
              <path
                fill="currentColor"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
          )}
          <span className="text-sm font-medium">
            {isSigningIn ? t('auth:signingIn') : t('auth:signInWithGoogle')}
          </span>
        </button>
      </div>
    );
  }

  if (!showProfile) {
    return (
      <button
        onClick={handleSignOut}
        className={`
          px-4 py-2 text-sm font-medium text-red-600 hover:text-red-700
          hover:bg-red-50 rounded-lg transition-colors duration-200
          ${className}
        `}
      >
        {t('auth:signOut')}
      </button>
    );
  }

  const userInfo = getUserDisplayInfo();
  if (!userInfo) return null;

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-3 p-2 rounded-lg hover:bg-lineHighlight transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-expanded={showDropdown}
        aria-haspopup="true"
      >
        {/* Avatar */}
        <div className="w-8 h-8 rounded-full overflow-hidden border border-gray-200 bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-semibold shadow-sm">
          {userInfo.avatarUrl ? (
            <img
              src={userInfo.avatarUrl}
              alt={userInfo.displayName}
              className="w-full h-full object-cover"
              onError={(e) => {
                // Hide image on error and show initials fallback
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
              }}
            />
          ) : null}
          <span className={userInfo.avatarUrl ? 'hidden' : 'block'}>
            {userInfo.initials}
          </span>
        </div>

        {/* User info - hidden on small screens */}
        <div className="hidden sm:block text-left min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground truncate">
            {userInfo.displayName}
          </div>
          {userInfo.displayName !== userInfo.email && (
            <div className="text-xs text-foreground opacity-70 truncate">
              {userInfo.email}
            </div>
          )}
        </div>

        {/* Dropdown arrow */}
        <svg
          className={`w-4 h-4 text-foreground opacity-70 transition-transform duration-200 flex-shrink-0 ${
            showDropdown ? 'rotate-180' : ''
          }`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown menu */}
      {showDropdown && (
        <div className="absolute right-0 mt-2 w-64 bg-background rounded-lg shadow-lg border border-gray-600 z-50 overflow-hidden">
          {/* User info header */}
          <div className="p-4 border-b border-gray-600 bg-lineHighlight">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full overflow-hidden border border-gray-500 bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-sm font-semibold">
                {userInfo.avatarUrl ? (
                  <img
                    src={userInfo.avatarUrl}
                    alt={userInfo.displayName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Hide image on error and show initials fallback
                      const target = e.target as HTMLImageElement;
                      target.style.display = 'none';
                    }}
                  />
                ) : null}
                <span className={userInfo.avatarUrl ? 'hidden' : 'block'}>
                  {userInfo.initials}
                </span>
              </div>
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

          {/* Menu items */}
          <div className="p-1">
            {/* Profile info (for mobile) */}
            <div className="sm:hidden px-3 py-2 border-b border-gray-600 mb-1">
              <div className="text-sm font-medium text-foreground">
                {userInfo.displayName}
              </div>
              <div className="text-xs text-foreground opacity-70">
                {userInfo.email}
              </div>
            </div>

            {/* Sign out button */}
            <button
              onClick={handleSignOut}
              className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-red-900/20 rounded-md transition-colors duration-200 flex items-center gap-2"
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
