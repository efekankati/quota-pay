import * as Linking from 'expo-linking';
import { ENV } from '../../config/env';
import { SatispayDeepLinkOptions } from '../../types/payment';

/**
 * Satispay Integration Service (Italy Rail)
 * Implements deep linking into the Satispay mobile app with prefilled payment amounts,
 * description, and fallback to web redirect if Satispay is not installed.
 */
export class SatispayService {
  /**
   * Builds the official Satispay deep link URI scheme:
   * satispay://pay?amount={cents}&recipient={id}&description={text}
   */
  public static buildDeepLink(options: SatispayDeepLinkOptions): string {
    const encodedDescription = encodeURIComponent(options.description);
    const amountInCents = Math.round(options.amountInCents);

    const recipient = options.recipientBusinessId || ENV.SATISPAY_BUSINESS_ID;

    return `${ENV.SATISPAY_SCHEME}pay?amount=${amountInCents}&recipient=${encodeURIComponent(
      recipient
    )}&description=${encodedDescription}`;
  }

  /**
   * Checks whether the Satispay native app is installed on the user's iOS or Android device.
   */
  public static async isSatispayInstalled(): Promise<boolean> {
    try {
      return await Linking.canOpenURL(ENV.SATISPAY_SCHEME);
    } catch {
      return false;
    }
  }

  /**
   * Launches Satispay for quick settlement, or redirects to web checkout if not available.
   */
  public static async openSatispayPayment(
    options: SatispayDeepLinkOptions
  ): Promise<{ openedNative: boolean }> {
    const uri = this.buildDeepLink(options);
    const canOpen = await this.isSatispayInstalled();

    if (canOpen) {
      await Linking.openURL(uri);
      return { openedNative: true };
    } else {
      // Fallback to Satispay web payment bridge
      const webFallback = `https://tag.satispay.com/${options.recipientBusinessId || ENV.SATISPAY_BUSINESS_ID}?amount=${(
        options.amountInCents / 100
      ).toFixed(2)}&description=${encodeURIComponent(options.description)}`;
      await Linking.openURL(webFallback);
      return { openedNative: false };
    }
  }
}
