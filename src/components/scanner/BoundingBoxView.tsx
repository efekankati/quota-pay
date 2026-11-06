import React from 'react';
import { View, StyleSheet, Text, Dimensions } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { RADIUS, SPACING } from '../../config/theme';

interface BoundingBoxViewProps {
  isScanning: boolean;
}

const { width } = Dimensions.get('window');
const BOX_WIDTH = width * 0.85;
const BOX_HEIGHT = BOX_WIDTH * 1.45; // Receipt aspect ratio

export const BoundingBoxView: React.FC<BoundingBoxViewProps> = ({ isScanning }) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();

  return (
    <View style={styles.container}>
      <View style={[styles.box, { borderColor: isScanning ? colors.accent : 'rgba(255,255,255,0.4)' }]}>
        {/* Four Corner Reticles */}
        <View style={[styles.corner, styles.topLeft, { borderColor: colors.accent }]} />
        <View style={[styles.corner, styles.topRight, { borderColor: colors.accent }]} />
        <View style={[styles.corner, styles.bottomLeft, { borderColor: colors.accent }]} />
        <View style={[styles.corner, styles.bottomRight, { borderColor: colors.accent }]} />

        {/* Scanning laser beam indicator */}
        <View
          style={[
            styles.laserBeam,
            {
              backgroundColor: colors.accent,
              shadowColor: colors.accent,
            },
          ]}
        />

        {/* Framing Helper Text */}
        <View style={[styles.instructionBadge, { backgroundColor: 'rgba(0, 0, 0, 0.75)' }]}>
          <Text style={styles.instructionText}>
            {t('frameReceiptHint')}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  box: {
    width: BOX_WIDTH,
    height: BOX_HEIGHT,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderStyle: 'dashed',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderWidth: 3,
  },
  topLeft: {
    top: -2,
    left: -2,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    borderTopLeftRadius: RADIUS.lg,
  },
  topRight: {
    top: -2,
    right: -2,
    borderLeftWidth: 0,
    borderBottomWidth: 0,
    borderTopRightRadius: RADIUS.lg,
  },
  bottomLeft: {
    bottom: -2,
    left: -2,
    borderRightWidth: 0,
    borderTopWidth: 0,
    borderBottomLeftRadius: RADIUS.lg,
  },
  bottomRight: {
    bottom: -2,
    right: -2,
    borderLeftWidth: 0,
    borderTopWidth: 0,
    borderBottomRightRadius: RADIUS.lg,
  },
  laserBeam: {
    position: 'absolute',
    width: '92%',
    height: 2,
    top: '40%',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 8,
    elevation: 4,
  },
  instructionBadge: {
    position: 'absolute',
    bottom: SPACING.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderRadius: RADIUS.full,
  },
  instructionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});
