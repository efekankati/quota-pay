import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Animated,
  Platform,
  Easing,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Plus, Camera, Image as ImageIcon, Utensils, X } from 'lucide-react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useHaptics } from '../../hooks/useHaptics';
import { RADIUS, SPACING } from '../../config/theme';

interface FloatingActionMenuProps {
  onCameraPress: () => void;
  onGalleryPress: () => void;
  onManualPress: () => void;
}

export const FloatingActionMenu: React.FC<FloatingActionMenuProps> = ({
  onCameraPress,
  onGalleryPress,
  onManualPress,
}) => {
  const { colors, mode } = useThemeStore();
  const { t } = useLanguageStore();
  const { lightImpact, mediumImpact } = useHaptics();

  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const animation = useRef(new Animated.Value(0)).current;

  const openMenu = () => {
    mediumImpact();
    setIsMounted(true);
    setIsOpen(true);
    Animated.spring(animation, {
      toValue: 1,
      friction: 7,
      tension: 48,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  const closeMenu = (callback?: () => void) => {
    if (isOpen || isMounted) {
      lightImpact();
      setIsOpen(false);
      // Snappy, smooth 160ms ease-out retracting with zero spring oscillation/stutter
      Animated.timing(animation, {
        toValue: 0,
        duration: 160,
        easing: Easing.bezier(0.25, 0.1, 0.25, 1),
        useNativeDriver: Platform.OS !== 'web',
      }).start(() => {
        setIsMounted(false);
        callback?.();
      });
    } else if (callback) {
      callback();
    }
  };

  const toggleMenu = () => {
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  };

  const handleAction = (actionCallback: () => void) => {
    try {
      actionCallback();
    } catch (err) {
      console.error('Error executing floating action:', err);
    }
    closeMenu();
  };

  // Clamped interpolations with GPU-friendly ranges
  const rotation = animation.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
    extrapolate: 'clamp',
  });

  const overlayOpacity = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  // Action items translation: shoot up smoothly from behind plus button and retract cleanly
  const cameraTranslateY = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [24, -168],
    extrapolate: 'clamp',
  });
  const galleryTranslateY = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [16, -112],
    extrapolate: 'clamp',
  });
  const manualTranslateY = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [8, -56],
    extrapolate: 'clamp',
  });

  const actionScale = animation.interpolate({
    inputRange: [0, 1],
    outputRange: [0.65, 1],
    extrapolate: 'clamp',
  });

  const actionOpacity = animation.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, 0.45, 1],
    extrapolate: 'clamp',
  });

  return (
    <>
      {/* Blurred Backdrop Overlay */}
      {isMounted && (
        <Animated.View
          pointerEvents={isOpen ? 'auto' : 'none'}
          style={[
            styles.backdrop,
            { opacity: overlayOpacity },
            Platform.OS === 'web' && ({
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            } as any),
          ]}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => closeMenu()}
            style={StyleSheet.absoluteFill}
          >
            {Platform.OS !== 'web' ? (
              <BlurView
                intensity={60}
                tint={mode === 'dark' ? 'dark' : 'light'}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor:
                    mode === 'dark'
                      ? 'rgba(7, 10, 15, 0.72)'
                      : 'rgba(240, 243, 246, 0.72)',
                },
              ]}
            />
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Floating Container (Positioned right above bottom navigation profile button) */}
      <View style={styles.container} pointerEvents="box-none">
        {/* Floating Action 1: Camera Scanner */}
        {isMounted && (
          <Animated.View
            pointerEvents={isOpen ? 'auto' : 'none'}
            style={[
              styles.actionRow,
              {
                opacity: actionOpacity,
                transform: [
                  { translateY: cameraTranslateY },
                  { scale: actionScale },
                ],
              },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => handleAction(onCameraPress)}
              style={[
                styles.actionLabelPill,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[styles.actionLabelText, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {t('fabCamera')}
              </Text>
            </TouchableOpacity>

            <View style={styles.actionBtnSlot}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => handleAction(onCameraPress)}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.accent,
                  },
                ]}
              >
                <Camera size={22} color={colors.accent} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Floating Action 2: Gallery Picker */}
        {isMounted && (
          <Animated.View
            pointerEvents={isOpen ? 'auto' : 'none'}
            style={[
              styles.actionRow,
              {
                opacity: actionOpacity,
                transform: [
                  { translateY: galleryTranslateY },
                  { scale: actionScale },
                ],
              },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => handleAction(onGalleryPress)}
              style={[
                styles.actionLabelPill,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[styles.actionLabelText, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {t('fabGallery')}
              </Text>
            </TouchableOpacity>

            <View style={styles.actionBtnSlot}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => handleAction(onGalleryPress)}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.accent,
                  },
                ]}
              >
                <ImageIcon size={22} color={colors.accent} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Floating Action 3: Manual Bill Creation */}
        {isMounted && (
          <Animated.View
            pointerEvents={isOpen ? 'auto' : 'none'}
            style={[
              styles.actionRow,
              {
                opacity: actionOpacity,
                transform: [
                  { translateY: manualTranslateY },
                  { scale: actionScale },
                ],
              },
            ]}
          >
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => handleAction(onManualPress)}
              style={[
                styles.actionLabelPill,
                {
                  backgroundColor: colors.surfaceElevated,
                  borderColor: colors.border,
                },
              ]}
            >
              <Text
                style={[styles.actionLabelText, { color: colors.textPrimary }]}
                numberOfLines={1}
              >
                {t('fabManual')}
              </Text>
            </TouchableOpacity>

            <View style={styles.actionBtnSlot}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => handleAction(onManualPress)}
                style={[
                  styles.actionBtn,
                  {
                    backgroundColor: colors.surfaceElevated,
                    borderColor: colors.accent,
                  },
                ]}
              >
                <Utensils size={20} color={colors.accent} strokeWidth={2.4} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}

        {/* Main Floating Trigger Button */}
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={toggleMenu}
          style={[
            styles.fabTrigger,
            {
              backgroundColor: colors.accent,
              shadowColor: colors.accent,
              shadowOpacity: mode === 'dark' ? 0.45 : 0.3,
            },
          ]}
          accessibilityLabel={isOpen ? t('close') || 'Chiudi' : t('newBill') || 'Nuovo Conto'}
        >
          <Animated.View style={{ transform: [{ rotate: rotation }] }}>
            <Plus
              size={28}
              color={mode === 'dark' ? '#000000' : '#FFFFFF'}
              strokeWidth={2.8}
            />
          </Animated.View>
        </TouchableOpacity>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 90,
  },
  container: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 280,
    height: 250,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    zIndex: 95,
  },
  fabTrigger: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 8,
  },
  actionRow: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    minWidth: 260,
    ...(Platform.OS === 'web' ? ({
      willChange: 'transform, opacity',
    } as any) : {}),
  },
  actionBtnSlot: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  actionLabelPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 6,
    elevation: 4,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  actionLabelText: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.2,
    flexShrink: 0,
    ...(Platform.OS === 'web' ? ({ whiteSpace: 'nowrap' } as any) : {}),
  },
  actionBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 6,
  },
});
