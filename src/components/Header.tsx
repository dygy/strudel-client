import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAppStore } from '../stores/appStore';

export const Header: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { 
    sidebarOpen, 
    setSidebarOpen, 
    currentProject, 
    isPlaying, 
    togglePlayback,
  } = useAppStore();

  return (
    <header className="h-14 bg-gray-50 dark:bg-dark-800 border-b border-gray-200 dark:border-dark-700 flex items-center justify-between px-4">
      <div className="flex items-center space-x-4">
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-dark-700 transition-colors"
          aria-label="Toggle sidebar"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        
        <div className="flex items-center space-x-2">
          <h1 className="text-xl font-bold text-primary-600 dark:text-primary-400">
            Strudel
          </h1>
          {currentProject && (
            <span className="text-sm text-gray-600 dark:text-gray-400">
              / {currentProject.name}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center space-x-4">
        {/* Transport Controls */}
        <div className="flex items-center space-x-2">
          <button
            onClick={togglePlayback}
            className={`p-2 rounded-md transition-colors ${
              isPlaying 
                ? 'bg-red-500 hover:bg-red-600 text-white' 
                : 'bg-green-500 hover:bg-green-600 text-white'
            }`}
            aria-label={isPlaying ? 'Stop' : 'Play'}
          >
            {isPlaying ? (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>
        </div>

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 rounded-md hover:bg-gray-200 dark:hover:bg-dark-700 transition-colors"
          aria-label="Toggle theme"
        >
          {theme === 'dark' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
      </div>
    </header>
  );
};