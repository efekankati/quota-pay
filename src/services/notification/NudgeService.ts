import * as Linking from 'expo-linking';
import { DeepLinkService } from '../deepLink/DeepLinkService';

import { useLanguageStore } from '../../store/useLanguageStore';
import { SupportedLanguage } from '../../i18n/translations';

export interface NudgeParams {
  participantName: string;
  phoneNumber?: string;
  amountDue: number;
  restaurantName: string;
  billId: string;
  participantId: string;
}

/**
 * Social Nudge & Notification Service for Quota.
 * Formats courteous reminders and opens WhatsApp, Telegram, or native SMS with prefilled deep links.
 */
export class NudgeService {
  /**
   * Generates a casual dining reminder message in the user's selected language.
   */
  public static generateMessageText(params: NudgeParams, lang?: SupportedLanguage): string {
    const payLink = DeepLinkService.getUniversalLink(params.billId, params.participantId);
    const activeLang = lang || useLanguageStore.getState().language;
    const formattedAmount = `€${params.amountDue.toFixed(2)}`;

    switch (activeLang) {
      case 'tr':
        return `Selam ${params.participantName}! 🍕 ${params.restaurantName} hesabı paylaşıldı: Senin payın ${formattedAmount}. Hemen buradan ödeyebilirsin:\n${payLink}`;
      case 'it':
        return `Ciao ${params.participantName}! 🍕 Ecco il conto di ${params.restaurantName}: la tua quota è di ${formattedAmount}. Puoi saldare direttamente qui:\n${payLink}`;
      case 'es':
        return `¡Hola ${params.participantName}! 🍕 Aquí está la cuenta de ${params.restaurantName}: tu parte es de ${formattedAmount}. Puedes pagar directamente aquí:\n${payLink}`;
      case 'de':
        return `Hallo ${params.participantName}! 🍕 Hier ist die Rechnung von ${params.restaurantName}: dein Anteil beträgt ${formattedAmount}. Du kannst direkt hier bezahlen:\n${payLink}`;
      case 'fr':
        return `Salut ${params.participantName} ! 🍕 Voici l’addition de ${params.restaurantName} : ta part est de ${formattedAmount}. Tu peux régler directement ici :\n${payLink}`;
      case 'en':
      default:
        return `Hi ${params.participantName}! 🍕 Here is the bill for ${params.restaurantName}: your share is ${formattedAmount}. You can settle directly here:\n${payLink}`;
    }
  }

  /**
   * Opens WhatsApp with the pre-filled reminder.
   */
  public static async sendWhatsAppNudge(params: NudgeParams): Promise<void> {
    const text = encodeURIComponent(this.generateMessageText(params));
    const phone = params.phoneNumber ? params.phoneNumber.replace(/[^0-9]/g, '') : '';
    const url = phone ? `whatsapp://send?phone=${phone}&text=${text}` : `whatsapp://send?text=${text}`;

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(`https://api.whatsapp.com/send?text=${text}`);
      }
    } catch {
      await Linking.openURL(`https://api.whatsapp.com/send?text=${text}`);
    }
  }

  /**
   * Opens Telegram with the pre-filled reminder.
   */
  public static async sendTelegramNudge(params: NudgeParams): Promise<void> {
    const text = encodeURIComponent(this.generateMessageText(params));
    const url = `tg://msg?text=${text}`;

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (canOpen) {
        await Linking.openURL(url);
      } else {
        await Linking.openURL(`https://t.me/share/url?url=${encodeURIComponent(DeepLinkService.getUniversalLink(params.billId))}&text=${text}`);
      }
    } catch {
      await Linking.openURL(`https://t.me/share/url?url=${encodeURIComponent(DeepLinkService.getUniversalLink(params.billId))}&text=${text}`);
    }
  }

  /**
   * Opens native SMS messenger.
   */
  public static async sendSmsNudge(params: NudgeParams): Promise<void> {
    const text = encodeURIComponent(this.generateMessageText(params));
    const phone = params.phoneNumber ? params.phoneNumber.replace(/[^0-9]/g, '') : '';
    const url = phone ? `sms:${phone}?body=${text}` : `sms:?body=${text}`;
    await Linking.openURL(url);
  }

  /**
   * Invokes phone's native sharing system for the personalized nudge.
   */
  public static async sendNativeShareNudge(params: NudgeParams): Promise<void> {
    const text = this.generateMessageText(params);
    const payLink = DeepLinkService.getUniversalLink(params.billId, params.participantId);

    if (
      typeof navigator !== 'undefined' &&
      typeof (navigator as any).share === 'function'
    ) {
      try {
        await (navigator as any).share({
          title: `Quota • ${params.restaurantName}`,
          text: text,
          url: payLink,
        });
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
      }
    }

    try {
      const { Share, Platform } = require('react-native');
      if (Platform.OS !== 'web') {
        await Share.share(
          { message: text, title: `Quota • ${params.restaurantName}` },
          { dialogTitle: `Quota • ${params.participantName}` }
        );
      }
    } catch {}
  }
}
