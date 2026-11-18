import { Platform, NativeModules } from 'react-native';
import Constants from 'expo-constants';
import { ENV } from '../../config/env';
import { BillSession, Participant, LineItem } from '../../types/bill';
import { SupportedLanguage } from '../../i18n/translations';

/**
 * Universal Links, Web Sharing & App Links Service for Quota.
 * Allows diners and friends to view and settle bills instantly in the browser or mobile app.
 * Encodes bill snapshots so links are self-contained and immediately loadable on any browser.
 */
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function toBase64Url(str: string): string {
  try {
    const utf8Bytes: number[] = [];
    for (let i = 0; i < str.length; i++) {
      let charCode = str.charCodeAt(i);
      if (charCode < 0x80) {
        utf8Bytes.push(charCode);
      } else if (charCode < 0x800) {
        utf8Bytes.push(0xc0 | (charCode >> 6), 0x80 | (charCode & 0x3f));
      } else if (charCode < 0xd800 || charCode >= 0xe000) {
        utf8Bytes.push(
          0xe0 | (charCode >> 12),
          0x80 | ((charCode >> 6) & 0x3f),
          0x80 | (charCode & 0x3f)
        );
      } else {
        i++;
        charCode = 0x10000 + (((charCode & 0x3ff) << 10) | (str.charCodeAt(i) & 0x3ff));
        utf8Bytes.push(
          0xf0 | (charCode >> 18),
          0x80 | ((charCode >> 12) & 0x3f),
          0x80 | ((charCode >> 6) & 0x3f),
          0x80 | (charCode & 0x3f)
        );
      }
    }

    let result = '';
    let i = 0;
    while (i < utf8Bytes.length) {
      const b1 = utf8Bytes[i++];
      const b2 = i < utf8Bytes.length ? utf8Bytes[i++] : NaN;
      const b3 = i < utf8Bytes.length ? utf8Bytes[i++] : NaN;

      result += BASE64_CHARS[b1 >> 2];
      result += BASE64_CHARS[((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4)];
      if (!isNaN(b2)) {
        result += BASE64_CHARS[((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6)];
      }
      if (!isNaN(b3)) {
        result += BASE64_CHARS[b3 & 63];
      }
    }
    return result;
  } catch {
    return encodeURIComponent(str);
  }
}

export function fromBase64Url(str: string): string {
  try {
    const chars = BASE64_CHARS;
    const bytes: number[] = [];
    let buffer = 0;
    let bits = 0;

    for (let i = 0; i < str.length; i++) {
      const val = chars.indexOf(str.charAt(i));
      if (val === -1) continue;
      buffer = (buffer << 6) | val;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((buffer >> bits) & 0xff);
      }
    }

    let result = '';
    let i = 0;
    while (i < bytes.length) {
      const b1 = bytes[i++];
      if (b1 < 0x80) {
        result += String.fromCharCode(b1);
      } else if (b1 > 0xbf && b1 < 0xe0) {
        const b2 = bytes[i++];
        result += String.fromCharCode(((b1 & 0x1f) << 6) | (b2 & 0x3f));
      } else if (b1 > 0xdf && b1 < 0xf0) {
        const b2 = bytes[i++];
        const b3 = bytes[i++];
        result += String.fromCharCode(((b1 & 0x0f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f));
      } else {
        const b2 = bytes[i++];
        const b3 = bytes[i++];
        const b4 = bytes[i++];
        const cp =
          (((b1 & 0x07) << 18) | ((b2 & 0x3f) << 12) | ((b3 & 0x3f) << 6) | (b4 & 0x3f)) -
          0x10000;
        result += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
      }
    }
    return result;
  } catch {
    return str;
  }
}

export class DeepLinkService {
  /**
   * Compresses essential bill session fields into an ultra-compact Base64URL string.
   * Strips local device paths and redundant fields for lightweight sharing.
   */
  public static encodeBillData(bill: BillSession): string {
    try {
      const isRemoteImg =
        bill.receiptImageUrl &&
        (bill.receiptImageUrl.startsWith('http://') || bill.receiptImageUrl.startsWith('https://'));

      const compact = {
        v: 2,
        id: bill.id.replace(/^bill_/, ''),
        r: bill.restaurantName,
        cur: bill.currency || 'EUR',
        sm: bill.splitMode === 'even' ? 'e' : 'i',
        mt: bill.manualTotalAmount || bill.taxSummary?.grandTotal || 0,
        cp: bill.copertoPerPerson || 0,
        tp: bill.tipPercentage || 0,
        ...(bill.tipCustomAmount && bill.tipCustomAmount > 0 ? { tc: bill.tipCustomAmount } : {}),
        ...(isRemoteImg ? { img: bill.receiptImageUrl } : {}),
        ...(bill.organizerIban ? { ib: bill.organizerIban } : {}),
        ...(bill.organizerBankName ? { bn: bill.organizerBankName } : {}),
        ...(bill.organizerAccountHolder ? { ah: bill.organizerAccountHolder } : {}),
        p: bill.participants.map((p) => {
          const isOrg = Boolean(p.isOrganizer || p.id === bill.organizerId || p.id === 'user_me');
          let orgShare = p.paidAmount || 0;
          if (isOrg && orgShare <= 0) {
            let sub = 0;
            let hasClaim = false;
            bill.items.forEach((it) => {
              if (it.isCoperto) return;
              const q =
                it.claimedQuantities?.[p.id] ??
                it.claimedQuantities?.[bill.organizerId || 'user_me'] ??
                it.claimedQuantities?.['user_me'] ??
                (it.assignedParticipantIds?.includes(p.id) ||
                it.assignedParticipantIds?.includes(bill.organizerId || 'user_me') ||
                it.assignedParticipantIds?.includes('user_me')
                  ? 1
                  : 0);
              if (q > 0) {
                hasClaim = true;
                sub += q * it.unitPrice;
              }
            });
            if (hasClaim && bill.items.some((it) => it.isCoperto)) {
              sub += bill.copertoPerPerson || 0;
            }
            orgShare = Math.round(sub * 100) / 100;
          }
          return [
            p.name,
            isOrg ? 1 : 0,
            isOrg ? (p.status === 'paid' || orgShare > 0 ? 1 : 0) : (p.status === 'paid' ? 1 : 0),
            orgShare,
          ];
        }),
        it: bill.items.map((it) => {
          const orgP = bill.participants.find(
            (p) => p.isOrganizer || p.id === bill.organizerId || p.id === 'user_me'
          );
          const orgClaimed =
            (orgP ? it.claimedQuantities?.[orgP.id] : undefined) ??
            it.claimedQuantities?.[bill.organizerId || 'user_me'] ??
            it.claimedQuantities?.['user_me'] ??
            ((orgP && it.assignedParticipantIds?.includes(orgP.id)) ||
            it.assignedParticipantIds?.includes(bill.organizerId || 'user_me') ||
            it.assignedParticipantIds?.includes('user_me')
              ? 1
              : 0);
          return [
            it.name,
            it.quantity,
            it.unitPrice,
            it.isCoperto ? 1 : 0,
            orgClaimed,
          ];
        }),
      };

      return toBase64Url(JSON.stringify(compact));
    } catch {
      return '';
    }
  }

  /**
   * Restores a full BillSession from an encoded URL data string (supports Base64URL and legacy JSON).
   */
  public static decodeBillData(dataStr: string): BillSession | null {
    try {
      if (!dataStr) return null;
      let raw: any = null;

      // 1. Try Base64Url decoding first
      if (!dataStr.startsWith('{') && !dataStr.startsWith('%7B') && !dataStr.startsWith('%7b')) {
        try {
          const decodedStr = fromBase64Url(dataStr);
          raw = JSON.parse(decodedStr);
        } catch {}
      }

      // 2. Fallback to raw JSON or percent-encoded JSON
      if (!raw) {
        let rawJson = dataStr;
        if (rawJson.startsWith('%7B') || rawJson.startsWith('%7b')) {
          try {
            rawJson = decodeURIComponent(rawJson);
          } catch {}
        }
        try {
          raw = JSON.parse(rawJson);
        } catch {
          try {
            raw = JSON.parse(decodeURIComponent(dataStr));
          } catch {
            return null;
          }
        }
      }

      if (!raw) return null;

      // Handle v2 ultra-compact array format
      if (raw.v === 2) {
        const rawId = raw.id || raw.i || raw.billId || '';
        const fullId = rawId
          ? String(rawId).startsWith('bill_')
            ? String(rawId)
            : `bill_${rawId}`
          : `bill_${Date.now()}`;
        const organizerParticipant: Participant = {
          id: 'user_me',
          name: (raw.p && raw.p[0] && raw.p[0][0]) || 'You (Organizer)',
          isOrganizer: true,
          status: raw.p && raw.p[0] && raw.p[0][2] === 1 ? 'paid' : 'pending',
          paidAmount: (raw.p && raw.p[0] && raw.p[0][3]) || 0,
          paymentMethod: 'card',
        };

        const participants: Participant[] = [organizerParticipant];
        if (Array.isArray(raw.p)) {
          raw.p.slice(1).forEach((pArr: any, idx: number) => {
            participants.push({
              id: `part_${idx + 1}`,
              name: pArr[0] || `Guest ${idx + 1}`,
              isOrganizer: Boolean(pArr[1]),
              status: pArr[2] === 1 ? 'paid' : 'pending',
              paidAmount: pArr[3] || 0,
            });
          });
        }

        let runningSubtotal = 0;
        let runningCopertoTotal = 0;
        let runningOrgSubtotal = 0;
        let orgHasClaimed = false;

        const items: LineItem[] = (raw.it || []).map((arr: any, idx: number) => {
          const name = String(arr[0]);
          const quantity = Number(arr[1]) || 1;
          const unitPrice = Number(arr[2]) || 0;
          const isCoperto = Boolean(arr[3]);
          const orgClaimed = Number(arr[4]) || 0;
          const totalPrice = Math.round(quantity * unitPrice * 100) / 100;

          if (isCoperto) {
            runningCopertoTotal += totalPrice;
          } else {
            runningSubtotal += totalPrice;
            if (orgClaimed > 0) {
              orgHasClaimed = true;
              runningOrgSubtotal += orgClaimed * unitPrice;
            }
          }

          const assigned = orgClaimed > 0 ? ['user_me'] : [];
          const claimedMap = orgClaimed > 0 ? { user_me: orgClaimed } : {};

          return {
            id: `item_${fullId}_${idx}`,
            name,
            rawText: name,
            quantity,
            unitPrice,
            totalPrice,
            vatRate: 10,
            isCoperto,
            assignedParticipantIds: assigned,
            claimedQuantities: claimedMap,
          };
        });

        const resolvedCopertoPerPerson =
          raw.cp !== undefined
            ? Number(raw.cp) || 0
            : runningCopertoTotal > 0
            ? runningCopertoTotal
            : 0;
        const computedOrgShare = Math.round(
          (runningOrgSubtotal + (orgHasClaimed && runningCopertoTotal > 0 ? resolvedCopertoPerPerson : 0)) * 100
        ) / 100;
        if ((!organizerParticipant.paidAmount || organizerParticipant.paidAmount <= 0) && computedOrgShare > 0) {
          organizerParticipant.paidAmount = computedOrgShare;
          organizerParticipant.status = 'paid';
        }

        const itemsGrandTotal = Math.round((runningSubtotal + runningCopertoTotal) * 100) / 100;
        const grandTotal =
          itemsGrandTotal > 0 ? itemsGrandTotal : Number(raw.mt) || 0;
        const totalVat = Math.round((grandTotal - grandTotal / 1.1) * 100) / 100;

        const restored: BillSession = {
          id: fullId,
          title: `${raw.r || 'Restaurant'}`,
          restaurantName: raw.r || 'Restaurant',
          createdAt: new Date().toISOString(),
          currency: raw.cur || 'EUR',
          status: 'collecting',
          organizerId: 'user_me',
          splitMode: raw.sm === 'e' ? 'even' : 'by_item',
          manualTotalAmount: raw.mt !== undefined ? Number(raw.mt) : grandTotal,
          copertoPerPerson:
            raw.cp !== undefined
              ? raw.cp
              : runningCopertoTotal > 0
              ? runningCopertoTotal
              : 0,
          tipPercentage: raw.tp || 0,
          tipCustomAmount: raw.tc || undefined,
          receiptImageUrl: raw.img,
          organizerIban: raw.ib || undefined,
          organizerBankName: raw.bn || undefined,
          organizerAccountHolder: raw.ah || undefined,
          participants,
          items,
          taxSummary: {
            subtotal: runningSubtotal > 0 ? runningSubtotal : Math.round((grandTotal / 1.1) * 100) / 100,
            copertoTotal: runningCopertoTotal,
            totalVat,
            grandTotal,
            serviceCharge: 0,
            discount: 0,
          },
        };
        return restored;
      }

      // Legacy v1 format compatibility
      if (raw.id) {
        const restored: BillSession = {
          id: raw.id,
          title: raw.t || 'Table Bill',
          restaurantName: raw.r || 'Restaurant',
          createdAt: new Date().toISOString(),
          currency: raw.c || 'EUR',
          status: raw.st || 'collecting',
          organizerId: raw.o || 'user_me',
          copertoPerPerson: raw.cp !== undefined ? raw.cp : 0,
          tipPercentage: raw.tp !== undefined ? raw.tp : 0,
          receiptImageUrl: raw.img,
          participants: (raw.p || []).map((p: any) => ({
            id: p.i,
            name: p.n,
            isOrganizer: Boolean(p.o),
            status: p.s || 'pending',
            paidAmount: p.a || 0,
            paymentMethod: p.m,
          })),
          items: (raw.items || []).map((it: any) => ({
            id: it.i,
            name: it.n,
            rawText: it.n,
            quantity: it.q,
            unitPrice: it.u,
            totalPrice: it.t,
            vatRate: 10,
            isCoperto: Boolean(it.c),
            assignedParticipantIds: it.p || [],
            claimedQuantities: it.cq || {},
          })),
          taxSummary: {
            subtotal: raw.tax?.s || 0,
            copertoTotal: raw.tax?.c || 0,
            totalVat: raw.tax?.v || 0,
            grandTotal: raw.tax?.g || 0,
            serviceCharge: raw.tax?.sc || 0,
            discount: raw.tax?.d || 0,
          },
        };
        return restored;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Resolves the local Wi-Fi development origin using a proper domain hostname
   * (e.g. http://desktop-v1197o1.fritz.box:8081) so messaging apps (WhatsApp, Telegram,
   * SMS, Notes) recognize the pasted URL as a clickable hyperlink while phones on the
   * same Wi-Fi resolve it directly to the PC.
   */
  public static getLanDevOrigin(): string {
    // 1. If a public AWS / cloud proxy server is configured (EXPO_PUBLIC_AI_PROXY_URL),
    // route shared guest links directly to the AWS server (using direct IPv4 or domain
    // to avoid router DNS search-domain hijacking on .sslip.io and browser HTTPS auto-upgrade on port 80).
    if (ENV.AI_PROXY_URL && ENV.AI_PROXY_URL.trim().length > 0) {
      try {
        const parsedCloud = new URL(ENV.AI_PROXY_URL.trim());
        const host = parsedCloud.hostname;
        const portSuffix = parsedCloud.port ? `:${parsedCloud.port}` : '';
        return `${parsedCloud.protocol}//${host}${portSuffix}`;
      } catch {
        // fallback below
      }
    }

    const lanDomainHost = ENV.LOCAL_DEV_HOST || 'desktop-v1197o1.fritz.box';
    const lanIp = ENV.LOCAL_DEV_IP || '192.168.178.114';
    const defaultPort = ENV.LOCAL_DEV_PORT || '8081';

    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location) {
      const hostname = window.location.hostname || '';
      const port = window.location.port || defaultPort;
      const protocol = window.location.protocol || 'http:';

      // If accessed via a real domain name (not localhost and not a raw IPv4 address), keep it
      const isRawIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
      if (hostname && hostname !== 'localhost' && hostname !== '127.0.0.1' && !isRawIp) {
        return `${protocol}//${hostname}${port ? `:${port}` : ''}`;
      }

      // Replace localhost or raw IP with the local network domain (.fritz.box) so pasted links are clickable URLs
      return `${protocol}//${lanDomainHost}:${port}`;
    }

    // On native mobile (Android / iOS), inspect the live Expo Metro port if available,
    // and map raw IP 192.168.178.114 to desktop-v1197o1.fritz.box so pasted links have a valid TLD (.box)
    try {
      const hostUri: string | undefined =
        Constants.expoConfig?.hostUri ||
        (Constants as any).manifest2?.extra?.expoClient?.hostUri ||
        (Constants as any).manifest?.debuggerHost;

      if (hostUri && typeof hostUri === 'string') {
        const cleanHostUri = hostUri.replace(/^https?:\/\//, '').split('/')[0];
        const [hostPart, portPart] = cleanHostUri.split(':');
        if (
          hostPart &&
          hostPart !== 'localhost' &&
          hostPart !== '127.0.0.1' &&
          !hostPart.endsWith('.exp.direct')
        ) {
          const resolvedHost =
            hostPart === lanIp || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostPart)
              ? lanDomainHost
              : hostPart;
          return `http://${resolvedHost}:${portPart || defaultPort}`;
        }
      }

      const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
      if (scriptURL && typeof scriptURL === 'string') {
        const match = scriptURL.match(/^https?:\/\/([^/:]+)(?::(\d+))?/);
        if (
          match &&
          match[1] &&
          match[1] !== 'localhost' &&
          match[1] !== '127.0.0.1' &&
          !match[1].endsWith('.exp.direct')
        ) {
          const resolvedHost =
            match[1] === lanIp || /^\d{1,3}(\.\d{1,3}){3}$/.test(match[1])
              ? lanDomainHost
              : match[1];
          return `http://${resolvedHost}:${match[2] || defaultPort}`;
        }
      }
    } catch {}

    return `http://${lanDomainHost}:${defaultPort}`;
  }

  /**
   * Generates public guest link in standard format: https://quota-pay.com/pay/[splitId]
   */
  public static getPublicPayUrl(splitId: string): string {
    return `https://quota-pay.com/pay/${splitId}`;
  }

  /**
   * Generates a clean, short web link for sharing the bill session.
   * Uses the PC's local Wi-Fi IP so other phones on the Wi-Fi can access it.
   * Strips the heavy encoded payload since Supabase cloud sync provides living state.
   */
  public static getUniversalLink(
    billOrId: string | BillSession,
    participantId?: string
  ): string {
    const isObject = typeof billOrId !== 'string';
    const billId = isObject ? billOrId.id : billOrId;
    const origin = DeepLinkService.getLanDevOrigin();

    let baseUrl = `${origin}/?bill=${billId}`;
    if (participantId) {
      return `${baseUrl}&claim=${participantId}`;
    }
    return baseUrl;
  }

  /**
   * Generates local browser development link: e.g. http://192.168.178.114:8081/?bill={billId}
   */
  public static getBrowserDevUrl(
    billOrId: string | BillSession,
    participantId?: string
  ): string {
    return DeepLinkService.getUniversalLink(billOrId, participantId);
  }

  /**
   * Generates custom app URI scheme: quota://bill/{billId}
   */
  public static getAppSchemeUri(billId: string): string {
    return `${ENV.STRIPE_URL_SCHEME}://bill/${billId}`;
  }

  /**
   * Parses incoming URL from web query parameters, cold boot, or deep link.
   * Accepts standard /pay/[splitId] format as well as &d= and legacy query parameters.
   */
  public static parseBillUrl(url: string): {
    billId: string | null;
    claimId: string | null;
    isGuest: boolean;
    billData?: BillSession | null;
    lang?: SupportedLanguage | null;
  } {
    try {
      if (!url) return { billId: null, claimId: null, isGuest: false, billData: null, lang: null };

      // Handle custom scheme: quota://bill/123?claim=456 or quota://pay/split_123
      const cleanUrl = url
        .replace('quota://pay/', 'https://quota-pay.com/pay/')
        .replace('quota://', 'https://quota.eu/');
      const parsed = new URL(cleanUrl);

      // Check path segments /pay/:splitId
      let splitIdFromPath: string | null = null;
      const pathSegments = parsed.pathname.split('/').filter(Boolean);
      const payIndex = pathSegments.indexOf('pay');
      if (payIndex !== -1 && pathSegments[payIndex + 1]) {
        splitIdFromPath = pathSegments[payIndex + 1];
      }

      // Check query parameters ?bill=... or ?billId=... or ?b=...
      let billId =
        parsed.searchParams.get('bill') ||
        parsed.searchParams.get('billId') ||
        parsed.searchParams.get('b');

      // Check path segments /bill/:billId
      if (!billId) {
        const billIndex = pathSegments.indexOf('bill');
        if (billIndex !== -1 && pathSegments[billIndex + 1]) {
          billId = pathSegments[billIndex + 1];
        }
      }

      const claimId =
        parsed.searchParams.get('claim') ||
        parsed.searchParams.get('participant') ||
        parsed.searchParams.get('split') ||
        parsed.searchParams.get('splitId') ||
        splitIdFromPath;

      const mode = parsed.searchParams.get('mode');
      const isOrganizerExplicit = mode === 'host' || mode === 'organizer' || parsed.searchParams.get('role') === 'host';
      const isGuest = !isOrganizerExplicit && (mode === 'guest' || Boolean(claimId) || (!claimId && Boolean(billId)));

      // Check both compact &d= and legacy &data=
      const dataParam = parsed.searchParams.get('d') || parsed.searchParams.get('data');
      const billData = dataParam ? DeepLinkService.decodeBillData(dataParam) : null;

      if (billData) {
        if (billId) {
          billData.id = billId;
        } else {
          billId = billData.id;
        }
      }

      const rawLang = parsed.searchParams.get('lang');
      const lang =
        rawLang && ['en', 'it', 'tr', 'es', 'de', 'fr'].includes(rawLang)
          ? (rawLang as SupportedLanguage)
          : null;

      return { billId, claimId, isGuest, billData, lang };
    } catch {
      return { billId: null, claimId: null, isGuest: false, billData: null, lang: null };
    }
  }

  /**
   * Persists the current browser tab's guest participant ID and screen in `sessionStorage`
   * (isolated per browser tab so multiple guest tabs on the same PC never collide, while
   * surviving page refreshes F5 without throwing the guest back to the name prompt).
   */
  public static saveGuestTabSession(
    billId: string,
    update: { participantId?: string | null; screen?: string }
  ): void {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !billId) return;
    try {
      const key = `quota_tab_guest_${billId}`;
      const existingRaw = window.sessionStorage?.getItem(key);
      const existing = existingRaw ? JSON.parse(existingRaw) : {};
      const next = {
        ...existing,
        ...(update.participantId !== undefined ? { participantId: update.participantId } : {}),
        ...(update.screen !== undefined ? { screen: update.screen } : {}),
        updatedAt: Date.now(),
      };
      window.sessionStorage?.setItem(key, JSON.stringify(next));
    } catch {
      // ignore storage errors
    }
  }

  /**
   * Reads the current browser tab's persisted guest participant ID and screen from `sessionStorage`.
   */
  public static getGuestTabSession(billId: string | null | undefined): {
    participantId: string | null;
    screen: string | null;
  } {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !billId) {
      return { participantId: null, screen: null };
    }
    try {
      const key = `quota_tab_guest_${billId}`;
      const raw = window.sessionStorage?.getItem(key);
      if (!raw) return { participantId: null, screen: null };
      const parsed = JSON.parse(raw);
      return {
        participantId: parsed.participantId || null,
        screen: parsed.screen || null,
      };
    } catch {
      return { participantId: null, screen: null };
    }
  }
}
