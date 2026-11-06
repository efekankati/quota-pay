import React, { useEffect, useState, useRef, useCallback } from 'react';
import { StyleSheet, View, Animated, Platform, Easing } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useThemeStore } from './store/useThemeStore';
import { StripeService } from './services/payment/StripeService';
import { RootNavigator } from './navigation/RootNavigator';
import { CustomAlertModal } from './components/common/CustomAlertModal';
import { OpeningSplashScreen } from './components/common/OpeningSplashScreen';

export default function App() {
  const { mode, colors } = useThemeStore();
  const isDirectGuestWebLink =
    Platform.OS === 'web' &&
    typeof window !== 'undefined' &&
    Boolean(
      window.location?.search?.includes('bill=') ||
        window.location?.search?.includes('claim=') ||
        window.location?.search?.includes('split=') ||
        window.location?.pathname?.includes('/pay/') ||
        window.location?.pathname?.includes('/bill/')
    );

  const [isSplashVisible, setIsSplashVisible] = useState(!isDirectGuestWebLink);

  // Home dashboard spatial depth scale (0.96 -> 1.0 during reveal phase)
  const contentScale = useRef(new Animated.Value(isDirectGuestWebLink ? 1.0 : 0.96)).current;

  useEffect(() => {
    StripeService.initialize().catch((err) =>
      console.warn('[Stripe] Initialization notice:', err)
    );
  }, []);

  const handleRevealStart = useCallback(() => {
    Animated.timing(contentScale, {
      toValue: 1.0,
      duration: 500,
      easing: Easing.bezier(0.16, 1, 0.3, 1),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [contentScale]);

  const handleSplashFinish = useCallback(() => {
    contentScale.setValue(1.0);
    setIsSplashVisible(false);
  }, [contentScale]);

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Animated.View
        style={[
          styles.contentLayer,
          isSplashVisible && {
            transform: [{ scale: contentScale }],
          },
        ]}
        pointerEvents={isSplashVisible ? 'none' : 'auto'}
        accessibilityElementsHidden={isSplashVisible}
        importantForAccessibility={isSplashVisible ? 'no-hide-descendants' : 'auto'}
      >
        <RootNavigator />
      </Animated.View>
      <CustomAlertModal />
      {isSplashVisible && (
        <OpeningSplashScreen
          onFinish={handleSplashFinish}
          onRevealStart={handleRevealStart}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    overflow: 'hidden',
  },
  contentLayer: {
    flex: 1,
  },
});
