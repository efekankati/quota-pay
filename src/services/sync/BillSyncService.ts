import { BillSession, LineItem, Participant } from '../../types/bill';
import { getSupabaseClient } from '../supabase/supabaseClient';

class BillSyncServiceImpl {
  private channel: any = null;
  private listeners: Set<(bill: BillSession) => void> = new Set();
  private splitListeners: Map<string, Set<(split: any) => void>> = new Map();
  private lastLocalMutationAt: Map<string, number> = new Map();
  private isChannelReady = false;

  constructor() {
    this.initRealtimeChannel();
  }

  /**
   * Conflict-free multi-guest bill merger (CRDT-style union for 10+ concurrent diners).
   * Ensures that when multiple guests join or claim items sequentially or concurrently:
   * 1. No previously joined guest is ever dropped from `participants`.
   * 2. Once a participant is marked `status === 'paid'`, their payment is never reverted.
   * 3. Claims from newly added participants in `cloudBill` are preserved alongside `localBill` updates.
   */
  public mergeBillSessions(
    cloudBill: BillSession | null,
    localBill: BillSession
  ): BillSession {
    if (!cloudBill || cloudBill.id !== localBill.id) {
      return localBill;
    }

    // 1. Merge participants (preserve all joined guests + preserve any 'paid' status)
    const mergedParticipantsMap = new Map<string, Participant>();

    for (const p of cloudBill.participants || []) {
      mergedParticipantsMap.set(p.id, { ...p });
    }

    for (const localP of localBill.participants || []) {
      // Check if same ID or same guest name already exists in cloudBill
      let existingKey = mergedParticipantsMap.has(localP.id) ? localP.id : null;
      if (!existingKey && !localP.isOrganizer) {
        for (const [k, v] of mergedParticipantsMap.entries()) {
          if (!v.isOrganizer && v.name.trim().toLowerCase() === localP.name.trim().toLowerCase()) {
            existingKey = k;
            break;
          }
        }
      }

      if (existingKey) {
        const cloudP = mergedParticipantsMap.get(existingKey)!;
        const isOrg = Boolean(localP.isOrganizer || cloudP.isOrganizer || existingKey === 'user_me');
        const isPaid = isOrg
          ? Boolean(
              localP.status === 'paid' ||
                cloudP.status === 'paid' ||
                (localP.paidAmount || 0) > 0 ||
                (cloudP.paidAmount || 0) > 0
            )
          : Boolean(cloudP.status === 'paid' || localP.status === 'paid');
        mergedParticipantsMap.set(existingKey, {
          ...cloudP,
          ...localP,
          id: existingKey,
          status: isPaid ? 'paid' : localP.status,
          paidAmount: isOrg
            ? (localP.paidAmount && localP.paidAmount > 0
                ? localP.paidAmount
                : cloudP.paidAmount || localP.paidAmount || 0)
            : (isPaid
                ? Math.max(cloudP.paidAmount || 0, localP.paidAmount || 0)
                : localP.paidAmount),
          paidAt: cloudP.paidAt || localP.paidAt,
          paymentMethod: cloudP.paymentMethod || localP.paymentMethod,
        });
      } else {
        mergedParticipantsMap.set(localP.id, { ...localP });
      }
    }

    const mergedParticipants = Array.from(mergedParticipantsMap.values());

    // 2. Merge includedParticipantIds
    const includedSet = new Set<string>([
      ...(cloudBill.includedParticipantIds || []),
      ...(localBill.includedParticipantIds || []),
      ...mergedParticipants.map((p) => p.id),
    ]);

    // 3. Merge Line Items & Participant Claims
    const localParticipantIds = new Set((localBill.participants || []).map((p) => p.id));
    // Paid guests in cloudBill have locked, immutable item claims
    const paidCloudGuestIds = new Set(
      (cloudBill.participants || [])
        .filter((p) => !p.isOrganizer && p.id !== 'user_me' && p.status === 'paid')
        .map((p) => p.id)
    );
    const baseItems =
      localBill.items && localBill.items.length > 0
        ? localBill.items
        : cloudBill.items || [];

    const cloudItemsById = new Map<string, LineItem>();
    for (const cItem of cloudBill.items || []) {
      cloudItemsById.set(cItem.id, cItem);
    }

    const mergedItems: LineItem[] = baseItems.map((localItem) => {
      if (localItem.isCoperto) {
        return {
          ...localItem,
          assignedParticipantIds: mergedParticipants.map((p) => p.id),
        };
      }

      const cloudItem = cloudItemsById.get(localItem.id);
      if (!cloudItem) return localItem;

      // Start with local claimedQuantities, then retain cloud claims from guests that weren't in localBill yet
      // or guests who have already paid in cloudBill (locked claims)
      const mergedClaimed: Record<string, number> = {
        ...(localItem.claimedQuantities || {}),
      };
      for (const [pId, qty] of Object.entries(cloudItem.claimedQuantities || {})) {
        if ((!localParticipantIds.has(pId) || paidCloudGuestIds.has(pId)) && qty > 0) {
          mergedClaimed[pId] = qty;
        }
      }

      const assignedSet = new Set<string>(localItem.assignedParticipantIds || []);
      for (const pId of cloudItem.assignedParticipantIds || []) {
        if (!localParticipantIds.has(pId) || paidCloudGuestIds.has(pId)) {
          assignedSet.add(pId);
        }
      }
      for (const [pId, qty] of Object.entries(mergedClaimed)) {
        if (qty > 0) assignedSet.add(pId);
      }

      return {
        ...localItem,
        claimedQuantities: mergedClaimed,
        assignedParticipantIds: Array.from(assignedSet),
      };
    });

    // Recalculate copertoPerPerson based on covers or seated participants
    const copertoItem = mergedItems.find((it) => it.isCoperto);
    const coversCount =
      copertoItem && copertoItem.quantity > 0
        ? copertoItem.quantity
        : Math.max(mergedParticipants.length, 1);
    const copertoTotal =
      localBill.taxSummary?.copertoTotal ??
      cloudBill.taxSummary?.copertoTotal ??
      (copertoItem ? copertoItem.totalPrice : 0);
    const copertoPerPerson =
      copertoTotal > 0 ? Math.round((copertoTotal / coversCount) * 100) / 100 : 0;

    return {
      ...cloudBill,
      ...localBill,
      participants: mergedParticipants,
      includedParticipantIds: Array.from(includedSet),
      items: mergedItems,
      copertoPerPerson,
    };
  }

  private notifyListeners(bill: BillSession) {
    this.listeners.forEach((listener) => {
      try {
        listener(bill);
      } catch (err) {
        console.warn('[BillSync] Listener error:', err);
      }
    });
  }

  private initRealtimeChannel() {
    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
      this.channel = supabase.channel('quota_bill_sync', {
        config: {
          broadcast: { self: false },
        },
      });

      this.channel
        // 1. Peer-to-peer low-latency WebSocket broadcast across all open tabs & Expo Go
        .on('broadcast', { event: 'bill_updated' }, (payload: any) => {
          if (payload?.payload?.bill) {
            const bill: BillSession = payload.payload.bill;
            this.notifyListeners(bill);
          }
        })
        // 2. Database-level Postgres Changes on `public.bills` so every committed guest action
        // immediately propagates to all ~10 connected browsers and newcomers
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'bills',
          },
          (payload: any) => {
            try {
              const row = payload?.new;
              if (row && typeof row.title === 'string' && row.title.startsWith('{')) {
                const parsed = JSON.parse(row.title);
                if (parsed?.bill) {
                  const incoming = parsed.bill as BillSession;
                  const lastMutated = this.lastLocalMutationAt.get(incoming.id) || 0;
                  // Ignore self-echo from postgres_changes within 2s of our own local mutation
                  if (Date.now() - lastMutated > 2000) {
                    this.notifyListeners(incoming);
                  }
                }
              }
            } catch {
              // ignore non-JSON title rows
            }
          }
        )
        .subscribe((status: string) => {
          this.isChannelReady = status === 'SUBSCRIBED';
        });
    } catch (err) {
      console.warn('[BillSync] Channel init error:', err);
    }
  }

  /**
   * Broadcasts a bill update in real-time to all connected devices (mobile app & web)
   * and persists a conflict-free merged snapshot to Supabase cloud storage.
   */
  public async broadcastBillUpdate(bill: BillSession): Promise<void> {
    if (!bill || !bill.id) return;
    this.lastLocalMutationAt.set(bill.id, Date.now());

    // 1. Instant Realtime WebSocket Broadcast for sub-50ms UI responsiveness
    try {
      if (this.channel && this.isChannelReady) {
        await this.channel.send({
          type: 'broadcast',
          event: 'bill_updated',
          payload: { bill },
        });
      }
    } catch (err) {
      console.warn('[BillSync] Realtime broadcast error:', err);
    }

    // 2. Cloud Persistence in Supabase with conflict-free multi-guest merge
    this.saveBillToCloud(bill).catch((err) => {
      console.warn('[BillSync] Cloud save error:', err);
    });
  }

  /**
   * Persists a serialized bill session snapshot, merging with any prior guest joins/claims
   * already stored in Supabase so concurrent guests never overwrite each other.
   */
  public async saveBillToCloud(bill: BillSession): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase || !bill || !bill.id) return;

    try {
      // Fetch existing row first so we merge any prior guest actions atomically
      const { data: existing } = await supabase
        .from('bills')
        .select('id, title')
        .ilike('title', `%${bill.id}%`)
        .order('created_at', { ascending: false })
        .limit(1);

      let mergedBill = bill;
      if (existing && existing.length > 0 && existing[0].title) {
        try {
          const parsedExisting = JSON.parse(existing[0].title);
          if (parsedExisting?.bill) {
            mergedBill = this.mergeBillSessions(parsedExisting.bill as BillSession, bill);
          }
        } catch {
          mergedBill = bill;
        }
      }

      const payloadStr = JSON.stringify({ q_id: mergedBill.id, bill: mergedBill });
      const grandTotal =
        mergedBill.taxSummary?.grandTotal || mergedBill.manualTotalAmount || 0;
      const status = mergedBill.status === 'settled' ? 'completed' : 'pending';

      // 1. Persist merged Bill in `bills` table
      if (existing && existing.length > 0) {
        await supabase
          .from('bills')
          .update({
            title: payloadStr,
            total_amount: grandTotal,
            status,
            currency: mergedBill.currency || 'EUR',
          })
          .eq('id', existing[0].id);
      } else {
        await supabase.from('bills').insert({
          title: payloadStr,
          total_amount: grandTotal,
          status,
          currency: mergedBill.currency || 'EUR',
        });
      }

      // Broadcast the canonical merged state if merging added participants from other guests
      if (mergedBill.participants.length > bill.participants.length) {
        this.notifyListeners(mergedBill);
        if (this.channel && this.isChannelReady) {
          await this.channel.send({
            type: 'broadcast',
            event: 'bill_updated',
            payload: { bill: mergedBill },
          });
        }
      }

      // 2. Persist Participant Rows in `bill_splits`
      try {
        const splitsRows = mergedBill.participants.map((p) => {
          const splitId =
            p.splitId ||
            `split_${mergedBill.id.replace(/^bill_/, '')}_${p.id.replace(/^part_/, '')}`;

          let owedAmount = p.paidAmount || 0;
          if (mergedBill.splitMode === 'even') {
            const included =
              mergedBill.includedParticipantIds ||
              mergedBill.participants.map((pt) => pt.id);
            if (included.includes(p.id)) {
              const count = included.length || 1;
              const totalCents = Math.round(grandTotal * 100);
              const base = Math.floor(totalCents / count);
              const rem = totalCents % count;
              const idx = included.indexOf(p.id);
              owedAmount = (base + (idx < rem ? 1 : 0)) / 100;
            } else {
              owedAmount = 0;
            }
          }

          return {
            id: splitId,
            bill_id: mergedBill.id,
            participant_id: p.id,
            participant_name: p.name,
            owed_amount: p.owedAmount !== undefined ? p.owedAmount : owedAmount,
            status: p.status === 'paid' ? 'paid' : 'unpaid',
            payment_method: p.paymentMethod || null,
            paid_at: p.paidAt || null,
          };
        });

        if (splitsRows.length > 0) {
          await supabase.from('bill_splits').upsert(splitsRows, { onConflict: 'id' });
        }
      } catch (errSplits) {
        console.warn('[BillSync] bill_splits upsert notice:', errSplits);
      }

      // 3. Persist Line Items in `bill_items` if itemized
      if (mergedBill.items && mergedBill.items.length > 0) {
        try {
          const itemsRows = mergedBill.items.map((it) => ({
            id: it.id,
            bill_id: mergedBill.id,
            name: it.name,
            quantity: it.quantity,
            unit_price: it.unitPrice,
            total_price: it.totalPrice,
            is_coperto: Boolean(it.isCoperto),
            assigned_participant_ids: it.assignedParticipantIds || [],
          }));
          await supabase.from('bill_items').upsert(itemsRows, { onConflict: 'id' });
        } catch (errItems) {
          console.warn('[BillSync] bill_items upsert notice:', errItems);
        }
      }
    } catch (err) {
      console.warn('[BillSync] saveBillToCloud failed:', err);
    }
  }

  /**
   * Fetches the latest bill session snapshot from the cloud
   */
  public async fetchBillFromCloud(billId: string): Promise<BillSession | null> {
    const supabase = getSupabaseClient();
    if (!supabase || !billId) return null;

    try {
      const { data, error } = await supabase
        .from('bills')
        .select('title')
        .ilike('title', `%${billId}%`)
        .order('created_at', { ascending: false })
        .limit(1);

      if (error || !data || data.length === 0) return null;

      const parsed = JSON.parse(data[0].title);
      return parsed?.bill || null;
    } catch {
      return null;
    }
  }

  /**
   * Fetches a bill associated with a specific participant split ID
   */
  public async fetchBillBySplitId(
    splitId: string
  ): Promise<{ bill: BillSession | null; participantId: string | null }> {
    const supabase = getSupabaseClient();
    if (!supabase || !splitId) return { bill: null, participantId: null };

    try {
      const { data, error } = await supabase
        .from('bill_splits')
        .select('bill_id, participant_id')
        .eq('id', splitId)
        .limit(1);

      if (!error && data && data.length > 0) {
        const bill = await this.fetchBillFromCloud(data[0].bill_id);
        return { bill, participantId: data[0].participant_id };
      }
    } catch (err) {
      console.warn('[BillSync] fetchBillBySplitId notice:', err);
    }

    return { bill: null, participantId: null };
  }

  /**
   * Updates a split status to 'paid' in Supabase and syncs across real-time
   */
  public async markSplitPaidInCloud(
    billId: string,
    participantId: string,
    splitId: string,
    paidAmount: number,
    paymentMethod: string
  ): Promise<void> {
    const supabase = getSupabaseClient();
    const paidAt = new Date().toISOString();

    if (supabase) {
      try {
        await supabase
          .from('bill_splits')
          .update({
            status: 'paid',
            owed_amount: paidAmount,
            payment_method: paymentMethod,
            paid_at: paidAt,
          })
          .or(`id.eq.${splitId},and(bill_id.eq.${billId},participant_id.eq.${participantId})`);
      } catch (err) {
        console.warn('[BillSync] markSplitPaidInCloud table update notice:', err);
      }
    }

    const cloudBill = await this.fetchBillFromCloud(billId);
    if (cloudBill) {
      cloudBill.participants = cloudBill.participants.map((p) =>
        p.id === participantId || p.splitId === splitId
          ? {
              ...p,
              status: 'paid',
              paidAmount,
              paymentMethod: paymentMethod as any,
              paidAt,
            }
          : p
      );
      await this.broadcastBillUpdate(cloudBill);
    }
  }

  /**
   * Subscribes to real-time changes on the `bill_splits` table for this bill.
   */
  public subscribeToBillSplits(
    billId: string,
    onSplitUpdate: (splitRow: any) => void
  ): () => void {
    const supabase = getSupabaseClient();
    if (!supabase || !billId) return () => {};

    if (!this.splitListeners.has(billId)) {
      this.splitListeners.set(billId, new Set());
    }
    this.splitListeners.get(billId)!.add(onSplitUpdate);

    const channelName = `realtime_splits_${billId}_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bill_splits',
          filter: `bill_id=eq.${billId}`,
        },
        (payload: any) => {
          const updatedRow = payload.new || payload;
          const listeners = this.splitListeners.get(billId);
          if (listeners) {
            listeners.forEach((listener) => {
              try {
                listener(updatedRow);
              } catch (e) {
                console.warn('[BillSync] Split listener error:', e);
              }
            });
          }
        }
      )
      .subscribe();

    return () => {
      const listeners = this.splitListeners.get(billId);
      if (listeners) {
        listeners.delete(onSplitUpdate);
      }
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }

  /**
   * Subscribes to real-time bill updates.
   * Returns an unsubscribe callback.
   */
  public subscribeToBillUpdates(listener: (bill: BillSession) => void): () => void {
    this.listeners.add(listener);
    if (!this.channel) {
      this.initRealtimeChannel();
    }
    return () => {
      this.listeners.delete(listener);
    };
  }
}

const GLOBAL_BILL_SYNC_KEY = '__quotaBillSyncService__' as const;

type GlobalWithBillSync = typeof globalThis & {
  [GLOBAL_BILL_SYNC_KEY]?: BillSyncServiceImpl;
};

const globalSyncScope = globalThis as GlobalWithBillSync;

export const BillSyncService: BillSyncServiceImpl =
  globalSyncScope[GLOBAL_BILL_SYNC_KEY] ??
  (globalSyncScope[GLOBAL_BILL_SYNC_KEY] = new BillSyncServiceImpl());
