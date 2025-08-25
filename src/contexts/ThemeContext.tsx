import React, { createContext, useContext, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import type { Theme } from '../types/index';

interface ThemeContextType {
  theme: Theme;
  followSystemTheme: boolean;
  toggleTheme: () => void;
  setFollowSystemTheme: (follow: boolean) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const theme = useAppStore((state) => state.theme);
  const followSystemTheme = useAppStore((state) => state.followSystemTheme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const setFollowSystemTheme = useAppStore((state) => state.setFollowSystemTheme);

  // Listen for OS theme changes
  useEffect(() => {
    if (!followSystemTheme) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleThemeChange = (e: MediaQueryListEvent) => {
      if (followSystemTheme) {
        const newTheme = e.matches ? 'dark' : 'light';
        useAppStore.setState({ theme: newTheme });
      }
    };

    mediaQuery.addEventListener('change', handleThemeChange);
    
    return () => {
      mediaQuery.removeEventListener('change', handleThemeChange);
    };
  }, [followSystemTheme]);

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove('light', 'dark');
    root.classList.add(theme);
    
    // Force a re-render of Monaco editor themes
    setTimeout(() => {
      window.dispatchEvent(new Event('theme-changed'));
    }, 100);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, followSystemTheme, toggleTheme, setFollowSystemTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};