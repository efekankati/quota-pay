import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
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
 *   * Root canvas (#0A0B0E) occludes entire app (including bottom nav & FAB).
 *   * "Q" emblem eases in with scale (0.80 -> 1.0) and opacity (0 -> 1) transparently on #0A0B0E.
 *   * Emerald radial glow (#00E676 / #10B981) breathes in behind emblem.
 *   * Typography ("Quota Pay") fades in staggered at 350ms – 1000ms (+8px translateY -> 0px, opacity 0 -> 1).
 *
 * - Phase 2: Steady Brand Hold (1000ms – 1600ms)
 *   * 600ms steady hold of the complete brand mark.
 *
 * - Phase 3: Cinematic Scale & Dissolve Reveal (1600ms – 2400ms)
 *   * "Q" emblem smoothly scales up (1.0 -> 3.2) and dissolves (opacity 1 -> 0).
 *   * Splash background dissolves concurrently, revealing the Home dashboard beneath with subtle depth scaling.
 *   * Unmounts cleanly at 2400ms.
 */
export const OpeningSplashScreen: React.FC<OpeningSplashScreenProps> = ({
  onFinish,
  onRevealStart,
}) => {
  const { lightImpact } = useHaptics();

  // Root splash overlay opacity (100% opaque until Phase 3 dissolve)
  const overlayOpacity = useRef(new Animated.Value(1)).current;

  // Q emblem animation values (scale 0.8 -> 1.0 -> 3.2 & opacity 0 -> 1 -> 0)
  const emblemScale = useRef(new Animated.Value(0.8)).current;
  const emblemOpacity = useRef(new Animated.Value(0)).current;

  // Typography ("Quota Pay") staggered entry & dissolve
  const textOpacity = useRef(new Animated.Value(0)).current;
  const textTranslateY = useRef(new Animated.Value(8)).current;

  // Emerald radial glow values
  const glowScale = useRef(new Animated.Value(0.75)).current;
  const glowOpacity = useRef(new Animated.Value(0)).current;

  const isCompletedRef = useRef(false);
  const activeAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const skipAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const [isUnmounted, setIsUnmounted] = useState(false);

  const callbacksRef = useRef({ onFinish, onRevealStart, lightImpact });
  useEffect(() => {
    callbacksRef.current = { onFinish, onRevealStart, lightImpact };
  }, [onFinish, onRevealStart, lightImpact]);

  const stopAllSplashAnimations = () => {
    activeAnimationRef.current?.stop();
    activeAnimationRef.current = null;
    skipAnimationRef.current?.stop();
    skipAnimationRef.current = null;
    overlayOpacity.stopAnimation();
    overlayOpacity.removeAllListeners();
    emblemScale.stopAnimation();
    emblemScale.removeAllListeners();
    emblemOpacity.stopAnimation();
    emblemOpacity.removeAllListeners();
    textOpacity.stopAnimation();
    textOpacity.removeAllListeners();
    textTranslateY.stopAnimation();
    textTranslateY.removeAllListeners();
    glowScale.stopAnimation();
    glowScale.removeAllListeners();
    glowOpacity.stopAnimation();
    glowOpacity.removeAllListeners();
  };

  useEffect(() => {
    const useNative = Platform.OS !== 'web';

    // Intercept hardware back button on Android during launch
    const backSubscription = BackHandler.addEventListener('hardwareBackPress', () => {
      return true;
    });

    // --- PHASE 1 (0ms – 1000ms): Emblem & Radial Glow Ease-In + Staggered Typography ---
    const emblemAndGlowEntry = Animated.parallel([
      Animated.timing(emblemOpacity, {
        toValue: 1,
        duration: 950,
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
        toValue: 0.24,
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

    const phase1 = Animated.parallel([emblemAndGlowEntry, textEntry]);

    // --- PHASE 2 (1000ms – 1600ms): Steady Brand Hold (600ms) ---
    const phase2 = Animated.parallel([
      Animated.sequence([
        Animated.timing(glowOpacity, {
          toValue: 0.28,
          duration: 300,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: useNative,
        }),
        Animated.timing(glowOpacity, {
          toValue: 0.22,
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

    // --- PHASE 3 (1600ms – 2400ms): Smooth Scale-Up (1.0 -> 3.2) & Dissolve ---
    const phase3 = Animated.parallel([
      Animated.timing(emblemScale, {
        toValue: 3.2,
        duration: 800,
        easing: EXPANSION_EASE,
        useNativeDriver: useNative,
      }),
      Animated.timing(emblemOpacity, {
        toValue: 0,
        duration: 750,
        easing: Easing.out(Easing.quad),
        useNativeDriver: useNative,
      }),
      Animated.parallel([
        Animated.timing(textOpacity, {
          toValue: 0,
          duration: 350,
          easing: Easing.out(Easing.quad),
          useNativeDriver: useNative,
        }),
        Animated.timing(textTranslateY, {
          toValue: -6,
          duration: 350,
          easing: Easing.out(Easing.quad),
          useNativeDriver: useNative,
        }),
      ]),
      Animated.timing(glowScale, {
        toValue: 3.0,
        duration: 800,
        easing: EXPANSION_EASE,
        useNativeDriver: useNative,
      }),
      Animated.timing(glowOpacity, {
        toValue: 0,
        duration: 700,
        easing: Easing.out(Easing.quad),
        useNativeDriver: useNative,
      }),
      Animated.sequence([
        Animated.delay(150),
        Animated.timing(overlayOpacity, {
          toValue: 0,
          duration: 650,
          easing: FINTECH_EASE,
          useNativeDriver: useNative,
        }),
      ]),
    ]);

    // Master 2400ms sequence
    const masterTimeline = Animated.sequence([phase1, phase2, phase3]);
    activeAnimationRef.current = masterTimeline;

    // Subtle tactile haptic when brand lockup settles at 950ms
    const settleTimer = setTimeout(() => {
      if (!isCompletedRef.current) {
        callbacksRef.current.lightImpact();
      }
    }, 950);

    // Trigger Home dashboard subtle depth scale reveal at 1650ms
    const revealStartTimer = setTimeout(() => {
      if (!isCompletedRef.current) {
        callbacksRef.current.onRevealStart?.();
      }
    }, 1650);

    masterTimeline.start(({ finished }) => {
      if (finished && !isCompletedRef.current) {
        isCompletedRef.current = true;
        stopAllSplashAnimations();
        setIsUnmounted(true);
        callbacksRef.current.onFinish();
      }
    });

    return () => {
      clearTimeout(settleTimer);
      clearTimeout(revealStartTimer);
      backSubscription.remove();
      stopAllSplashAnimations();
    };
  }, []);

  // Allow tap-to-skip only after steady brand hold
  const handleSkip = () => {
    if (isCompletedRef.current) return;
    isCompletedRef.current = true;
    callbacksRef.current.onRevealStart?.();
    activeAnimationRef.current?.stop();
    const skipAnim = Animated.timing(overlayOpacity, {
      toValue: 0,
      duration: 180,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    });
    skipAnimationRef.current = skipAnim;
    skipAnim.start(() => {
      stopAllSplashAnimations();
      setIsUnmounted(true);
      callbacksRef.current.onFinish();
    });
  };

  if (isUnmounted) {
    return null;
  }

  const emblemWidth = Math.min(SCREEN_WIDTH * 0.44, 176);
  const emblemHeight = emblemWidth * (310 / 400);
  const glowSize = Math.max(emblemWidth * 2.0, 320);

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
        {/* Emerald Radial Glow (#00E676 / #10B981) sitting directly on #0A0B0E */}
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
              <RadialGradient id="emeraldLaunchGlow" cx="50%" cy="50%" rx="50%" ry="50%">
                <Stop offset="0%" stopColor="#00E676" stopOpacity="0.45" />
                <Stop offset="42%" stopColor="#10B981" stopOpacity="0.24" />
                <Stop offset="75%" stopColor="#00E676" stopOpacity="0.06" />
                <Stop offset="100%" stopColor="#10B981" stopOpacity="0" />
              </RadialGradient>
            </Defs>
            <Circle
              cx={glowSize / 2}
              cy={glowSize / 2}
              r={glowSize / 2}
              fill="url(#emeraldLaunchGlow)"
            />
          </Svg>
        </Animated.View>

        {/* Transparent Brand Lockup: Zero Rectangular Card or Container */}
        <View style={styles.brandLockup}>
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
              style={{
                width: emblemWidth,
                height: emblemHeight,
                backgroundColor: 'transparent',
              }}
              resizeMode="contain"
              fadeDuration={0}
              accessibilityLabel="Quota Emblem"
            />
          </Animated.View>

          {/* Staggered "Quota Pay" Typography */}
          <Animated.View
            style={[
              styles.textWrapper,
              {
                opacity: textOpacity,
                transform: [{ translateY: textTranslateY }],
              },
            ]}
          >
            <View style={styles.wordmarkRow}>
              <Text style={styles.wordmarkQuota}>Quota</Text>
              <Text style={styles.wordmarkPay}>Pay</Text>
            </View>
          </Animated.View>
        </View>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    ...(Platform.OS === 'web'
      ? ({
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          width: '100vw',
          height: '100vh',
        } as any)
      : {}),
    backgroundColor: '#0A0B0E',
    zIndex: 99999,
    elevation: 99999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pressableContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  glowContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
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
  wordmarkRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    gap: 10,
  },
  wordmarkQuota: {
    fontSize: 38,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.8,
  },
  wordmarkPay: {
    fontSize: 38,
    fontWeight: '800',
    color: '#00E676',
    letterSpacing: -0.8,
  },
});
