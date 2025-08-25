import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Project, UserSettings, Theme } from '../types/index';

// Detect OS theme preference
const getSystemTheme = (): Theme => {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
};

interface AppState {
  // Current session
  currentProject: Project | null;
  isPlaying: boolean;
  bpm: number;
  volume: number;
  
  // Editor state
  code: string;
  visualCode: string;
  cursorPosition: number;
  
  // UI state
  theme: Theme;
  followSystemTheme: boolean;
  sidebarOpen: boolean;
  fullscreenCanvas: boolean;
  
  // Projects
  projects: Project[];
  
  // Settings
  settings: UserSettings;
  
  // Actions
  setCode: (code: string) => void;
  setVisualCode: (code: string) => void;
  togglePlayback: () => void;
  setBpm: (bpm: number) => void;
  setVolume: (volume: number) => void;
  createProject: (name: string, description?: string) => void;
  loadProject: (id: string) => void;
  saveProject: () => void;
  deleteProject: (id: string) => void;
  updateProject: (updates: Partial<Project>) => void;
  toggleTheme: () => void;
  setFollowSystemTheme: (follow: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  setFullscreenCanvas: (fullscreen: boolean) => void;
  updateSettings: (settings: Partial<UserSettings>) => void;
}

const defaultSettings: UserSettings = {
  defaultBpm: 120,
  defaultVolume: 0.7,
  editorFontSize: 14,
  keyBindings: 'default',
  autoSave: true,
  autoSaveInterval: 30000, // 30 seconds
};

const createDefaultProject = (name: string, description?: string): Project => ({
  id: crypto.randomUUID(),
  name,
  description,
  tags: [],
  audioCode: '// Welcome to Strudel!\n// Start coding your patterns here\n\n',
  visualCode: '// Hydra visual code\n// osc().out()\n\n',
  bpm: 120,
  volume: 0.7,
  canvasSettings: {
    width: 800,
    height: 600,
    backgroundColor: '#000000',
    fullscreen: false,
  },
  createdAt: new Date(),
  updatedAt: new Date(),
  version: 1,
});

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      currentProject: null,
      isPlaying: false,
      bpm: 120,
      volume: 0.7,
      code: '',
      visualCode: '',
      cursorPosition: 0,
      theme: getSystemTheme(),
      followSystemTheme: true,
      sidebarOpen: true,
      fullscreenCanvas: false,
      projects: [],
      settings: defaultSettings,

      // Actions
      setCode: (code: string) => {
        set({ code });
        const { currentProject } = get();
        if (currentProject) {
          get().updateProject({ audioCode: code });
        }
      },

      setVisualCode: (visualCode: string) => {
        set({ visualCode });
        const { currentProject } = get();
        if (currentProject) {
          get().updateProject({ visualCode });
        }
      },

      togglePlayback: () => {
        set((state) => ({ isPlaying: !state.isPlaying }));
      },

      setBpm: (bpm: number) => {
        set({ bpm });
        const { currentProject } = get();
        if (currentProject) {
          get().updateProject({ bpm });
        }
      },

      setVolume: (volume: number) => {
        set({ volume });
        const { currentProject } = get();
        if (currentProject) {
          get().updateProject({ volume });
        }
      },

      createProject: (name: string, description?: string) => {
        const newProject = createDefaultProject(name, description);
        set((state) => ({
          projects: [...state.projects, newProject],
          currentProject: newProject,
          code: newProject.audioCode,
          visualCode: newProject.visualCode,
          bpm: newProject.bpm,
          volume: newProject.volume,
        }));
      },

      loadProject: (id: string) => {
        const { projects } = get();
        const project = projects.find((p) => p.id === id);
        if (project) {
          set({
            currentProject: project,
            code: project.audioCode,
            visualCode: project.visualCode,
            bpm: project.bpm,
            volume: project.volume,
          });
        }
      },

      saveProject: () => {
        const { currentProject, code, visualCode, bpm, volume } = get();
        if (currentProject) {
          get().updateProject({
            audioCode: code,
            visualCode,
            bpm,
            volume,
            updatedAt: new Date(),
          });
        }
      },

      deleteProject: (id: string) => {
        set((state) => {
          const newProjects = state.projects.filter((p) => p.id !== id);
          const newCurrentProject = state.currentProject?.id === id ? null : state.currentProject;
          return {
            projects: newProjects,
            currentProject: newCurrentProject,
            code: newCurrentProject?.audioCode || '',
            visualCode: newCurrentProject?.visualCode || '',
            bpm: newCurrentProject?.bpm || state.settings.defaultBpm,
            volume: newCurrentProject?.volume || state.settings.defaultVolume,
          };
        });
      },

      updateProject: (updates: Partial<Project>) => {
        const { currentProject } = get();
        if (currentProject) {
          const updatedProject = { ...currentProject, ...updates, updatedAt: new Date() };
          set((state) => ({
            projects: state.projects.map((p) => (p.id === currentProject.id ? updatedProject : p)),
            currentProject: updatedProject,
          }));
        }
      },

      toggleTheme: () => {
        set((state) => ({ 
          theme: state.theme === 'light' ? 'dark' : 'light',
          followSystemTheme: false // Disable system theme following when manually toggling
        }));
      },

      setFollowSystemTheme: (followSystemTheme: boolean) => {
        set({ 
          followSystemTheme,
          theme: followSystemTheme ? getSystemTheme() : get().theme
        });
      },

      setSidebarOpen: (sidebarOpen: boolean) => {
        set({ sidebarOpen });
      },

      setFullscreenCanvas: (fullscreenCanvas: boolean) => {
        set({ fullscreenCanvas });
      },

      updateSettings: (newSettings: Partial<UserSettings>) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },
    }),
    {
      name: 'strudel-app-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        projects: state.projects,
        settings: state.settings,
        theme: state.theme,
        followSystemTheme: state.followSystemTheme,
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
);