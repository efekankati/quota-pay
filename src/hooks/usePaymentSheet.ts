import { useState } from 'react';
import { StripeService } from '../services/payment/StripeService';
import { SatispayService } from '../services/payment/SatispayService';
import { BillSyncService } from '../services/sync/BillSyncService';
import { useBillStore } from '../store/useBillStore';
import { useHaptics } from './useHaptics';

export function usePaymentSheet(billId: string, participantId: string) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { markParticipantPaid, getBillShareBreakdown, getActiveBill, bills } = useBillStore();
  const { successNotification, errorNotification, heavyImpact } = useHaptics();

  const bill = bills.find((b) => b.id === billId) || getActiveBill();
  const share = getBillShareBreakdown(billId, participantId);

  const organizerParticipant = bill?.participants.find(
    (p) => Boolean(p.isOrganizer) || p.id === bill?.organizerId || p.id === 'user_me'
  );
  const recipientName =
    bill?.organizerAccountHolder ||
    organizerParticipant?.name?.replace(/\s*\(Organizer\)/i, '') ||
    'Organizer';
  const recipientBank = bill?.organizerBankName || 'Intesa Sanpaolo S.p.A.';
  const recipientIban = bill?.organizerIban || 'IT60X0542811101000000123456';

  /**
   * Triggers Apple Pay Direct Transfer to Organizer's Bank / IBAN
   */
  const payWithApplePay = async (): Promise<boolean> => {
    setIsProcessing(true);
    setErrorMessage(null);
    heavyImpact();

    try {
      const idempotencyKey = StripeService.generateIdempotencyKey(billId, participantId);
      const amountInCents = Math.round(share.totalDue * 100);

      const intent = await StripeService.createPaymentIntent({
        billId,
        participantId,
        amountInCents,
        currency: 'EUR',
        idempotencyKey,
        statementDescriptor: `${recipientName.slice(0, 14).toUpperCase()}`,
      });

      const applePayConfig = StripeService.getApplePayConfig(
        `${recipientName} (${recipientBank})`,
        share.totalDue
      );

      const sheetResult = await StripeService.presentPaymentSheet(
        intent.clientSecret,
        applePayConfig,
        'apple_pay'
      );

      if (sheetResult.success) {
        const participant = bill?.participants.find((p) => p.id === participantId);
        markParticipantPaid(billId, participantId, 'apple_pay', share.totalDue);
        BillSyncService.markSplitPaidInCloud(
          billId,
          participantId,
          participant?.splitId || '',
          share.totalDue,
          'apple_pay'
        ).catch(() => {});
        successNotification();
        setIsProcessing(false);
        return true;
      } else {
        throw new Error(sheetResult.error?.message || 'Apple Pay payment cancelled.');
      }
    } catch (error: any) {
      errorNotification();
      setErrorMessage(error.message || 'Error during Apple Pay transaction.');
      setIsProcessing(false);
      return false;
    }
  };

  /**
   * Triggers Google Pay Direct Transfer to Organizer's Bank / IBAN
   */
  const payWithGooglePay = async (): Promise<boolean> => {
    setIsProcessing(true);
    setErrorMessage(null);
    heavyImpact();

    try {
      const idempotencyKey = StripeService.generateIdempotencyKey(billId, participantId);
      const amountInCents = Math.round(share.totalDue * 100);

      const intent = await StripeService.createPaymentIntent({
        billId,
        participantId,
        amountInCents,
        currency: 'EUR',
        idempotencyKey,
        statementDescriptor: `${recipientName.slice(0, 14).toUpperCase()}`,
      });

      const applePayConfig = StripeService.getApplePayConfig(
        `${recipientName} (${recipientBank})`,
        share.totalDue
      );

      const sheetResult = await StripeService.presentPaymentSheet(
        intent.clientSecret,
        applePayConfig,
        'google_pay'
      );

      if (sheetResult.success) {
        const participant = bill?.participants.find((p) => p.id === participantId);
        markParticipantPaid(billId, participantId, 'google_pay', share.totalDue);
        BillSyncService.markSplitPaidInCloud(
          billId,
          participantId,
          participant?.splitId || '',
          share.totalDue,
          'google_pay'
        ).catch(() => {});
        successNotification();
        setIsProcessing(false);
        return true;
      } else {
        throw new Error(sheetResult.error?.message || 'Google Pay payment cancelled.');
      }
    } catch (error: any) {
      errorNotification();
      setErrorMessage(error.message || 'Error during Google Pay transaction.');
      setIsProcessing(false);
      return false;
    }
  };

  /**
   * Triggers Italian Satispay direct transfer to Organizer
   */
  const payWithSatispay = async (): Promise<boolean> => {
    setIsProcessing(true);
    setErrorMessage(null);
    heavyImpact();

    try {
      const amountInCents = Math.round(share.totalDue * 100);
      await SatispayService.openSatispayPayment({
        amountInCents,
        recipientBusinessId: recipientName,
        description: `${recipientName} (${recipientIban}) - ${bill?.restaurantName || 'Restaurant'}`,
      });

      // Mark as paid directly to organizer
      const participant = bill?.participants.find((p) => p.id === participantId);
      markParticipantPaid(billId, participantId, 'satispay', share.totalDue);
      BillSyncService.markSplitPaidInCloud(
        billId,
        participantId,
        participant?.splitId || '',
        share.totalDue,
        'satispay'
      ).catch(() => {});
      successNotification();
      setIsProcessing(false);
      return true;
    } catch (error: any) {
      errorNotification();
      setErrorMessage(error.message || 'Unable to launch Satispay payment.');
      setIsProcessing(false);
      return false;
    }
  };

  /**
   * Triggers Direct SEPA IBAN Instant Transfer to Organizer's IBAN
   */
  const payWithSepaIban = async (_iban?: string): Promise<boolean> => {
    setIsProcessing(true);
    setErrorMessage(null);
    heavyImpact();

    try {
      await new Promise((resolve) => setTimeout(resolve, 600));
      const participant = bill?.participants.find((p) => p.id === participantId);
      markParticipantPaid(billId, participantId, 'sepa_iban', share.totalDue);
      await BillSyncService.markSplitPaidInCloud(
        billId,
        participantId,
        participant?.splitId || '',
        share.totalDue,
        'sepa_iban'
      );
      successNotification();
      setIsProcessing(false);
      return true;
    } catch (error: any) {
      errorNotification();
      setErrorMessage(error.message || 'Unable to execute SEPA instant transfer.');
      setIsProcessing(false);
      return false;
    }
  };

  return {
    isProcessing,
    errorMessage,
    share,
    payWithApplePay,
    payWithGooglePay,
    payWithSatispay,
    payWithSepaIban,
  };
}
