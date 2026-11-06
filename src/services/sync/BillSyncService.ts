import { BillSession, Participant } from '../../types/bill';
import { getSupabaseClient } from '../supabase/supabaseClient';

class BillSyncServiceImpl {
  private channel: any = null;
  private splitsChannel: any = null;
  private listeners: Set<(bill: BillSession) => void> = new Set();
  private splitListeners: Map<string, Set<(split: any) => void>> = new Map();
  private isChannelReady = false;

  constructor() {
    this.initRealtimeChannel();
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
        .on('broadcast', { event: 'bill_updated' }, (payload: any) => {
          if (payload?.payload?.bill) {
            const bill: BillSession = payload.payload.bill;
            this.listeners.forEach((listener) => {
              try {
                listener(bill);
              } catch (err) {
                console.warn('[BillSync] Listener error:', err);
              }
            });
          }
        })
        .subscribe((status: string) => {
          this.isChannelReady = status === 'SUBSCRIBED';
        });
    } catch (err) {
      console.warn('[BillSync] Channel init error:', err);
    }
  }

  /**
   * Broadcasts a bill update in real-time to all connected devices (mobile app & web)
   * and persists a snapshot to cloud storage.
   */
  public async broadcastBillUpdate(bill: BillSession): Promise<void> {
    if (!bill || !bill.id) return;

    // 1. Instant Realtime WebSocket Broadcast
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

    // 2. Cloud Persistence in Supabase (bills, bill_splits, bill_items)
    this.saveBillToCloud(bill).catch((err) => {
      console.warn('[BillSync] Cloud save error:', err);
    });
  }

  /**
   * Persists a serialized bill session snapshot, its bill_splits, and bill_items in Supabase
   */
  public async saveBillToCloud(bill: BillSession): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase || !bill || !bill.id) return;

    try {
      const payloadStr = JSON.stringify({ q_id: bill.id, bill });
      const grandTotal = bill.taxSummary?.grandTotal || bill.manualTotalAmount || 0;
      const status = bill.status === 'settled' ? 'completed' : 'pending';

      // 1. Persist Bill in `bills` table
      const { data: existing } = await supabase
        .from('bills')
        .select('id')
        .ilike('title', `%${bill.id}%`)
        .order('created_at', { ascending: false })
        .limit(1);

      if (existing && existing.length > 0) {
        await supabase
          .from('bills')
          .update({
            title: payloadStr,
            total_amount: grandTotal,
            status,
            currency: bill.currency || 'EUR',
          })
          .eq('id', existing[0].id);
      } else {
        await supabase.from('bills').insert({
          title: payloadStr,
          total_amount: grandTotal,
          status,
          currency: bill.currency || 'EUR',
        });
      }

      // 2. Persist Participant Rows in `bill_splits`
      try {
        const splitsRows = bill.participants.map((p) => {
          const splitId =
            p.splitId ||
            `split_${bill.id.replace(/^bill_/, '')}_${p.id.replace(/^part_/, '')}`;

          // Precompute owed share if available
          let owedAmount = p.paidAmount || 0;
          if (bill.splitMode === 'even') {
            const included = bill.includedParticipantIds || bill.participants.map((pt) => pt.id);
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
            bill_id: bill.id,
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
      if (bill.items && bill.items.length > 0) {
        try {
          const itemsRows = bill.items.map((it) => ({
            id: it.id,
            bill_id: bill.id,
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
  public async fetchBillBySplitId(splitId: string): Promise<{ bill: BillSession | null; participantId: string | null }> {
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

    // Also update cloud snapshot
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
   * Fires instant notification when a guest pays.
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


