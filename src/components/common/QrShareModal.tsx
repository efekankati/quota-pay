import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Platform,
  Share,
  BackHandler,
} from 'react-native';
import Svg, { Rect, Path } from 'react-native-svg';
import { Copy, Check, X, QrCode, Sparkles, ExternalLink } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useHaptics } from '../../hooks/useHaptics';
import { BrightnessService } from '../../services/brightness/BrightnessService';
import { DeepLinkService } from '../../services/deepLink/DeepLinkService';
import { BillSyncService } from '../../services/sync/BillSyncService';
import { generateQrMatrix } from '../../utils/qrCodeGenerator';
import { RADIUS, SPACING, SHADOWS, TYPOGRAPHY } from '../../config/theme';
import { BillSession } from '../../types/bill';

interface QrShareModalProps {
  visible: boolean;
  onClose: () => void;
  value?: string;
  bill?: BillSession;
  title?: string;
  subtitle?: string;
  amount?: number;
  currencySymbol?: string;
}

export const QrShareModal: React.FC<QrShareModalProps> = ({
  visible,
  onClose,
  value,
  bill,
  title,
  subtitle,
  amount,
  currencySymbol,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { lightImpact, successNotification } = useHaptics();
  const [copied, setCopied] = useState(false);

  const targetValue = value || (bill ? DeepLinkService.getBrowserDevUrl(bill) : 'https://quotapay.eu');
  const targetTitle = title || bill?.restaurantName || t('appName');
  const targetSubtitle = subtitle || bill?.title || t('qrModalDefaultSubtitle');
  const targetAmount = amount !== undefined ? amount : bill?.taxSummary.grandTotal;
  const targetCurrencySymbol =
    currencySymbol ||
    (bill?.currency === 'USD'
      ? '$'
      : bill?.currency === 'GBP'
      ? '£'
      : bill?.currency === 'TRY'
      ? '₺'
      : bill?.currency === 'CHF'
      ? 'CHF '
      : '€');

  // Animations
  const scaleAnim = useRef(new Animated.Value(0.88)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  // Cleanup reference for screen brightness restoration
  const brightnessCleanupRef = useRef<(() => Promise<void>) | null>(null);

  // Generate SVG Path for QR Code Matrix
  const { matrix, svgPath, moduleCount } = useMemo(() => {
    try {
      const mat = generateQrMatrix(targetValue || 'https://quotapay.eu', 'M');
      const count = mat.length;
      let pathStr = '';

      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (mat[r][c]) {
            pathStr += `M${c},${r}h1v1h-1z `;
          }
        }
      }

      return { matrix: mat, svgPath: pathStr, moduleCount: count };
    } catch (err) {
      console.warn('QR Code generation notice:', err);
      return { matrix: [], svgPath: '', moduleCount: 25 };
    }
  }, [targetValue]);

  // Maximize brightness when QR is shown, restore when hidden
  useEffect(() => {
    let isMounted = true;

    if (visible) {
      lightImpact();

      // Ensure live bill snapshot is synced to cloud when QR is displayed
      if (bill) {
        BillSyncService.saveBillToCloud(bill).catch(() => {});
      }

      // Set screen brightness to 100% maximum
      BrightnessService.setBrightnessToMax().then((cleanup) => {
        if (isMounted) {
          brightnessCleanupRef.current = cleanup;
        } else {
          cleanup();
        }
      });

      // Animate card entrance
      Animated.parallel([
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 180,
          useNativeDriver: Platform.OS !== 'web',
        }),
        Animated.spring(scaleAnim, {
          toValue: 1,
          friction: 8,
          tension: 60,
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]).start();
    } else {
      // Restore brightness immediately on modal close
      if (brightnessCleanupRef.current) {
        brightnessCleanupRef.current();
        brightnessCleanupRef.current = null;
      }
      setCopied(false);
      scaleAnim.setValue(0.88);
      opacityAnim.setValue(0);
    }

    const backSub =
      visible && Platform.OS === 'android'
        ? BackHandler.addEventListener('hardwareBackPress', () => {
            handleDismiss();
            return true;
          })
        : null;

    return () => {
      isMounted = false;
      backSub?.remove();
      if (brightnessCleanupRef.current) {
        brightnessCleanupRef.current();
        brightnessCleanupRef.current = null;
      }
    };
  }, [visible]);

  const handleDismiss = () => {
    lightImpact();
    // Restore brightness on touch outside
    if (brightnessCleanupRef.current) {
      brightnessCleanupRef.current();
      brightnessCleanupRef.current = null;
    }

    Animated.parallel([
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 140,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.9,
        duration: 140,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start(() => {
      onClose();
    });
  };

  const handleCopyLink = async () => {
    successNotification();
    await Clipboard.setStringAsync(targetValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2400);
  };

  if (!visible) return null;

  const QR_CANVAS_SIZE = 240;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleDismiss}
    >
      <View style={styles.backdropOverlay}>
        {/* Tap-to-dismiss Backdrop behind the card */}
        <TouchableOpacity
          activeOpacity={1}
          onPress={handleDismiss}
          style={StyleSheet.absoluteFill}
        />

        <Animated.View
          style={[
            styles.centeredContainer,
            {
              opacity: opacityAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}
        >
          <View
            style={[
              styles.qrCard,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
              },
              SHADOWS.card,
            ]}
          >
            {/* Card Header */}
            <View style={styles.cardHeader}>
              <View style={styles.headerTitleRow}>
                <View style={[styles.qrIconBadge, { backgroundColor: colors.accentLight }]}>
                  <QrCode size={18} color={colors.accent} strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.quotaTitle, { color: colors.textPrimary }]} numberOfLines={1}>
                    {targetTitle}
                  </Text>
                  <Text style={[styles.quotaSubtitle, { color: colors.textSecondary }]} numberOfLines={1}>
                    {targetSubtitle}
                  </Text>
                </View>
              </View>

              {/* Close X Button */}
              <TouchableOpacity
                onPress={handleDismiss}
                style={[styles.closeBtn, { backgroundColor: colors.surfaceElevated }]}
              >
                <X size={16} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            {targetAmount !== undefined && targetAmount > 0 && (
              <View style={[styles.amountPill, { backgroundColor: colors.surfaceElevated }]}>
                <Text style={[styles.amountLabel, { color: colors.textSecondary }]}>{t('totalLabel')}:</Text>
                <Text style={[styles.amountValue, { color: colors.accent }]}>
                  {targetCurrencySymbol}{targetAmount.toFixed(2)}
                </Text>
              </View>
            )}

            {/* Ultra-Bright White QR Display Container */}
            <View style={styles.qrPlateWrapper}>
              <View style={styles.qrWhitePlate}>
                {moduleCount > 0 && svgPath ? (
                  <Svg
                    width={QR_CANVAS_SIZE}
                    height={QR_CANVAS_SIZE}
                    viewBox={`-2 -2 ${moduleCount + 4} ${moduleCount + 4}`}
                  >
                    <Rect
                      x={-2}
                      y={-2}
                      width={moduleCount + 4}
                      height={moduleCount + 4}
                      fill="#FFFFFF"
                    />
                    <Path d={svgPath} fill="#000000" />
                  </Svg>
                ) : (
                  <View style={styles.qrFallbackPlaceholder}>
                    <QrCode size={64} color="#000000" />
                  </View>
                )}
              </View>
            </View>

            {/* Bottom Actions: Copy Link */}
            <View style={styles.actionsFooter}>
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleCopyLink}
                style={[
                  styles.copyBtn,
                  {
                    backgroundColor: copied ? colors.accentLight : colors.surfaceElevated,
                    borderColor: copied ? colors.accent : colors.border,
                  },
                ]}
              >
                {copied ? (
                  <>
                    <Check size={16} color={colors.accent} strokeWidth={2.5} />
                    <Text style={[styles.copyBtnText, { color: colors.accent }]}>{t('linkCopiedTitle')}</Text>
                  </>
                ) : (
                  <>
                    <Copy size={16} color={colors.textPrimary} />
                    <Text style={[styles.copyBtnText, { color: colors.textPrimary }]}>{t('shareTableLink')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdropOverlay: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  centeredContainer: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qrCard: {
    width: '100%',
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    padding: SPACING.xl,
    alignItems: 'center',
  },
  cardHeader: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  headerTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  qrIconBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quotaTitle: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  quotaSubtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  amountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: RADIUS.full,
    marginBottom: SPACING.md,
  },
  amountLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  amountValue: {
    fontSize: 14,
    fontWeight: '800',
  },
  qrPlateWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    marginBottom: SPACING.lg,
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.xl,
    shadowColor: '#FFFFFF',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 8,
  },
  qrWhitePlate: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: RADIUS.lg,
    padding: 6,
  },
  qrFallbackPlaceholder: {
    width: 220,
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  centerBadge: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  centerBadgeInner: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#00E676',
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerBadgeText: {
    fontSize: 15,
    fontWeight: '900',
    color: '#000000',
  },
  brightnessNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: SPACING.md,
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.sm,
  },
  brightnessNoteText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  actionsFooter: {
    width: '100%',
    alignItems: 'center',
    gap: 8,
  },
  copyBtn: {
    width: '100%',
    height: 44,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  copyBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  tapDismissHint: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },
});
