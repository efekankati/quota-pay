import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Linking,
} from 'react-native';
import {
  Globe,
  Lock,
  Copy,
  ExternalLink,
  X,
  CheckCircle2,
  Users,
  UtensilsCrossed,
  Sparkles,
  CreditCard,
  MessageCircle,
} from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { BillSession, Participant } from '../../types/bill';
import { DeepLinkService } from '../../services/deepLink/DeepLinkService';
import { ShareService } from '../../services/share/ShareService';
import { showAppAlert } from '../../store/useAlertStore';
import { RADIUS, SHADOWS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface BrowserMockupModalProps {
  visible: boolean;
  bill: BillSession | null;
  onClose: () => void;
}

export const BrowserMockupModal: React.FC<BrowserMockupModalProps> = ({
  visible,
  bill,
  onClose,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { lightImpact, successNotification } = useHaptics();

  if (!bill) return null;

  const devUrl = DeepLinkService.getBrowserDevUrl(bill);
  const organizer = bill.participants.find((p) => p.isOrganizer) || bill.participants[0];
  const organizerPaidAmount = organizer?.paidAmount || 0;
  const grandTotal = bill.taxSummary.grandTotal;
  const remainingForFriends = Math.max(grandTotal - organizerPaidAmount, 0);

  const [copied, setCopied] = React.useState(false);

  const handleCopy = async () => {
    lightImpact();
    try {
      await Clipboard.setStringAsync(devUrl);
      setCopied(true);
      successNotification();
      setTimeout(() => setCopied(false), 2200);
    } catch {
      await ShareService.shareTableLink(bill, devUrl);
    }
  };

  const handleOpenBrowser = async () => {
    lightImpact();
    try {
      await Linking.openURL(devUrl);
    } catch {
      await ShareService.shareTableLink(bill, devUrl);
    }
  };

  const handleShareWhatsApp = async () => {
    lightImpact();
    const msg = `Ciao! Ecco il conto per ${bill.restaurantName} (€${grandTotal.toFixed(2)} totali, restante da dividere €${remainingForFriends.toFixed(2)}): ${devUrl}`;
    const url = `whatsapp://send?text=${encodeURIComponent(msg)}`;
    try {
      await Linking.openURL(url);
    } catch {
      await ShareService.shareTableLink(bill, devUrl, msg);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <View
          style={[
            styles.containerCard,
            SHADOWS.floating,
            {
              backgroundColor: colors.surface,
              borderColor: colors.borderSubtle,
            },
          ]}
        >
          {/* Simulated Browser Chrome / Titlebar */}
          <View style={[styles.browserBar, { backgroundColor: '#0F172A', borderBottomColor: '#1E293B' }]}>
            <View style={styles.windowDots}>
              <View style={[styles.dot, { backgroundColor: '#EF4444' }]} />
              <View style={[styles.dot, { backgroundColor: '#F59E0B' }]} />
              <View style={[styles.dot, { backgroundColor: '#10B981' }]} />
            </View>

            {/* Address Bar */}
            <View style={styles.addressBar}>
              <Lock size={12} color="#10B981" />
              <Text style={styles.addressText} numberOfLines={1}>
                {devUrl}
              </Text>
              <TouchableOpacity onPress={handleCopy} style={styles.miniCopyBtn}>
                {copied ? (
                  <CheckCircle2 size={12} color="#10B981" />
                ) : (
                  <Copy size={12} color="#94A3B8" />
                )}
              </TouchableOpacity>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeWindowBtn}>
              <X size={16} color="#94A3B8" />
            </TouchableOpacity>
          </View>

          {/* Browser Content Viewport */}
          <ScrollView contentContainerStyle={styles.browserContent}>
            {/* Visual Web Banner */}
            <View style={[styles.webHeader, { backgroundColor: colors.surfaceElevated, borderColor: colors.borderSubtle }]}>
              <View style={styles.brandRow}>
                <View style={[styles.logoCircle, { backgroundColor: colors.accentLight }]}>
                  <UtensilsCrossed size={16} color={colors.accent} />
                </View>
                <Text style={[styles.brandTitle, { color: colors.textPrimary }]}>
                  Quota Web • {bill.restaurantName}
                </Text>
              </View>

              <Text style={[styles.receiptTotalLabel, { color: colors.textSecondary }]}>
                TOTAL RESTAURANT RECEIPT
              </Text>
              <Text style={[styles.receiptTotalValue, { color: colors.textPrimary }]}>
                €{grandTotal.toFixed(2)}
              </Text>

              {/* Organizer Covered Badge */}
              <View style={[styles.organizerCoveredBox, { backgroundColor: 'rgba(16, 185, 129, 0.12)', borderColor: '#10B981' }]}>
                <CheckCircle2 size={16} color="#10B981" />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.organizerCoveredTitle, { color: '#10B981' }]}>
                    Covered by {organizer.name}
                  </Text>
                  <Text style={[styles.organizerCoveredDesc, { color: colors.textSecondary }]}>
                    Consumed items already paid at restaurant: €{organizerPaidAmount.toFixed(2)}
                  </Text>
                </View>
              </View>

              {/* Remaining for Friends */}
              <View style={[styles.remainingBox, { backgroundColor: colors.background, borderColor: colors.borderSubtle }]}>
                <Text style={[styles.remainingLabel, { color: colors.textSecondary }]}>
                  REMAINING TO COLLECT FROM FRIENDS
                </Text>
                <Text style={[styles.remainingAmount, { color: colors.accent }]}>
                  €{remainingForFriends.toFixed(2)}
                </Text>
              </View>
            </View>

            {/* Simulated Web Viewport: Diner Name & Items Claiming */}
            <View style={styles.itemsPreviewSection}>
              {/* Guest Enter Name Hint Card */}
              <View
                style={[
                  styles.itemRowMock,
                  {
                    backgroundColor: 'rgba(56, 189, 248, 0.08)',
                    borderColor: colors.accent,
                    marginBottom: SPACING.md,
                  },
                ]}
              >
                <Users size={18} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.itemMockName, { color: colors.accent }]}>
                    Welcome to the Table • Who are you?
                  </Text>
                  <Text style={[styles.itemMockSub, { color: colors.textSecondary }]}>
                    Diners enter their name or choose their profile to claim their consumed items.
                  </Text>
                </View>
              </View>

              <Text style={[styles.sectionHeading, { color: colors.textSecondary }]}>
                ITEMS & CONSUMABLES ({bill.items.length})
              </Text>

              {bill.items.map((item) => {
                const organizerQty =
                  item.claimedQuantities?.[organizer.id] ??
                  (item.assignedParticipantIds.includes(organizer.id) ? 1 : 0);
                const isClaimedByOrganizer = organizerQty > 0;
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.itemRowMock,
                      {
                        backgroundColor: isClaimedByOrganizer
                          ? 'rgba(16, 185, 129, 0.05)'
                          : colors.surfaceElevated,
                        borderColor: isClaimedByOrganizer
                          ? 'rgba(16, 185, 129, 0.3)'
                          : colors.borderSubtle,
                      },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.itemMockName, { color: colors.textPrimary }]}>
                        {item.quantity > 1 ? `${item.quantity}x ` : ''}{item.name}
                      </Text>
                      <Text style={[styles.itemMockSub, { color: isClaimedByOrganizer ? '#10B981' : colors.textTertiary }]}>
                        {isClaimedByOrganizer
                          ? `🔒 Already paid by organizer (${organizer.name})`
                          : '✓ Available to claim'}
                      </Text>
                    </View>

                    <Text style={[styles.itemMockPrice, { color: colors.textPrimary }]}>
                      €{item.totalPrice.toFixed(2)}
                    </Text>
                  </View>
                );
              })}
            </View>
          </ScrollView>

          {/* Action Footer Buttons */}
          <View style={[styles.modalFooter, { backgroundColor: colors.surface, borderTopColor: colors.borderSubtle }]}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleOpenBrowser}
              style={[styles.openBrowserBtn, { backgroundColor: colors.accent }]}
            >
              <Globe size={18} color="#000000" />
              <Text style={styles.openBrowserBtnText}>
                Open in Browser to Test
              </Text>
              <ExternalLink size={15} color="#000000" />
            </TouchableOpacity>

            <View style={styles.secondaryBtnRow}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleCopy}
                style={[
                  styles.footerBtn,
                  {
                    backgroundColor: copied ? '#10B981' : colors.surfaceElevated,
                    borderColor: copied ? '#10B981' : colors.borderSubtle,
                  },
                ]}
              >
                {copied ? (
                  <>
                    <CheckCircle2 size={16} color="#FFFFFF" />
                    <Text style={[styles.footerBtnText, { color: '#FFFFFF' }]}>
                      Link Copied!
                    </Text>
                  </>
                ) : (
                  <>
                    <Copy size={16} color={colors.textPrimary} />
                    <Text style={[styles.footerBtnText, { color: colors.textPrimary }]}>
                      Copy Link
                    </Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleShareWhatsApp}
                style={[styles.footerBtn, { backgroundColor: '#25D366' }]}
              >
                <MessageCircle size={16} color="#FFFFFF" />
                <Text style={[styles.footerBtnText, { color: '#FFFFFF' }]}>
                  Send WhatsApp
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },
  containerCard: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '88%',
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    overflow: 'hidden',
  },
  browserBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: 1,
    gap: SPACING.sm,
  },
  windowDots: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  addressBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E293B',
    paddingHorizontal: SPACING.sm + 2,
    paddingVertical: 5,
    borderRadius: RADIUS.sm,
  },
  addressText: {
    flex: 1,
    color: '#E2E8F0',
    fontSize: 11,
    fontFamily: 'monospace',
  },
  miniCopyBtn: {
    padding: 2,
  },
  closeWindowBtn: {
    padding: 4,
  },
  browserContent: {
    padding: SPACING.md,
  },
  webHeader: {
    padding: SPACING.lg,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    marginBottom: SPACING.lg,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: SPACING.md,
  },
  logoCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandTitle: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '800',
  },
  receiptTotalLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  receiptTotalValue: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
    marginBottom: SPACING.md,
  },
  organizerCoveredBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: SPACING.sm,
  },
  organizerCoveredTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  organizerCoveredDesc: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  remainingBox: {
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  remainingLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  remainingAmount: {
    fontSize: 20,
    fontWeight: '900',
    marginTop: 2,
  },
  itemsPreviewSection: {
    gap: SPACING.xs,
  },
  sectionHeading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    marginBottom: SPACING.xs,
  },
  itemRowMock: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    marginBottom: 4,
  },
  itemMockName: {
    fontSize: 14,
    fontWeight: '600',
  },
  itemMockSub: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
  itemMockPrice: {
    fontSize: 14,
    fontWeight: '700',
  },
  modalFooter: {
    padding: SPACING.md,
    borderTopWidth: 1,
    gap: SPACING.sm,
  },
  openBrowserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: RADIUS.lg,
  },
  openBrowserBtnText: {
    color: '#000000',
    fontSize: 15,
    fontWeight: '800',
  },
  secondaryBtnRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  footerBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 40,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  footerBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
