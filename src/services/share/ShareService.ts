import { Share, Platform } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { BillSession } from '../../types/bill';
import { BillSyncService } from '../sync/BillSyncService';
import { useLanguageStore } from '../../store/useLanguageStore';

export class ShareService {
  /**
   * Invokes the phone's native sharing system (iOS UIActivityViewController, Android ShareSheet, or Web Share API)
   * Formats the URL cleanly so pasting it into any app or browser always recognizes it as a valid clickable link.
   */
  public static async shareTableLink(
    bill: BillSession,
    url: string,
    customMessage?: string
  ): Promise<void> {
    // Ensure the cloud snapshot is fresh when sharing
    BillSyncService.saveBillToCloud(bill).catch(() => {});

    const cleanUrl = url.trim();
    const lang = useLanguageStore.getState().language;

    const defaultIntro =
      lang === 'it'
        ? `Unisciti al conto di ${bill.restaurantName} su Quota:`
        : lang === 'tr'
        ? `Quota'da ${bill.restaurantName} hesabına katıl:`
        : lang === 'es'
        ? `Únete a la cuenta de ${bill.restaurantName} en Quota:`
        : lang === 'de'
        ? `Tritt der Rechnung von ${bill.restaurantName} auf Quota bei:`
        : lang === 'fr'
        ? `Rejoins l’addition de ${bill.restaurantName} sur Quota :`
        : `Join the ${bill.restaurantName} bill on Quota:`;

    const messageWithLink = customMessage || `${defaultIntro}\n${cleanUrl}`;

    // Also copy the standalone URL to clipboard so direct pasting anywhere pastes a pure URL
    try {
      await Clipboard.setStringAsync(cleanUrl);
    } catch {}

    // 1. Native mobile (iOS UIActivityViewController & Android ShareSheet)
    if (Platform.OS !== 'web') {
      try {
        // Pass message containing the URL on its own line so copying or sharing to WhatsApp/Telegram/SMS
        // never concatenates text onto the URL without whitespace
        const content = {
          message: messageWithLink,
          title: `Quota • ${bill.restaurantName}`,
        };

        const result = await Share.share(content, {
          dialogTitle: `Quota • ${bill.restaurantName}`,
          subject: `Quota • ${bill.restaurantName}`,
        });

        if (
          result.action === Share.sharedAction ||
          result.action === Share.dismissedAction
        ) {
          return;
        }
      } catch {
        // Fallback to clipboard if native share throws
      }
    }

    // 2. Web Share API (Safari iOS/macOS, Chrome Android, Edge)
    if (
      typeof navigator !== 'undefined' &&
      typeof (navigator as any).share === 'function'
    ) {
      try {
        const shareData = {
          title: `Quota • ${bill.restaurantName}`,
          text: `${defaultIntro}\n`,
          url: cleanUrl,
        };

        if (
          typeof (navigator as any).canShare === 'function' &&
          !(navigator as any).canShare(shareData)
        ) {
          await (navigator as any).share({ url: cleanUrl });
          return;
        }

        await (navigator as any).share(shareData);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError' || err?.name === 'NotAllowedError') {
          return;
        }
      }
    }
  }
}
