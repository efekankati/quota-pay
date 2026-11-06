import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ENV } from '../../config/env';

/**
 * Sanitizes the Supabase URL, auto-correcting any typos like supbase.com -> supabase.co
 */
export const getCleanSupabaseUrl = (): string => {
  let url = (ENV.SUPABASE_URL || '').trim();
  if (url.includes('supbase.com')) {
    url = url.replace('supbase.com', 'supabase.co');
  }
  return url;
};

/**
 * Checks whether valid Supabase credentials have been configured.
 */
export const isSupabaseConfigured = (): boolean => {
  const url = getCleanSupabaseUrl();
  return Boolean(
    url &&
    url.startsWith('http') &&
    ENV.SUPABASE_ANON_KEY &&
    ENV.SUPABASE_ANON_KEY.length > 10
  );
};

const GLOBAL_SUPABASE_KEY = '__quotaSupabaseClient__' as const;

type GlobalWithSupabase = typeof globalThis & {
  [GLOBAL_SUPABASE_KEY]?: SupabaseClient | null;
};

let clientInstance: SupabaseClient | null =
  (globalThis as GlobalWithSupabase)[GLOBAL_SUPABASE_KEY] ?? null;

/**
 * Returns the singleton Supabase client instance if configured, or null in offline/mock mode.
 * Cached on `globalThis` so HMR / Fast Refresh or multiple bundle evaluations in the browser
 * never instantiate multiple GoTrueClient instances under the same storage key.
 */
export const getSupabaseClient = (): SupabaseClient | null => {
  const globalScope = globalThis as GlobalWithSupabase;

  if (clientInstance) {
    return clientInstance;
  }

  if (globalScope[GLOBAL_SUPABASE_KEY]) {
    clientInstance = globalScope[GLOBAL_SUPABASE_KEY]!;
    return clientInstance;
  }

  if (isSupabaseConfigured()) {
    try {
      const sanitizedUrl = getCleanSupabaseUrl();
      clientInstance = createClient(sanitizedUrl, ENV.SUPABASE_ANON_KEY, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      });
      globalScope[GLOBAL_SUPABASE_KEY] = clientInstance;
      return clientInstance;
    } catch (err) {
      console.warn('[Supabase] Failed to initialize client:', err);
      return null;
    }
  }

  return null;
};

export const supabase = getSupabaseClient();
