import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Easing,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { CheckCircle2, Sparkles, X } from 'lucide-react-native';
import { useLanguageStore } from '../../store/useLanguageStore';
import { useThemeStore } from '../../store/useThemeStore';
import { RADIUS, SPACING } from '../../config/theme';
import { useHaptics } from '../../hooks/useHaptics';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ScanningOverlayHUDProps {
  isScanning: boolean;
  isComplete?: boolean;
  onFinishedAnimation?: () => void;
  onCancel?: () => void;
}

interface StepItem {
  id: string;
  labelKey:
    | 'processingStepCaptured'
    | 'processingStepPrep'
    | 'processingStepCompress'
    | 'processingStepUpload'
    | 'processingStepExtract'
    | 'processingStepVerify';
}

const STEPS: StepItem[] = [
  { id: 'captured', labelKey: 'processingStepCaptured' },
  { id: 'prep', labelKey: 'processingStepPrep' },
  { id: 'compress', labelKey: 'processingStepCompress' },
  { id: 'upload', labelKey: 'processingStepUpload' },
  { id: 'extract', labelKey: 'processingStepExtract' },
  { id: 'verify', labelKey: 'processingStepVerify' },
];

/**
 * Animated Circular Arc Spinner matching the neo-fintech HUD
 */
const StepArcSpinner: React.FC<{ size?: number; color?: string }> = ({
  size = 18,
  color = '#00D589',
}) => {
  const spinAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 850,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    animation.start();
    return () => animation.stop();
  }, [spinAnim]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        style={[
          styles.arcSpinner,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: 'transparent',
            borderTopColor: color,
            borderRightColor: color,
            transform: [{ rotate: spin }],
          },
        ]}
      />
    </View>
  );
};

export const ScanningOverlayHUD: React.FC<ScanningOverlayHUDProps> = ({
  isScanning,
  isComplete = false,
  onFinishedAnimation,
  onCancel,
}) => {
  const { t } = useLanguageStore();
  const { colors } = useThemeStore();
  const { lightImpact, successNotification } = useHaptics();

  // Stable ref for haptics so effects never re-run due to function recreation
  const hapticsRef = useRef({ lightImpact, successNotification });
  useEffect(() => {
    hapticsRef.current = { lightImpact, successNotification };
  }, [lightImpact, successNotification]);

  // Active step index (0 to STEPS.length)
  // When currentStep = n: steps < n are completed, step n is active, steps > n are pending
  const [currentStep, setCurrentStep] = useState<number>(0);
  const [progressPercent, setProgressPercent] = useState<number>(15);

  // Monotonic tracking refs to prevent any jitter, rocking back & forth, or re-vibrations
  const highestStepRef = useRef<number>(0);
  const vibratedStepsRef = useRef<Set<number>>(new Set());

  // Animations
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0.15)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;

  // Track progressAnim to update display percentage smoothly (strictly monotonic, never jumps backwards)
  useEffect(() => {
    const listenerId = progressAnim.addListener(({ value }) => {
      const calculated = Math.min(100, Math.round(value * 100));
      setProgressPercent((prev) => Math.max(prev, calculated));
    });
    return () => {
      progressAnim.removeListener(listenerId);
    };
  }, [progressAnim]);

  // Logo pulse loop
  useEffect(() => {
    if (isScanning) {
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }).start();

      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.06,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 900,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      fadeAnim.setValue(0);
      pulseAnim.setValue(1);
    }
  }, [isScanning, pulseAnim, fadeAnim]);

  // Safe step progress dispatcher ensuring strictly forward movement and single vibration
  const advanceToStep = (targetStep: number, targetProgress: number, duration: number = 400) => {
    if (targetStep > highestStepRef.current) {
      highestStepRef.current = targetStep;
      setCurrentStep(targetStep);

      if (!vibratedStepsRef.current.has(targetStep)) {
        vibratedStepsRef.current.add(targetStep);
        hapticsRef.current.lightImpact();
      }

      Animated.timing(progressAnim, {
        toValue: targetProgress,
        duration,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();
    }
  };

  // Stepped progression timeline: runs ONLY when `isScanning` changes
  useEffect(() => {
    if (!isScanning) {
      highestStepRef.current = 0;
      vibratedStepsRef.current.clear();
      setCurrentStep(0);
      progressAnim.setValue(0.15);
      setProgressPercent(15);
      return;
    }

    // Step 0: Image captured successfully is complete, Step 1 (Prep) is active
    highestStepRef.current = 1;
    vibratedStepsRef.current.add(1);
    setCurrentStep(1);
    Animated.timing(progressAnim, {
      toValue: 0.28,
      duration: 350,
      easing: Easing.out(Easing.ease),
      useNativeDriver: false,
    }).start();

    // After 450ms -> Step 2 (Compress & Optimize)
    const t1 = setTimeout(() => {
      advanceToStep(2, 0.48, 450);
    }, 450);

    // After 1050ms -> Step 3 (Upload / Connect to Vision Engine)
    const t2 = setTimeout(() => {
      advanceToStep(3, 0.68, 500);
    }, 1050);

    // After 1750ms -> Step 4 (Extract items & quantities) - holds here steadily until isComplete
    const t3 = setTimeout(() => {
      advanceToStep(4, 0.88, 550);
    }, 1750);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isScanning]); // Intentionally ONLY depend on isScanning

  // Trigger final completion when isComplete turns true
  useEffect(() => {
    if (!isScanning || !isComplete) return;

    // Advance to Step 5 (Verifying fiscal totals & tax)
    advanceToStep(5, 0.95, 250);

    // After 320ms, complete all steps (currentStep = 6 means all 6 steps are checked with green checkmarks!)
    const tFinish = setTimeout(() => {
      highestStepRef.current = 6;
      setCurrentStep(6);
      hapticsRef.current.successNotification();

      Animated.timing(progressAnim, {
        toValue: 1.0,
        duration: 300,
        easing: Easing.out(Easing.ease),
        useNativeDriver: false,
      }).start();

      // Brief 500ms pause of 100% satisfaction before proceeding to verification
      const tProceed = setTimeout(() => {
        if (onFinishedAnimation) {
          onFinishedAnimation();
        }
      }, 500);

      return () => clearTimeout(tProceed);
    }, 320);

    return () => clearTimeout(tFinish);
  }, [isScanning, isComplete, onFinishedAnimation]);

  if (!isScanning) return null;

  const progressWidthInterpolate = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Animated.View style={[styles.fullscreenBackdrop, { opacity: fadeAnim }]}>
      {/* Top Header Row with Title and optional Cancel */}
      <View style={styles.topBar}>
        <View style={{ width: 40 }} />
        <Text style={styles.screenHeading}>
          {t('processingReceiptTitle')}
        </Text>
        {onCancel ? (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={onCancel}
            style={styles.cancelButton}
            accessibilityLabel={t('cancel')}
          >
            <X size={20} color="#94A3B8" />
          </TouchableOpacity>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      {/* Center Branded App Glowing Squircle */}
      <View style={styles.logoSection}>
        {/* Ambient Radial Aura Glow */}
        <View style={styles.ambientGlow} />

        <Animated.View
          style={[
            styles.squircleBadge,
            {
              transform: [{ scale: pulseAnim }],
            },
          ]}
        >
          {/* Neon inner icon */}
          <View style={styles.badgeInnerIconBox}>
            <Text style={[styles.brandLettermark, { color: colors.accent }]}>Q</Text>
            <Sparkles size={14} color={colors.accent} style={styles.badgeSparkle} />
          </View>
        </Animated.View>
      </View>

      {/* Neo-Fintech Progress Bar & Percentage */}
      <View style={styles.progressBarWrapper}>
        <View style={styles.progressBarHeader}>
          <Text style={[styles.progressBarStageText, { color: colors.accent }]} numberOfLines={1}>
            {currentStep >= 6
              ? t('analysisCompletedStage')
              : t('stageProgress', {
                  current: Math.min(currentStep + 1, 6),
                  total: 6,
                })}
          </Text>
          <Text style={styles.progressBarPercentText}>
            {progressPercent}%
          </Text>
        </View>

        <View style={styles.progressTrack}>
          <Animated.View
            style={[
              styles.progressFill,
              {
                width: progressWidthInterpolate,
                backgroundColor: colors.accent,
              },
            ]}
          />
        </View>
      </View>

      {/* Progress Steps List matching the design */}
      <View style={styles.stepsContainer}>
        {STEPS.map((step, index) => {
          const isFinished = index < currentStep;
          const isActive = index === currentStep;
          const isPending = index > currentStep;

          return (
            <View key={step.id} style={styles.stepRow}>
              {/* Status Indicator Icon */}
              <View style={styles.stepIconBox}>
                {isFinished ? (
                  <View style={styles.completedCheckCircle}>
                    <CheckCircle2 size={20} color={colors.accent} />
                  </View>
                ) : isActive ? (
                  <StepArcSpinner size={18} color={colors.accent} />
                ) : (
                  <View style={styles.pendingCircle} />
                )}
              </View>

              {/* Step Text Label */}
              <Text
                style={[
                  styles.stepLabel,
                  isFinished && styles.stepLabelCompleted,
                  isActive && [styles.stepLabelActive, { color: colors.accent }],
                  isPending && styles.stepLabelPending,
                ]}
                numberOfLines={1}
              >
                {t(step.labelKey)}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Explanatory Context Subtitle at bottom */}
      <View style={styles.footerSection}>
        <Text style={styles.footerExplanation}>
          {t('processingExplanation')}
        </Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  fullscreenBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#090B0E',
    zIndex: 9999,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 54,
    paddingBottom: 40,
    paddingHorizontal: SPACING.xl,
  },

  /* Top Bar */
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  screenHeading: {
    fontSize: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  cancelButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
  },

  /* Center Glowing Badge */
  logoSection: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: SPACING.md,
  },
  ambientGlow: {
    position: 'absolute',
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: 'rgba(0, 213, 137, 0.2)',
    shadowColor: '#00D589',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 36,
    elevation: 15,
  },
  squircleBadge: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: '#131822',
    borderWidth: 1.5,
    borderColor: 'rgba(0, 213, 137, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00D589',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 18,
    elevation: 12,
  },
  badgeInnerIconBox: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLettermark: {
    fontSize: 38,
    fontWeight: '900',
    color: '#00D589',
    textShadowColor: 'rgba(0, 213, 137, 0.5)',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 12,
    letterSpacing: -1,
  },
  badgeSparkle: {
    position: 'absolute',
    top: -2,
    right: -10,
  },

  /* Progress Bar */
  progressBarWrapper: {
    width: '100%',
    maxWidth: 320,
    marginBottom: SPACING.lg,
  },
  progressBarHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  progressBarStageText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#00D589',
    letterSpacing: 0.8,
  },
  progressBarPercentText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  progressTrack: {
    width: '100%',
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  /* Steps Container */
  stepsContainer: {
    width: '100%',
    maxWidth: 320,
    gap: 16,
    marginVertical: SPACING.xs,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  stepIconBox: {
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedCheckCircle: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pendingCircle: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  arcSpinner: {
    borderWidth: 2,
  },

  stepLabel: {
    fontSize: 15,
    flex: 1,
  },
  stepLabelCompleted: {
    color: '#FFFFFF',
    fontWeight: '600',
  },
  stepLabelActive: {
    color: '#00D589',
    fontWeight: '700',
  },
  stepLabelPending: {
    color: '#64748B',
    fontWeight: '400',
  },

  /* Footer */
  footerSection: {
    maxWidth: 320,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  footerExplanation: {
    fontSize: 13,
    lineHeight: 18,
    color: '#94A3B8',
    textAlign: 'center',
  },
});
