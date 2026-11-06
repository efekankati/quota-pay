import { create } from 'zustand';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface AlertOptions {
  title: string;
  message?: string;
  icon?: 'success' | 'warning' | 'info' | 'zap' | 'receipt' | 'link';
  buttons?: AlertButton[];
}

interface AlertStoreState {
  isVisible: boolean;
  options: AlertOptions | null;
  showAlert: (options: AlertOptions) => void;
  hideAlert: () => void;
}

export const useAlertStore = create<AlertStoreState>((set) => ({
  isVisible: false,
  options: null,
  showAlert: (options) =>
    set({
      isVisible: true,
      options: {
        ...options,
        buttons: options.buttons && options.buttons.length > 0 ? options.buttons : [{ text: 'OK' }],
      },
    }),
  hideAlert: () => set({ isVisible: false, options: null }),
}));

/**
 * Global helper to replace basic Alert.alert with the custom Quota theme dialog.
 */
export const showAppAlert = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  icon?: AlertOptions['icon']
) => {
  useAlertStore.getState().showAlert({
    title,
    message,
    buttons,
    icon,
  });
};
