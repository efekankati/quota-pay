import { create } from 'zustand';
import { COLORS } from '../config/theme';

export type ThemeMode = 'dark' | 'light';

interface ThemeStoreState {
  mode: ThemeMode;
  colors: typeof COLORS.dark;
  toggleTheme: () => void;
  setMode: (mode: ThemeMode) => void;
}

export const useThemeStore = create<ThemeStoreState>((set) => ({
  mode: 'dark', // Neo-Fintech Obsidian dark mode default
  colors: COLORS.dark,

  toggleTheme: () => {
    set((state) => {
      const newMode = state.mode === 'dark' ? 'light' : 'dark';
      return {
        mode: newMode,
        colors: COLORS[newMode],
      };
    });
  },

  setMode: (mode) => {
    set({
      mode,
      colors: COLORS[mode],
    });
  },
}));
