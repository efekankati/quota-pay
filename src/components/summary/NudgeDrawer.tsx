import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
} from 'react-native';
import { MessageSquare, Send, Share2, Smartphone, X } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { Participant } from '../../types/bill';
import { NudgeService } from '../../services/notification/NudgeService';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface NudgeDrawerProps {
  visible: boolean;
  participant: Participant | null;
  amountDue: number;
  restaurantName: string;
  billId: string;
  onClose: () => void;
}

export const NudgeDrawer: React.FC<NudgeDrawerProps> = ({
  visible,
  participant,
  amountDue,
  restaurantName,
  billId,
  onClose,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { lightImpact, successNotification } = useHaptics();

  if (!participant) return null;

  const nudgeParams = {
    participantName: participant.name,
    phoneNumber: participant.phone,
    amountDue,
    restaurantName,
    billId,
    participantId: participant.id,
  };

  const handleWhatsApp = async () => {
    lightImpact();
    await NudgeService.sendWhatsAppNudge(nudgeParams);
    successNotification();
    onClose();
  };

  const handleTelegram = async () => {
    lightImpact();
    await NudgeService.sendTelegramNudge(nudgeParams);
    successNotification();
    onClose();
  };

  const handleSms = async () => {
    lightImpact();
    await NudgeService.sendSmsNudge(nudgeParams);
    successNotification();
    onClose();
  };

  const handleNativeShare = async () => {
    lightImpact();
    await NudgeService.sendNativeShareNudge(nudgeParams);
    successNotification();
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View style={[styles.drawerContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.header}>
            <View>
              <Text style={[styles.title, { color: colors.textPrimary }]}>
                {t('nudgeDrawerTitle', { name: participant.name.split(' ')[0] })}
              </Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
                {t('nudgeDrawerSubtitle', { amount: `€${amountDue.toFixed(2)}`, restaurant: restaurantName })}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => {
                lightImpact();
                onClose();
              }}
              style={[styles.closeBtn, { backgroundColor: colors.surfaceElevated }]}
            >
              <X size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Localized Message Preview */}
          <View style={[styles.messagePreview, { backgroundColor: colors.background, borderColor: colors.borderSubtle }]}>
            <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>
              {t('prefilledMsgLabel')}
            </Text>
            <Text style={[styles.previewText, { color: colors.textPrimary }]}>
              {NudgeService.generateMessageText(nudgeParams)}
            </Text>
          </View>

          {/* Social Channels Options */}
          <View style={styles.channelsList}>
            {/* WhatsApp */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleWhatsApp}
              style={[styles.channelItem, { backgroundColor: '#25D366' }]}
            >
              <MessageSquare size={20} color="#FFFFFF" />
              <Text style={styles.channelText}>{t('sendViaWhatsApp')}</Text>
            </TouchableOpacity>

            {/* Telegram */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleTelegram}
              style={[styles.channelItem, { backgroundColor: '#0088CC' }]}
            >
              <Send size={20} color="#FFFFFF" />
              <Text style={styles.channelText}>{t('sendViaTelegram')}</Text>
            </TouchableOpacity>

            {/* SMS */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleSms}
              style={[styles.channelItem, { backgroundColor: colors.surfaceElevated, borderWidth: 1, borderColor: colors.border }]}
            >
              <Smartphone size={20} color={colors.textPrimary} />
              <Text style={[styles.channelText, { color: colors.textPrimary }]}>
                {t('sendViaSms')}
              </Text>
            </TouchableOpacity>

            {/* Native Share Sheet */}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handleNativeShare}
              style={[styles.channelItem, { backgroundColor: colors.accent }]}
            >
              <Share2 size={20} color="#000000" />
              <Text style={[styles.channelText, { color: '#000000' }]}>
                {t('shareTableLink')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  drawerContent: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1,
    padding: SPACING.xl,
    paddingBottom: SPACING.xxxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.lg,
  },
  title: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messagePreview: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  previewLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  previewText: {
    fontSize: 13,
    lineHeight: 18,
    fontStyle: 'italic',
  },
  channelsList: {
    gap: SPACING.sm + 2,
  },
  channelItem: {
    height: 52,
    borderRadius: RADIUS.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
  },
  channelText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});
