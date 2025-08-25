import React from 'react';
import { useTheme } from '../contexts/ThemeContext';
import { useAppStore } from '../stores/appStore';

export const SettingsPage: React.FC = () => {
  const { theme, followSystemTheme, toggleTheme, setFollowSystemTheme } = useTheme();
  const { settings, updateSettings } = useAppStore();

  return (
    <div className="h-full p-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Settings</h1>
        
        <div className="space-y-6">
          {/* Theme Settings */}
          <div className="bg-gray-50 dark:bg-dark-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Appearance</h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Follow System Theme</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Automatically switch between light and dark mode based on your OS preference
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={followSystemTheme}
                    onChange={(e) => setFollowSystemTheme(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {!followSystemTheme && (
                <div className="flex items-center justify-between">
                  <div>
                    <label className="text-sm font-medium">Theme</label>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      Choose your preferred theme
                    </p>
                  </div>
                  <button
                    onClick={toggleTheme}
                    className="flex items-center space-x-2 px-3 py-2 bg-gray-200 dark:bg-dark-700 rounded-md hover:bg-gray-300 dark:hover:bg-dark-600 transition-colors"
                  >
                    {theme === 'dark' ? (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                        </svg>
                        <span className="text-sm">Dark</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                        </svg>
                        <span className="text-sm">Light</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Editor Settings */}
          <div className="bg-gray-50 dark:bg-dark-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Editor</h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Font Size</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Code editor font size
                  </p>
                </div>
                <select
                  value={settings.editorFontSize}
                  onChange={(e) => updateSettings({ editorFontSize: parseInt(e.target.value) })}
                  className="px-3 py-2 bg-white dark:bg-dark-700 border border-gray-300 dark:border-dark-600 rounded-md text-sm"
                >
                  <option value={12}>12px</option>
                  <option value={14}>14px</option>
                  <option value={16}>16px</option>
                  <option value={18}>18px</option>
                  <option value={20}>20px</option>
                </select>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Key Bindings</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Editor keyboard shortcuts
                  </p>
                </div>
                <select
                  value={settings.keyBindings}
                  onChange={(e) => updateSettings({ keyBindings: e.target.value as 'default' | 'vim' | 'emacs' })}
                  className="px-3 py-2 bg-white dark:bg-dark-700 border border-gray-300 dark:border-dark-600 rounded-md text-sm"
                >
                  <option value="default">Default</option>
                  <option value="vim">Vim</option>
                  <option value="emacs">Emacs</option>
                </select>
              </div>
            </div>
          </div>

          {/* Audio Settings */}
          <div className="bg-gray-50 dark:bg-dark-800 rounded-lg p-6">
            <h2 className="text-lg font-semibold mb-4">Audio</h2>
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Default BPM</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Default tempo for new projects
                  </p>
                </div>
                <input
                  type="number"
                  min="60"
                  max="200"
                  value={settings.defaultBpm}
                  onChange={(e) => updateSettings({ defaultBpm: parseInt(e.target.value) })}
                  className="w-20 px-3 py-2 bg-white dark:bg-dark-700 border border-gray-300 dark:border-dark-600 rounded-md text-sm"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Default Volume</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Default volume for new projects
                  </p>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={settings.defaultVolume}
                  onChange={(e) => updateSettings({ defaultVolume: parseFloat(e.target.value) })}
                  className="w-24"
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <label className="text-sm font-medium">Auto Save</label>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Automatically save projects while editing
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.autoSave}
                    onChange={(e) => updateSettings({ autoSave: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};