import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image as ImageIcon, Zap, ZapOff } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { SHADOWS, SPACING } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

interface CameraOverlayProps {
  flashMode: 'off' | 'on';
  onToggleFlash: () => void;
  onCapture: () => void;
  onPickImage?: () => void;
  isScanning: boolean;
}

export const CameraOverlay: React.FC<CameraOverlayProps> = ({
  flashMode,
  onToggleFlash,
  onCapture,
  onPickImage,
  isScanning,
}) => {
  const { colors } = useThemeStore();
  const { heavyImpact, lightImpact } = useHaptics();

  return (
    <View pointerEvents="box-none" style={styles.controlsContainer}>
      <View pointerEvents="box-none" style={styles.bottomBar}>
        {/* Pick from Gallery Button */}
        <TouchableOpacity
          activeOpacity={0.7}
          disabled={isScanning}
          onPress={() => {
            lightImpact();
            if (onPickImage) {
              onPickImage();
            }
          }}
          style={[styles.smallActionCircle, { backgroundColor: 'rgba(0,0,0,0.65)' }]}
          accessibilityLabel="Pick Receipt from Photos"
        >
          <ImageIcon size={22} color="#FFFFFF" />
        </TouchableOpacity>

        {/* Shutter Button */}
        <TouchableOpacity
          activeOpacity={0.8}
          disabled={isScanning}
          onPress={() => {
            lightImpact();
            onCapture();
          }}
          style={[
            styles.shutterOuterRing,
            { borderColor: isScanning ? colors.amber : colors.accent },
          ]}
          accessibilityLabel="Capture Receipt"
        >
          <View
            style={[
              styles.shutterInnerCircle,
              SHADOWS.glowAccent,
              { backgroundColor: isScanning ? colors.amber : colors.accent },
            ]}
          >
            {isScanning && (
              <ActivityIndicator size="small" color="#000000" />
            )}
          </View>
        </TouchableOpacity>

        {/* Flash Mode Toggle Button */}
        <TouchableOpacity
          activeOpacity={0.7}
          disabled={isScanning}
          onPress={() => {
            lightImpact();
            onToggleFlash();
          }}
          style={[
            styles.smallActionCircle,
            {
              backgroundColor: flashMode === 'on' ? colors.accent : 'rgba(0,0,0,0.65)',
              borderColor: flashMode === 'on' ? colors.accent : 'transparent',
              borderWidth: flashMode === 'on' ? 1 : 0,
            },
          ]}
          accessibilityLabel="Toggle Flash"
        >
          {flashMode === 'on' ? (
            <Zap size={20} color="#000000" />
          ) : (
            <ZapOff size={20} color="#FFFFFF" />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  controlsContainer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: SPACING.xl,
    paddingBottom: SPACING.xxl + 8,
  },
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    width: '100%',
  },
  shutterOuterRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  shutterInnerCircle: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallActionCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
});
