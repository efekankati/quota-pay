import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { FileText, MapPin, Sparkles, X } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { SAMPLE_ITALIAN_RECEIPTS, SampleReceipt } from '../../services/ocr/sampleReceipts';
import { RADIUS, SPACING, TYPOGRAPHY } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface ReceiptPreviewModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectSample: (index: number) => void;
}

export const ReceiptPreviewModal: React.FC<ReceiptPreviewModalProps> = ({
  visible,
  onClose,
  onSelectSample,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { lightImpact, mediumImpact } = useHaptics();

  const handleSelect = (index: number) => {
    mediumImpact();
    onSelectSample(index);
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
        <View style={[styles.modalContent, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          {/* Header */}
          <View style={styles.headerRow}>
            <View style={styles.titleGroup}>
              <View style={styles.sparkleTitle}>
                <Sparkles size={18} color={colors.accent} />
                <Text style={[styles.modalTitle, { color: colors.textPrimary }]}>
                  {t('realReceiptsModalTitle')}
                </Text>
              </View>
              <Text style={[styles.modalSubtitle, { color: colors.textSecondary }]}>
                {t('realReceiptsModalSubtitle')}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => {
                lightImpact();
                onClose();
              }}
              style={[styles.closeCircle, { backgroundColor: colors.surfaceElevated }]}
            >
              <X size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Sample Cards List */}
          <ScrollView contentContainerStyle={styles.scrollList}>
            {SAMPLE_ITALIAN_RECEIPTS.map((sample: SampleReceipt, index: number) => (
              <TouchableOpacity
                key={sample.id}
                activeOpacity={0.8}
                onPress={() => handleSelect(index)}
                style={[
                  styles.sampleCard,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.border,
                  },
                ]}
              >
                <View style={styles.sampleTop}>
                  <View style={styles.nameRow}>
                    <FileText size={16} color={colors.accent} />
                    <Text style={[styles.sampleName, { color: colors.textPrimary }]}>
                      {sample.name}
                    </Text>
                  </View>
                  <View style={styles.cityPill}>
                    <MapPin size={12} color={colors.textSecondary} />
                    <Text style={[styles.cityText, { color: colors.textSecondary }]}>
                      {sample.city}
                    </Text>
                  </View>
                </View>

                {/* Receipt Line Snippets */}
                <View style={[styles.linesBox, { backgroundColor: colors.background }]}>
                  {sample.rawLines.slice(3, 7).map((line, lIdx) => (
                    <Text
                      key={lIdx}
                      style={[styles.monoLine, { color: colors.textSecondary }]}
                      numberOfLines={1}
                    >
                      • {line}
                    </Text>
                  ))}
                  <Text style={[styles.moreLines, { color: colors.accent }]}>
                    + altre {sample.rawLines.length - 4} voci (Coperto, IVA, Totale)
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
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
  modalContent: {
    borderTopLeftRadius: RADIUS.xl,
    borderTopRightRadius: RADIUS.xl,
    borderTopWidth: 1,
    padding: SPACING.xl,
    maxHeight: '80%',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.lg,
  },
  titleGroup: {
    flex: 1,
    paddingRight: SPACING.md,
  },
  sparkleTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  modalTitle: {
    ...TYPOGRAPHY.titleMedium,
    fontWeight: '700',
  },
  modalSubtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  closeCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollList: {
    gap: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  sampleCard: {
    borderRadius: RADIUS.lg,
    padding: SPACING.md,
    borderWidth: 1,
  },
  sampleTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  sampleName: {
    fontSize: 15,
    fontWeight: '700',
  },
  cityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cityText: {
    fontSize: 12,
    fontWeight: '500',
  },
  linesBox: {
    borderRadius: RADIUS.sm,
    padding: SPACING.sm,
    gap: 3,
  },
  monoLine: {
    fontFamily: 'monospace',
    fontSize: 11,
  },
  moreLines: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
});
