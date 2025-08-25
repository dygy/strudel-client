import React from 'react';
import { Outlet } from 'react-router-dom';
import { ThemeProvider } from '../contexts/ThemeContext';
import { Header } from './Header';
import { Sidebar } from './Sidebar';

import { useAppStore } from '../stores/appStore';

export const AppShell: React.FC = () => {
  const sidebarOpen = useAppStore((state) => state.sidebarOpen);

  return (
    <ThemeProvider>
      <div className="h-screen flex flex-col bg-white dark:bg-dark-900 text-gray-900 dark:text-gray-100 relative">
        <Header />
        <div className="flex flex-1 overflow-hidden relative z-10">
          {sidebarOpen && <Sidebar />}
          <main className="flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
      </div>
    </ThemeProvider>
  );
};