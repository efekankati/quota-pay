import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { View, StyleSheet, BackHandler, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import { useBillStore } from '../store/useBillStore';
import { useAuthStore } from '../store/useAuthStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { DeepLinkService } from '../services/deepLink/DeepLinkService';
import { BillSyncService } from '../services/sync/BillSyncService';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { HomeScreen } from '../screens/HomeScreen';
import { QuotasScreen } from '../screens/QuotasScreen';
import { ScannerScreen } from '../screens/ScannerScreen';
import { ItemizerScreen } from '../screens/ItemizerScreen';
import { SplitPaymentScreen } from '../screens/SplitPaymentScreen';
import { SessionSummaryScreen } from '../screens/SessionSummaryScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { GuestClaimScreen } from '../screens/GuestClaimScreen';
import { BillVerificationScreen } from '../screens/BillVerificationScreen';
import { AuthScreen } from '../screens/AuthScreen';
import { ManualBillBuilderScreen } from '../screens/ManualBillBuilderScreen';
import { OneUIBottomNav, MainTabType } from '../components/common/OneUIBottomNav';

export type ScreenType =
  | 'onboarding'
  | 'home'
  | 'quotas'
  | 'scanner'
  | 'verification'
  | 'itemizer'
  | 'payment'
  | 'summary'
  | 'profile'
  | 'guest_claim'
  | 'auth'
  | 'manual_builder';

export const RootNavigator: React.FC = () => {
  const { isAuthenticated } = useAuthStore();
  const { setActiveBill, bills, upsertBill, ensureBillExists } = useBillStore();

  // Check if launched directly with a bill URL on web
  const initialUrlInfo = useMemo(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.href) {
      return DeepLinkService.parseBillUrl(window.location.href);
    }
    return null;
  }, []);

  useEffect(() => {
    if (!initialUrlInfo) return;
    if (initialUrlInfo.lang) {
      useLanguageStore.getState().setLanguage(initialUrlInfo.lang);
    } else if (initialUrlInfo.isGuest || initialUrlInfo.billId || initialUrlInfo.claimId) {
      useLanguageStore.getState().syncWithSystemLanguage();
    }
    if (initialUrlInfo.billData) {
      const existing = useBillStore
        .getState()
        .bills.find((b) => b.id === (initialUrlInfo.billId || initialUrlInfo.billData?.id));
      if (!existing) {
        useBillStore.getState().upsertBill(initialUrlInfo.billData);
      }
    }
  }, [initialUrlInfo]);

  const [isGuestSession, setIsGuestSession] = useState<boolean>(() =>
    Boolean(initialUrlInfo?.isGuest || initialUrlInfo?.billId || initialUrlInfo?.claimId)
  );

  const [currentScreen, setCurrentScreen] = useState<ScreenType>(() => {
    if (initialUrlInfo?.billId || initialUrlInfo?.claimId) {
      if (initialUrlInfo.isGuest || initialUrlInfo.claimId) return 'guest_claim';
      return 'itemizer';
    }
    return isAuthenticated ? 'home' : 'onboarding';
  });

  const [history, setHistory] = useState<ScreenType[]>([]);
  const [activeBillId, setActiveBillId] = useState<string>(
    initialUrlInfo?.billId || bills[0]?.id || ''
  );
  const [activeParticipantId, setActiveParticipantId] = useState<string>(
    initialUrlInfo?.claimId || 'user_me'
  );

  // Fetch deep-linked living bill from Supabase cloud on mount or if not available locally
  useEffect(() => {
    const targetBillId = initialUrlInfo?.billId || activeBillId;
    let isMounted = true;

    if (targetBillId) {
      const existingLocally = useBillStore.getState().bills.find((b) => b.id === targetBillId);
      // If we already have this bill locally with items, don't overwrite it with a fresh cloud fetch race
      if (existingLocally && existingLocally.items && existingLocally.items.length > 0) {
        return;
      }

      BillSyncService.fetchBillFromCloud(targetBillId)
        .then((cloudBill) => {
          if (cloudBill && isMounted) {
            useBillStore.getState().upsertBill(cloudBill);
          }
        })
        .catch(() => {});
    } else if (initialUrlInfo?.claimId) {
      BillSyncService.fetchBillBySplitId(initialUrlInfo.claimId)
        .then(({ bill, participantId }) => {
          if (bill && isMounted) {
            useBillStore.getState().upsertBill(bill);
            setActiveBillId(bill.id);
            if (participantId) {
              setActiveParticipantId(participantId);
            }
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [initialUrlInfo?.billId, initialUrlInfo?.claimId, activeBillId]);

  // Push navigation
  const navigateTo = useCallback((screen: ScreenType) => {
    setCurrentScreen((prev) => {
      setHistory((hist) => [...hist, prev]);
      return screen;
    });
  }, []);

  // Pop navigation / Back action
  const goBack = useCallback(() => {
    setHistory((prev) => {
      if (prev.length > 0) {
        const nextHistory = [...prev];
        const lastScreen = nextHistory.pop()!;
        setCurrentScreen(lastScreen);
        return nextHistory;
      }
      setCurrentScreen(isGuestSession ? 'guest_claim' : 'home');
      return [];
    });
  }, [isGuestSession]);

  // Direct Home navigation (clears traveled wizard history)
  const goToHome = useCallback(() => {
    setHistory([]);
    setCurrentScreen(Platform.OS === 'web' && isGuestSession ? 'guest_claim' : 'home');
  }, [isGuestSession]);

  // Samsung One UI Bottom Navigation tab changer
  const handleTabChange = useCallback(
    (tab: MainTabType) => {
      if (tab === 'home') {
        goToHome();
      } else if (tab === 'quotas') {
        setHistory((hist) => (currentScreen !== 'home' ? [...hist, currentScreen] : ['home']));
        setCurrentScreen('quotas');
      } else if (tab === 'profile') {
        setHistory((hist) => (currentScreen !== 'home' ? [...hist, currentScreen] : ['home']));
        setCurrentScreen('profile');
      }
    },
    [currentScreen, goToHome]
  );

  // Is bottom navigation active
  const isBottomNavVisible =
    currentScreen === 'home' || currentScreen === 'quotas' || currentScreen === 'profile';

  const activeTab: MainTabType =
    currentScreen === 'quotas' ? 'quotas' : currentScreen === 'profile' ? 'profile' : 'home';

  // Phone hardware back button handling
  useEffect(() => {
    const handleHardwareBackPress = () => {
      if (currentScreen !== 'home') {
        if (
          currentScreen === 'scanner' ||
          currentScreen === 'verification' ||
          currentScreen === 'itemizer' ||
          currentScreen === 'manual_builder' ||
          currentScreen === 'summary' ||
          currentScreen === 'quotas' ||
          currentScreen === 'profile'
        ) {
          goToHome();
        } else {
          goBack();
        }
        return true;
      }
      return false;
    };

    const backHandlerSubscription = BackHandler.addEventListener(
      'hardwareBackPress',
      handleHardwareBackPress
    );

    return () => backHandlerSubscription.remove();
  }, [currentScreen, goBack, goToHome]);

  // Universal Links & Deep Link Ingestion (runs once on mount)
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const { billId, claimId, isGuest, billData, lang } = DeepLinkService.parseBillUrl(event.url);
      if (lang) {
        useLanguageStore.getState().setLanguage(lang);
      }
      const targetId = billId || billData?.id;
      if (billData) {
        const existing = useBillStore.getState().bills.find((b) => b.id === targetId);
        if (!existing) {
          upsertBill(billData);
        }
      }
      if (targetId) {
        BillSyncService.fetchBillFromCloud(targetId)
          .then((cloudBill) => {
            if (cloudBill) {
              upsertBill(cloudBill);
            }
          })
          .catch(() => {});
      }
      if (billId) {
        if (!billData) {
          ensureBillExists(billId);
        }
        setActiveBillId(billId);
        setActiveBill(billId);
        if (claimId) {
          setIsGuestSession(true);
          setActiveParticipantId(claimId);
          setCurrentScreen('payment');
        } else if (isGuest) {
          setIsGuestSession(true);
          setCurrentScreen('guest_claim');
        } else {
          setCurrentScreen('itemizer');
        }
      }
    };

    if (Platform.OS !== 'web') {
      Linking.getInitialURL().then((url) => {
        if (url) handleUrl({ url });
      });
    }

    const subscription = Linking.addEventListener('url', handleUrl);

    return () => {
      subscription.remove();
    };
  }, [setActiveBill, upsertBill, ensureBillExists]);

  return (
    <View style={styles.container}>
      <View style={styles.screenContent}>
        {currentScreen === 'onboarding' && (
          <OnboardingScreen onComplete={() => setCurrentScreen('home')} />
        )}

        {currentScreen === 'home' && (
          <HomeScreen
            onOpenScanner={() => navigateTo('scanner')}
            onOpenBillDetails={(id) => {
              setActiveBillId(id);
              navigateTo('summary');
            }}
            onOpenItemizer={(id) => {
              setActiveBillId(id);
              navigateTo('itemizer');
            }}
            onOpenManualBuilder={(id) => {
              setActiveBillId(id);
              navigateTo('manual_builder');
            }}
            onOpenVerification={(id) => {
              setActiveBillId(id);
              navigateTo('verification');
            }}
            onOpenSettings={() => navigateTo('profile')}
            onOpenQuotas={() => navigateTo('quotas')}
          />
        )}

        {currentScreen === 'quotas' && (
          <QuotasScreen
            onOpenBillDetails={(id) => {
              setActiveBillId(id);
              navigateTo('summary');
            }}
            onOpenScanner={() => navigateTo('scanner')}
            onOpenItemizer={(id) => {
              setActiveBillId(id);
              navigateTo('itemizer');
            }}
            onOpenManualBuilder={(id) => {
              setActiveBillId(id);
              navigateTo('manual_builder');
            }}
            onOpenVerification={(id) => {
              setActiveBillId(id);
              navigateTo('verification');
            }}
          />
        )}

        {currentScreen === 'profile' && (
          <ProfileScreen
            onBack={goToHome}
            onOpenAuth={() => navigateTo('auth')}
          />
        )}

        {currentScreen === 'scanner' && (
          <ScannerScreen
            onBack={goToHome}
            onProceedToItemizer={(newBillId) => {
              setActiveBillId(newBillId);
              setHistory(['home']);
              setCurrentScreen('itemizer');
            }}
            onProceedToVerification={(newBillId) => {
              setActiveBillId(newBillId);
              setHistory(['home']);
              setCurrentScreen('verification');
            }}
          />
        )}

        {currentScreen === 'verification' && (
          <BillVerificationScreen
            billId={activeBillId}
            onBack={goToHome}
            onAcceptAndProceedToItemizer={(newBillId) => {
              setActiveBillId(newBillId);
              setHistory(['home']);
              setCurrentScreen('itemizer');
            }}
          />
        )}

        {currentScreen === 'itemizer' && (
          <ItemizerScreen
            billId={activeBillId}
            onBack={goToHome}
            onProceedToPayment={(bId, pId) => {
              setActiveBillId(bId);
              setActiveParticipantId(pId);
              setActiveBill(bId);
              navigateTo('payment');
            }}
            onProceedToSummary={(bId) => {
              setActiveBillId(bId);
              setHistory(['home']);
              setCurrentScreen('summary');
            }}
            onOpenVerification={(bId) => {
              setActiveBillId(bId);
              navigateTo('verification');
            }}
          />
        )}

        {currentScreen === 'manual_builder' && (
          <ManualBillBuilderScreen
            billId={activeBillId}
            onBack={goToHome}
            onProceedToSummary={(bId) => {
              setActiveBillId(bId);
              setHistory(['home']);
              setCurrentScreen('summary');
            }}
          />
        )}

        {currentScreen === 'payment' && (
          <SplitPaymentScreen
            billId={activeBillId}
            participantId={activeParticipantId}
            onBack={goBack}
            onPaymentSuccess={() => {
              setHistory([isGuestSession ? 'guest_claim' : 'home']);
              setCurrentScreen('summary');
            }}
          />
        )}

        {currentScreen === 'summary' && (
          <SessionSummaryScreen
            billId={activeBillId}
            isGuest={isGuestSession}
            onBack={goToHome}
            onItemizeAgain={(targetBillId) => {
              if (isGuestSession) {
                setHistory([]);
                setCurrentScreen('guest_claim');
                return;
              }
              const currentBill = bills.find((b) => b.id === (targetBillId || activeBillId));
              const isManualBill =
                Boolean(currentBill?.isManual) ||
                (!currentBill?.items || currentBill.items.length === 0);

              setHistory(['home']);
              if (isManualBill) {
                setCurrentScreen('manual_builder');
              } else {
                setCurrentScreen('itemizer');
              }
            }}
          />
        )}

        {currentScreen === 'guest_claim' && (
          <GuestClaimScreen
            billId={activeBillId}
            initialParticipantId={activeParticipantId}
            onProceedToPayment={(bId, pId) => {
              setActiveBillId(bId);
              setActiveParticipantId(pId);
              setActiveBill(bId);
              navigateTo('payment');
            }}
            onBackToApp={
              Platform.OS !== 'web' && isAuthenticated
                ? () => navigateTo('home')
                : undefined
            }
          />
        )}

        {currentScreen === 'auth' && (
          <AuthScreen
            onBack={goBack}
            onSuccess={() => {
              setHistory(['home']);
              setCurrentScreen('home');
            }}
          />
        )}
      </View>

      {/* Samsung One UI Bottom Navigation Bar */}
      {isBottomNavVisible && (
        <OneUIBottomNav
          activeTab={activeTab}
          onTabChange={handleTabChange}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  screenContent: {
    flex: 1,
  },
});
