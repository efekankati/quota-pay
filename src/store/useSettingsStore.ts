import { create } from 'zustand';
import { ENV } from '../config/env';

interface SettingsState {
  geminiApiKey: string;
  isAiModalVisible: boolean;
  setGeminiApiKey: (key: string) => void;
  clearGeminiApiKey: () => void;
  setIsAiModalVisible: (visible: boolean) => void;
}

export const EMBEDDED_GEMINI_KEY = '';

export const useSettingsStore = create<SettingsState>((set) => ({
  geminiApiKey:
    ENV.GEMINI_API_KEY && ENV.GEMINI_API_KEY.trim().length > 0
      ? ENV.GEMINI_API_KEY.trim()
      : '',
  isAiModalVisible: false,
  setGeminiApiKey: (key: string) => set({ geminiApiKey: key.trim() }),
  clearGeminiApiKey: () => set({ geminiApiKey: '' }),
  setIsAiModalVisible: (visible: boolean) => set({ isAiModalVisible: visible }),
}));
