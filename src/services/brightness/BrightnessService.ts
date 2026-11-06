import { Platform } from 'react-native';
import * as Brightness from 'expo-brightness';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

const KEEP_AWAKE_TAG = 'quota-qr-fullscreen';

/**
 * Screen Brightness & Display Contrast Service
 * Handles setting brightness to 100% (maximum) when QR codes are displayed
 * and seamlessly restoring original brightness when dismissed.
 */
export class BrightnessService {
  private static originalBrightness: number | null = null;
  private static wasUsingSystemBrightness: boolean = true;
  private static wakeLockSentinel: any = null;

  /**
   * Sets screen brightness to maximum (1.0).
   * Returns a cleanup function that restores original brightness.
   */
  static async setBrightnessToMax(): Promise<() => Promise<void>> {
    // 1. Web Platform handling
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        if ('wakeLock' in navigator && (navigator as any).wakeLock) {
          BrightnessService.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // WakeLock may not be allowed without user interaction or if unsupported
      }

      return async () => {
        try {
          if (BrightnessService.wakeLockSentinel) {
            await BrightnessService.wakeLockSentinel.release();
            BrightnessService.wakeLockSentinel = null;
          }
        } catch {}
      };
    }

    // 2. Native Expo / React Native handling (iOS & Android)
    try {
      activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => {});

      if (Platform.OS === 'android') {
        // On Android, check if activity is using system brightness before overriding.
        // Avoid calling getBrightnessAsync() when in automatic mode as Android 9+ throws SettingNotFoundException.
        try {
          BrightnessService.wasUsingSystemBrightness =
            await Brightness.isUsingSystemBrightnessAsync();
          if (!BrightnessService.wasUsingSystemBrightness) {
            BrightnessService.originalBrightness = await Brightness.getBrightnessAsync();
          }
        } catch {
          BrightnessService.wasUsingSystemBrightness = true;
        }

        // Override current activity window brightness to 100% (1.0)
        await Brightness.setBrightnessAsync(1.0);
      setTimeout(() => {
        Brightness.setBrightnessAsync(1.0).catch(() => {});
      }, 80);
        // Re-apply after modal window attaches so Android WindowManager refreshes window attributes
        setTimeout(() => {
          Brightness.setBrightnessAsync(1.0).catch(() => {});
        }, 80);
        setTimeout(() => {
          Brightness.setBrightnessAsync(1.0).catch(() => {});
        }, 250);

        // Also attempt system brightness boost if WRITE_SETTINGS permission is already granted
        try {
          const perm = await Brightness.getPermissionsAsync();
          if (perm.granted) {
            await Brightness.setSystemBrightnessAsync(1.0);
          }
        } catch {}

        return async () => {
          try {
            deactivateKeepAwake(KEEP_AWAKE_TAG);
          } catch {}
          try {
            if (BrightnessService.wasUsingSystemBrightness) {
              await Brightness.restoreSystemBrightnessAsync();
            } else if (BrightnessService.originalBrightness !== null) {
              await Brightness.setBrightnessAsync(BrightnessService.originalBrightness);
              BrightnessService.originalBrightness = null;
            } else {
              await Brightness.restoreSystemBrightnessAsync();
            }
          } catch {}
        };
      }

      // iOS handling
      try {
        const current = await Brightness.getBrightnessAsync();
        BrightnessService.originalBrightness = current;
      } catch {
        BrightnessService.originalBrightness = 0.5;
      }

      await Brightness.setBrightnessAsync(1.0);
      setTimeout(() => {
        Brightness.setBrightnessAsync(1.0).catch(() => {});
      }, 80);

      return async () => {
        try {
          deactivateKeepAwake(KEEP_AWAKE_TAG);
        } catch {}
        try {
          if (BrightnessService.originalBrightness !== null) {
            await Brightness.setBrightnessAsync(BrightnessService.originalBrightness);
            BrightnessService.originalBrightness = null;
          }
        } catch {}
      };
    } catch {
      return async () => {
        try {
          deactivateKeepAwake(KEEP_AWAKE_TAG);
        } catch {}
      };
    }
  }
}

