import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera,
  Flashlight,
  FlashlightOff,
  Settings,
  ImageIcon,
} from 'lucide-react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useLanguageStore } from '../store/useLanguageStore';
import { Header } from '../components/common/Header';
import { BoundingBoxView } from '../components/scanner/BoundingBoxView';
import { CameraOverlay } from '../components/scanner/CameraOverlay';
import { ScanningOverlayHUD } from '../components/scanner/ScanningOverlayHUD';
import { useReceiptScanner } from '../hooks/useReceiptScanner';
import { useBillStore } from '../store/useBillStore';
import { useAuthStore } from '../store/useAuthStore';
import { showAppAlert } from '../store/useAlertStore';
import { useHaptics } from '../hooks/useHaptics';
import { GeminiReceiptService } from '../services/ai/GeminiReceiptService';
import { SoundService } from '../services/audio/SoundService';
import { RADIUS, SPACING, TYPOGRAPHY } from '../config/theme';

interface ScannerScreenProps {
  onBack: () => void;
  onProceedToItemizer?: (billId: string) => void;
  onProceedToVerification: (billId: string) => void;
}

export const ScannerScreen: React.FC<ScannerScreenProps> = ({
  onBack,
  onProceedToItemizer,
  onProceedToVerification,
}) => {
  const { colors } = useThemeStore();
  const { t } = useLanguageStore();
  const { createBill, setItems, updateBillMetadata, deleteBill } = useBillStore();
  const { user } = useAuthStore();
  const { heavyImpact, lightImpact, successNotification } = useHaptics();

  // Camera reference & permissions
  const cameraRef = useRef<CameraView>(null);
  const [permission, requestPermission] = useCameraPermissions();

  // State: bill is only instantiated if an image is actually taken and parsed
  const [billId, setBillId] = useState<string>('');
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [isAnalysisComplete, setIsAnalysisComplete] = useState(false);
  const [pendingBillId, setPendingBillId] = useState<string | null>(null);
  const activeBillIdRef = useRef<string>('');

  const handleBack = () => {
    lightImpact();
    // Guarantee no empty draft bill is left behind if user leaves camera screen
    if (pendingBillId) {
      deleteBill(pendingBillId);
      setPendingBillId(null);
    }
    if (billId) {
      deleteBill(billId);
      setBillId('');
    }
    onBack();
  };

  const {
    isScanning,
    flashMode,
    toggleFlash,
  } = useReceiptScanner(billId || 'temp_bill');

  const handleRequestPermission = async () => {
    lightImpact();
    try {
      const res = await requestPermission();
      if (!res?.granted && res?.canAskAgain === false) {
        showAppAlert(
          t('cameraPermDeniedTitle'),
          t('cameraPermDeniedDesc'),
          [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('openSettings'),
              onPress: () => {
                Linking.openSettings();
              },
            },
          ],
          'warning'
        );
      }
    } catch (err) {
      console.warn('Camera permission request error:', err);
    }
  };

  /**
   * Process a captured or selected base64 receipt photo via Google Gemini AI
   */
  const processImageWithGemini = async (base64Image: string, photoUri?: string) => {
    let createdBillId: string | null = null;
    try {
      setIsAiAnalyzing(true);
      setIsAnalysisComplete(false);

      const parsed = await GeminiReceiptService.parseReceipt(base64Image, 'image/jpeg');

      // Convert items to strongly typed Quota LineItems
      const lineItems = GeminiReceiptService.toLineItems(parsed);

      if (!lineItems || lineItems.length === 0) {
        throw new Error(t('noItemsInReceipt'));
      }

      // Create the bill session only now that we have real, parsed receipt items
      const effectiveBillId = createBill(
        parsed.restaurantName ? `Bill: ${parsed.restaurantName}` : 'New Restaurant Bill',
        parsed.restaurantName || 'Restaurant',
        {
          id: user?.id || 'user_me',
          name: user?.fullName || 'You (Organizer)',
          isOrganizer: true,
          status: 'pending',
        },
        {
          currency: parsed.currency || 'EUR',
          initialAmount: parsed.total,
          initialItems: lineItems,
          copertoTotal: parsed.copertoTotal,
          grandTotal: parsed.total,
        }
      );
      createdBillId = effectiveBillId;
      activeBillIdRef.current = effectiveBillId;

      setBillId(effectiveBillId);
      setPendingBillId(effectiveBillId);

      // Populate items and active bill metadata
      setItems(effectiveBillId, lineItems, parsed.copertoTotal, parsed.total);
      updateBillMetadata(effectiveBillId, {
        restaurantName: parsed.restaurantName,
        title: `Bill: ${parsed.restaurantName}`,
        receiptImageUrl: photoUri,
      });

      // Signal completion to the progress steps overlay
      setIsAnalysisComplete(true);
    } catch (err: any) {
      setIsAiAnalyzing(false);
      setIsAnalysisComplete(false);
      if (createdBillId) {
        deleteBill(createdBillId);
      }
      if (billId) {
        deleteBill(billId);
      }
      setBillId('');
      setPendingBillId(null);
      console.error('Gemini OCR parsing error:', err);

      const errorMessage =
        err?.message ||
        'Impossibile analizzare lo scontrino con Gemini AI. Verifica la chiave API o la connessione.';

      showAppAlert(
        t('aiErrorTitle'),
        errorMessage,
        [
          {
            text: t('cancel'),
            style: 'cancel',
          },
          {
            text: t('pickFromGallery'),
            onPress: handlePickFromGallery,
          },
        ],
        'warning'
      );
    }
  };

  /**
   * Snaps a photo from the live camera and analyzes it with Gemini AI
   */
  const handleCapture = async () => {
    lightImpact();
    SoundService.playSoftShutterSound();

    try {
      setIsAiAnalyzing(true);
      let capturedBase64 = '';
      let capturedUri = '';

      if (cameraRef.current) {
        const photo = await cameraRef.current.takePictureAsync({
          base64: true,
          quality: 0.85,
          shutterSound: false,
        });

        if (photo?.base64) {
          capturedBase64 = photo.base64;
          capturedUri = photo.uri;
        }
      }

      if (!capturedBase64) {
        setIsAiAnalyzing(false);
        showAppAlert(
          t('captureFailedTitle'),
          t('captureFailedDesc'),
          [
            { text: t('cancel'), style: 'cancel' },
            {
              text: t('pickFromGallery'),
              onPress: handlePickFromGallery,
            },
          ],
          'warning'
        );
        return;
      }

      await processImageWithGemini(capturedBase64, capturedUri);
    } catch (err: any) {
      setIsAiAnalyzing(false);
      console.warn('Take picture error:', err);
      showAppAlert(
        t('captureFailedTitle'),
        err?.message || t('captureFailedDesc'),
        [
          { text: t('cancel'), style: 'cancel' },
          { text: t('pickFromGallery'), onPress: handlePickFromGallery },
        ],
        'warning'
      );
    }
  };

  /**
   * Pick photo from device gallery and parse via Gemini AI
   */
  const handlePickFromGallery = async () => {
    lightImpact();

    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        base64: true,
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        if (asset.base64) {
          await processImageWithGemini(asset.base64, asset.uri);
        } else {
          showAppAlert(
            t('aiErrorTitle'),
            'Impossibile leggere l\'immagine selezionata in base64.',
            [{ text: 'OK' }],
            'warning'
          );
        }
      }
    } catch (err: any) {
      console.error('Gallery picker error:', err);
      showAppAlert(
        t('aiErrorTitle'),
        err?.message || 'Errore durante la selezione della foto.',
        [{ text: 'OK' }],
        'warning'
      );
    }
  };

  const isPermissionGranted = !!permission?.granted;

  return (
    <View style={styles.container}>
      {/* Real Live Camera View or Permission Prompt */}
      {!permission ? (
        <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      ) : !isPermissionGranted ? (
        <View style={[styles.permissionContainer, { backgroundColor: '#0B0F17' }]}>
          <View style={[styles.permCard, { backgroundColor: '#131B28', borderColor: 'rgba(255,255,255,0.08)' }]}>
            <View style={[styles.permIconCircle, { backgroundColor: colors.accentLight }]}>
              <Camera size={38} color={colors.accent} />
            </View>
            <Text style={[styles.permTitle, { color: '#FFFFFF' }]}>
              {t('scanReceiptTitle')}
            </Text>
            <Text style={[styles.permSubtitle, { color: '#94A3B8' }]}>
              {t('cameraPermissionDesc')}
            </Text>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={handleRequestPermission}
              style={[styles.grantBtn, { backgroundColor: colors.accent }]}
            >
              <Text style={styles.grantBtnText}>{t('enableCameraBtn')}</Text>
            </TouchableOpacity>

            {permission.canAskAgain === false && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => Linking.openSettings()}
                style={[styles.settingsBtn, { borderColor: 'rgba(255,255,255,0.15)' }]}
              >
                <Settings size={16} color="#FFFFFF" />
                <Text style={styles.settingsBtnText}>
                  {t('openSettings')}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={handlePickFromGallery}
              style={styles.galleryFallbackBtn}
            >
              <ImageIcon size={16} color="#FFFFFF" />
              <Text style={styles.galleryFallbackText}>
                {t('pickFromGallery')}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <>
          <CameraView
            ref={cameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            enableTorch={flashMode === 'on'}
          />

          {/* Viewfinder Bounding Box */}
          <View style={styles.viewfinderArea} pointerEvents="box-none">
            <BoundingBoxView isScanning={isAiAnalyzing || isScanning} />
          </View>

          {/* Bottom Camera Interactive Controls (Gallery, Shutter, Flash) */}
          <CameraOverlay
            flashMode={flashMode}
            onToggleFlash={toggleFlash}
            onCapture={handleCapture}
            onPickImage={handlePickFromGallery}
            isScanning={isAiAnalyzing || isScanning}
          />
        </>
      )}

      {/* Header with back button, language selector, and top controls */}
      <View style={styles.headerAbsoluteWrapper} pointerEvents="box-none">
        <Header
          title={t('scanReceiptTitle')}
          showBack
          onBack={handleBack}
          hideThemeToggle
          rightAction={
            <View style={styles.headerRightActions}>
              {/* Flash Toggle */}
              {isPermissionGranted && (
                <TouchableOpacity
                  onPress={() => {
                    lightImpact();
                    toggleFlash();
                  }}
                  style={[
                    styles.headerActionBtn,
                    {
                      backgroundColor: flashMode === 'on' ? colors.accent : 'rgba(0,0,0,0.6)',
                      borderColor: flashMode === 'on' ? colors.accent : 'rgba(255,255,255,0.2)',
                    },
                  ]}
                  accessibilityLabel="Flash"
                >
                  {flashMode === 'on' ? (
                    <Flashlight size={18} color="#000000" />
                  ) : (
                    <FlashlightOff size={18} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              )}
            </View>
          }
        />
      </View>

      {/* Neo-Fintech Receipt Processing Progress Steps & Bars HUD */}
      <ScanningOverlayHUD
        isScanning={isAiAnalyzing}
        isComplete={isAnalysisComplete}
        onFinishedAnimation={() => {
          const targetBillId = activeBillIdRef.current || pendingBillId || billId;
          setIsAiAnalyzing(false);
          setIsAnalysisComplete(false);
          if (targetBillId) {
            onProceedToVerification(targetBillId);
          }
        }}
        onCancel={() => {
          if (pendingBillId) {
            deleteBill(pendingBillId);
            setPendingBillId(null);
          }
          if (billId) {
            deleteBill(billId);
            setBillId('');
          }
          setIsAiAnalyzing(false);
          setIsAnalysisComplete(false);
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  headerAbsoluteWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewfinderArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerActionBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  headerKeyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 38,
    paddingHorizontal: SPACING.sm + 2,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  headerKeyText: {
    fontSize: 11,
    fontWeight: '800',
  },
  permissionContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    paddingTop: 100,
  },
  permCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    padding: SPACING.xl,
    alignItems: 'center',
  },
  permIconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.lg,
  },
  permTitle: {
    ...TYPOGRAPHY.titleLarge,
    fontWeight: '800',
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  permSubtitle: {
    ...TYPOGRAPHY.bodyMedium,
    textAlign: 'center',
    marginBottom: SPACING.xl,
    lineHeight: 22,
    paddingHorizontal: SPACING.sm,
  },
  grantBtn: {
    width: '100%',
    paddingVertical: SPACING.md + 2,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: SPACING.md,
  },
  grantBtnText: {
    color: '#000000',
    fontSize: 16,
    fontWeight: '800',
  },
  settingsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    width: '100%',
    paddingVertical: SPACING.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginBottom: SPACING.md,
  },
  settingsBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  galleryFallbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.md,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginBottom: SPACING.xs,
  },
  galleryFallbackText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
});
