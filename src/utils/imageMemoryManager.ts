import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

const activeBlobUrls = new Set<string>();

/**
 * Converts a raw Base64 payload or `data:image/...;base64,...` string into a browser
 * `Blob` Object URL (`URL.createObjectURL`) so multi-megabyte image buffers are never
 * held as UTF-16 strings inside React state or Zustand stores.
 */
export function base64ToBlobUrl(
  base64OrUri: string,
  fallbackMimeType: string = 'image/jpeg'
): string {
  if (!base64OrUri) return '';

  // Already a lightweight object URL, native file:// URI, or remote http(s):// URL
  if (
    base64OrUri.startsWith('blob:') ||
    base64OrUri.startsWith('file:') ||
    base64OrUri.startsWith('content:') ||
    base64OrUri.startsWith('ph:') ||
    ((base64OrUri.startsWith('http://') || base64OrUri.startsWith('https://')) &&
      base64OrUri.length < 2048)
  ) {
    return base64OrUri;
  }

  if (
    Platform.OS !== 'web' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function' ||
    typeof Blob === 'undefined' ||
    typeof atob !== 'function'
  ) {
    // On native iOS/Android, never keep raw multi-MB base64 if a file:// URI wasn't provided
    return base64OrUri.startsWith('data:') ? '' : base64OrUri;
  }

  try {
    let mimeType = fallbackMimeType;
    let rawBase64 = base64OrUri;

    const match = base64OrUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (match) {
      mimeType = match[1];
      rawBase64 = match[2];
    } else {
      rawBase64 = base64OrUri.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '').trim();
    }

    const binaryString = atob(rawBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: mimeType });
    const objectUrl = URL.createObjectURL(blob);
    activeBlobUrls.add(objectUrl);
    return objectUrl;
  } catch {
    return '';
  }
}

/**
 * Immediately revokes a `blob:` Object URL (`URL.revokeObjectURL`) so the browser
 * garbage collector can reclaim the underlying image buffer from heap memory.
 */
export function revokeBlobUrl(url?: string | null): void {
  if (!url || typeof url !== 'string' || !url.startsWith('blob:')) {
    return;
  }
  activeBlobUrls.delete(url);
  if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }
}

/**
 * Revokes all tracked Blob Object URLs created during the current browser tab session.
 */
export function revokeAllTrackedBlobUrls(): void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') {
    activeBlobUrls.clear();
    return;
  }
  activeBlobUrls.forEach((url) => {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  });
  activeBlobUrls.clear();
}

/**
 * Strips inline `data:image/...;base64,...` buffers and ephemeral `blob:` URLs before
 * serializing a BillSession to `localStorage` or Supabase Postgres / WebSocket broadcast.
 */
export function sanitizeReceiptUrlForPersistence(url?: string | null): string | undefined {
  if (!url || typeof url !== 'string') return undefined;
  if (url.startsWith('data:') || url.startsWith('blob:') || url.length > 2048) {
    return undefined;
  }
  return url;
}

/**
 * React hook that ensures any receipt preview image uses an ephemeral `URL.createObjectURL`
 * handle and automatically calls `URL.revokeObjectURL` when the component unmounts or
 * when the image URI changes.
 */
export function useReceiptBlobUrl(sourceUri?: string | null): string | undefined {
  const [resolvedUrl, setResolvedUrl] = useState<string | undefined>(() => {
    if (!sourceUri) return undefined;
    if (sourceUri.startsWith('data:')) {
      return base64ToBlobUrl(sourceUri) || undefined;
    }
    return sourceUri;
  });

  useEffect(() => {
    if (!sourceUri) {
      setResolvedUrl(undefined);
      return;
    }

    let createdObjectUrl: string | null = null;
    if (sourceUri.startsWith('data:')) {
      createdObjectUrl = base64ToBlobUrl(sourceUri);
      setResolvedUrl(createdObjectUrl || undefined);
    } else {
      setResolvedUrl(sourceUri);
    }

    return () => {
      if (createdObjectUrl) {
        revokeBlobUrl(createdObjectUrl);
      }
      if (sourceUri.startsWith('blob:')) {
        revokeBlobUrl(sourceUri);
      }
    };
  }, [sourceUri]);

  return resolvedUrl;
}

if (
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.addEventListener === 'function'
) {
  window.addEventListener('beforeunload', () => {
    revokeAllTrackedBlobUrls();
  });
}

