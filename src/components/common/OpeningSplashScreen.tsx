import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Animated,
  Dimensions,
  Image,
  Pressable,
  Platform,
  Easing,
  BackHandler,
} from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Circle } from 'react-native-svg';
import { useHaptics } from '../../hooks/useHaptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface OpeningSplashScreenProps {
  onFinish: () => void;
  onRevealStart?: () => void;
}

// Ultra-smooth cubic-bezier deceleration curves
const FINTECH_EASE = Easing.bezier(0.16, 1, 0.3, 1);
const EXPANSION_EASE = Easing.bezier(0.4, 0, 0.2, 1);

/**
 * Cinematic 2.4-Second Launch Screen for Quota Pay
 *
 * Timeline Choreography:
 * - Phase 1: Soft Atmospheric Entry (0ms – 1000ms)
 *   * Dark background (#0A0B0E) occludes entire app.
 *   * "Q" emblem fades 0 -> 1 and eases in scale 0.80 -> 1.0.
 *   * Emerald/teal radial glow (#00E676 / #00BFA5) breathes in behind emblem.
 *   * Typography ("Quota Pay") enters staggered at 350ms – 1000ms (+8px translateY -> 0px, opacity 0 -> 1).
 *
 * - Phase 2: Elegant Brand Hold (1000ms – 1600ms)
 *   * 600ms steady hold showcasing the complete brand lockup.
 *   * Ambient glow gently oscillates between 0.18 and 0.24 opacity.
 *
 * - Phase 3: Cinematic Zoom & Dissolve Reveal (1600ms – 2400ms)
 *   * "Q" emblem scales outward (1.0 -> 3.2) while fading to 0 (1800ms – 2300ms).
 *   * Typography fades out faster by 1900ms (visual focus on expanding emblem).
 *   * Background overlay fades 1 -> 0 (1900ms – 2400ms), revealing Home dashboard as it expands 0.96 -> 1.0.
 *   * Cleanly unmounts at 2400ms.
 */
export const OpeningSplashScreen: React.FC<OpeningSplashScreenProps> = ({
  onFinish,
  onRevealStart,
}) => {
  const { lightImpact } = useHaptics();

  // Root splash overlay opacity (100% opaque until reveal at 1900ms)
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  // Q emblem animation values (GPU-accelerated transform: scale & opacity)
  const emblemScale = useRef(new Animated.Value(0.8)).current;
  const emblemOpacity = useRef(new Animated.Value(0)).current;

  // Typography animation values (staggered entry & translateY)
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(8)).current;

  // Ambient radial glow values
  const glowScale = useRef(new Animated.Value(0.75)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  const isCompletedRef = useRef(false);
  const activeAnimationRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    const useNative = Platform.OS !== 'web';

    // Intercept hardware back button on Android during launch
    const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
      return true;
    });

    // --- TIMELINE ORCHESTRATION ---

    // 1. Emblem & Glow Entry (0ms – 1000ms)
    const emblemAndGlowEntry = Animated.parallel([
      Animated.timing(emblemOpacity, {
        toValue: 1,
        duration: 900,
        easing: FINTECH_EASE,
        useNativeDriver: useNative,
      }),
      Animated.timing(emblemScale, {
        toValue: 1.0,
        duration: 1000,
        easing: FINTECH_EASE,
        useNativeDriver: useNative,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0.20,
        duration: 1000,
        easing: FINTECH_EASE,
        useNativeDriver: useNative,
      }),
      Animated.timing(glowScale, {
        toValue: 1.05,
        duration: 1000,
        easing: FINTECH_EASE,
        useNativeDriver: useNative,
      }),
    ]);

    // 2. Typography Staggered Entry (350ms – 1000ms, 650ms duration)
    const textEntry = Animated.sequence([
      Animated.delay(350),
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 650,
          easing: FINTECH_EASE,
          useNativeDriver: useNative,
        }),
        Animated.timing(textTranslateY, {
          toValue: 0,
          duration: 650,
          easing: FINTECH_EASE,
          useNativeDriver: useNative,
        }),
      ]),
    ]);

    // Phase 1 combo (0ms – 1000ms)
    const phase1 = Animated.parallel([emblemAndGlowEntry, textEntry]);

    // Phase 2: Elegant Brand Hold (1000ms – 1600ms, 600ms duration)
    const phase2 = Animated.parallel([
      Animated.sequence([
        Animated.timing(glowOpacity, {
          toValue: 0.24,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.20,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
      ]),
      Animated.sequence([
        Animated.timing(glowScale, {
          toValue: 1.12,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
        Animated.timing(glowScale, {
          toValue: 1.06,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
      ]),
    ]);

    // Phase 3: Cinematic Zoom & Dissolve Reveal (1600ms – 2400ms, 800ms duration)
    const phase3 = Animated.parallel([
      // Emblem expands smoothly 1.0 -> 3.2
      Animated.timing(emblemScale, {
        toValue: 3.2,
        duration: 800,
        easing: EXPANSION_EASE,
        useNativeDriver: useNative,
      }),
      // Emblem fades out between 1800ms and 2300ms (delay 200ms into Phase 3)
      Animated.sequence([
        Animated.delay(200),
        Animated.timing(emblemOpacity, {
          toValue: 0,
          duration: 500,
          easing: Easing.out(Easing.quad),
          useNativeDriver: useNative,
        }),
      ]),
      // Typography fades out faster by 1900ms (300ms duration from 1600ms)
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 0,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: useNative,
        }),
        Animated.timing(textTranslateY, {
          toValue: -4,
          duration: 300,
          easing: Easing.out(Easing.quad),
          useNativeDriver: useNative,
        }),
      ]),
      // Ambient glow expands and dissipates
      Animated.timing(glowScale, {
        toValue: 3.0,
        duration: 800,
        easing: EXPANSION_EASE,
        useNativeDriver: useNative,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0,
        duration: 650,
        easing: Easing.out(Easing.quad),
        useNativeDriver: useNative,
      }),
      // Root overlay fades out seamlessly from 1900ms to 2400ms (300ms delay into Phase 3, 500ms duration)
      Animated.sequence([
        Animated.delay(300),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 500,
          easing: FINTECH_EASE,
          useNativeDriver: useNative,
        }),
      ]),
    ]);

    // Full 2.4-second sequential master timeline
    const masterTimeline = Animated.sequence([phase1, phase2, phase3]);
    activeAnimationRef.current = masterTimeline;

    // Trigger subtle tactile haptic at steady brand settle (~950ms)
    const settleTimer = setTimeout(() => {
      if (!isCompletedRef.current) {
        lightImpact();
      }
    }, 950);

    // Trigger reveal start callback at 1900ms for concurrent Home dashboard scale-up
    const revealStartTimer = setTimeout(() => {
      if (!isCompletedRef.current) {
        onRevealStart?.();
      }
    }, 1900);

    masterTimeline.start(({ finished }) => {
      if (finished && !isCompletedRef.current) {
        isCompletedRef.current = true;
        onFinish();
      }
    });

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(revealStartTimer);
      backSubscription.remove();
      if (activeAnimationRef.current) {
        activeAnimationRef.current.stop();
      }
    };
  }, [lightImpact, onFinish, onRevealStart]);

  // Fast-skip on tap
  const handleSkip = () => {
    if (isCompletedRef.current) return;
    isCompletedRef.current = true;
    onRevealStart?.();
    if (activeAnimationRef.current) {
      activeAnimationRef.current.stop();
    }
    Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 150,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    }).start(() => {
      onFinish();
    });
  };

  // Dimensions matching the authentic 400x310 emblem and 440x96 typography
  const emblemWidth = Math.min(SCREEN_WIDTH * 0.42, 168);
  const emblemHeight = emblemWidth * (310 / 400);

  const textWidth = Math.min(SCREEN_WIDTH * 0.58, 232);
  const textHeight = textWidth * (96 / 440);

  const glowSize = Math.max(emblemWidth * 1.85, 300);

  return (
    <Animated.View
      style={[
        styles.overlay,
        {
          opacity: overlayOpacity,
        },
      ]}
      pointerEvents="auto"
      accessible={false}
    >
      <Pressable style={styles.pressableContainer} onPress={handleSkip}>
        {/* Soft Radial Emerald/Teal Ambient Glow (#00E676 / #00BFA5, ~60px blur, ~0.20 peak opacity) */}
        <Animated.View
          style={[
            styles.glowContainer,
            {
              width: glowSize,
              height: glowSize,
              borderRadius: glowSize / 2,
              transform: [{ scale: glowScale }],
              opacity: glowOpacity,
            },
          ]}
          pointerEvents="none"
        >
          <Svg width={glowSize} height={glowSize} viewBox={`0 0 ${glowSize} ${glowSize}`}>
            <Defs>
              <RadialGradient id="cinematicGlow" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0%" stopColor="#00E676" stopOpacity="0.40" />
                <Stop offset="38%" stopColor="#00BFA5" stopOpacity="0.22" />
                <Stop offset="72%" stopColor="#00E676" stopOpacity="0.06" />
                <Stop offset="100%" stopColor="#00BFA5" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle
              cx={glowSize / 2}
              cy={glowSize / 2}
              r={glowSize / 2}
              fill="url(#cinematicGlow)"
            />
          </Svg>
        </Animated.View>

        {/* Central Brand Lockup: Emblem + Typography */}
        <View style={styles.brandLockup}>
          {/* "Q" Emblem (Transparent PNG with GPU-accelerated scale & opacity) */}
          <Animated.View
            style={[
              styles.emblemWrapper,
              {
                opacity: emblemOpacity,
                transform: [{ scale: emblemScale }],
              },
            ]}
          >
            <Image
              source={require('../../../assets/quota-emblem.png')}
              style={{ width: emblemWidth, height: emblemHeight }}
              resizeMode="contain"
              fadeDuration={0}
              accessibilityLabel="Quota Emblem"
            />
          </Animated.View>

          {/* Typography ("Quota Pay") with staggered entry & subtle upward translation */}
          <Animated.View
            style={[
              styles.textWrapper,
              {
                opacity: textOpacity,
                transform: [{ translateY: textTranslateY }],
              },
            ]}
          >
            <Image
              source={require('../../../assets/quota-text.png')}
              style={{ width: textWidth, height: textHeight }}
              resizeMode="contain"
              fadeDuration={0}
              accessibilityLabel="Quota Pay"
            />
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#0A0B0E',
    zIndex: 99999,
    elevation: 99999,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    height: '100%',
  },
  pressableContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  glowContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  brandLockup: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
    backgroundColor: 'transparent',
  },
  emblemWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  textWrapper: {
    marginTop: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
});
