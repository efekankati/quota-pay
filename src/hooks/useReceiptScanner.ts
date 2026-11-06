import { useState } from 'react';
import { useHaptics } from './useHaptics';

export function useReceiptScanner(_billId: string) {
  const [isScanning, setIsScanning] = useState(false);
  const [flashMode, setFlashMode] = useState<'off' | 'on'>('off');
  const { lightImpact } = useHaptics();

  const toggleFlash = () => {
    lightImpact();
    setFlashMode((prev) => (prev === 'off' ? 'on' : 'off'));
  };

  return {
    isScanning,
    flashMode,
    toggleFlash,
    setIsScanning,
  };
}
