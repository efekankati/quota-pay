import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Modal,
  Animated,
  TouchableOpacity,
  Platform,
  Easing,
  Dimensions,
  Keyboard,
  LayoutAnimation,
} from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import { RADIUS, SPACING } from '../../config/theme';

interface FloatingBottomModalProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: number;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

/**
 * Premium Floating Bottom Popup Modal
 * - Positioned ergonomically near the bottom with margins on all sides (floating card)
 * - Shifts upwards smoothly when the software keyboard opens so inputs are never covered
 * - Shoots up smoothly from the bottom with a tuned spring transition
 * - Glides back down smoothly on dismiss
 * - Clean dark frosted backdrop with tap-to-dismiss
 */
export const FloatingBottomModal: React.FC<FloatingBottomModalProps> = ({
  visible,
  onClose,
  children,
  maxWidth = 440,
}) => {
  const { colors } = useThemeStore();
  const [isRendered, setIsRendered] = useState(visible);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [overlayHeight, setOverlayHeight] = useState(SCREEN_HEIGHT);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onKeyboardShow = (e: any) => {
      const kbHeight = e?.endCoordinates?.height || 0;
      if (Platform.OS !== 'web') {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setKeyboardHeight(kbHeight);
    };

    const onKeyboardHide = () => {
      if (Platform.OS !== 'web') {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setKeyboardHeight(0);
    };

    const showSub = Keyboard.addListener(showEvent, onKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, onKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      setIsRendered(true);
      Animated.spring(anim, {
        toValue: 1,
        friction: 8,
        tension: 50,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    } else if (isRendered) {
      setKeyboardHeight(0);
      // Snappy, silky 170ms ease-in exit downwards without lag
      Animated.timing(anim, {
        toValue: 0,
        duration: 170,
        easing: Easing.bezier(0.32, 0, 0.67, 0),
        useNativeDriver: Platform.OS !== 'web',
      }).start(({ finished }) => {
        if (finished) {
          setIsRendered(false);
        }
      });
    }
  }, [visible]);

  if (!isRendered) return null;

  const backdropOpacity = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_HEIGHT * 0.3, 0],
    extrapolate: 'clamp',
  });

  const cardScale = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
    extrapolate: 'clamp',
  });

  const cardOpacity = anim.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0.6, 1],
    extrapolate: 'clamp',
  });

  // Calculate effective keyboard shift (accounting for any automatic window resize)
  const windowShrink = Math.max(0, SCREEN_HEIGHT - overlayHeight);
  const effectiveKeyboardShift = Math.max(0, keyboardHeight - windowShrink);
  const baseBottomPadding = Platform.OS === 'ios' ? SPACING.xxl : SPACING.xl;
  const dynamicBottomPadding =
    keyboardHeight > 0 ? effectiveKeyboardShift + SPACING.sm : baseBottomPadding;
  const availableCardMaxHeight =
    keyboardHeight > 0
      ? Math.max(260, SCREEN_HEIGHT - keyboardHeight - (Platform.OS === 'ios' ? 56 : 36))
      : SCREEN_HEIGHT * 0.86;

  return (
    <Modal
      visible={isRendered}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View
        style={[
          styles.overlay,
          {
            paddingBottom: dynamicBottomPadding,
            paddingTop: keyboardHeight > 0 ? (Platform.OS === 'ios' ? 44 : 24) : SPACING.xl,
          },
        ]}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 0) setOverlayHeight(h);
        }}
      >
        {/* Animated Dark Frosted Backdrop */}
        <Animated.View
          style={[
            styles.backdrop,
            { opacity: backdropOpacity },
            Platform.OS === 'web' && ({
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              willChange: 'opacity',
              transform: 'translateZ(0)',
            } as any),
          ]}
        >
          <TouchableOpacity
            style={styles.backdropTouch}
            activeOpacity={1}
            onPress={() => {
              Keyboard.dismiss();
              onClose();
            }}
          />
        </Animated.View>

        {/* Floating Card: shoots up smoothly from the bottom and shifts above the keyboard */}
        <Animated.View
          style={[
            styles.floatingCard,
            {
              maxWidth,
              maxHeight: availableCardMaxHeight,
              backgroundColor: colors.surface,
              borderColor: colors.border,
              opacity: cardOpacity,
              transform: [
                { translateY },
                { scale: cardScale },
              ],
            },
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingBottom: Platform.OS === 'ios' ? SPACING.xxl : SPACING.xl,
    paddingTop: SPACING.xl,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.72)',
  },
  backdropTouch: {
    flex: 1,
  },
  floatingCard: {
    width: '100%',
    borderRadius: RADIUS.xl,
    borderWidth: 1.5,
    padding: SPACING.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.45,
    shadowRadius: 28,
    elevation: 16,
    ...(Platform.OS === 'web' ? ({
      willChange: 'transform, opacity',
      transform: 'translateZ(0)',
    } as any) : {}),
  },
});
