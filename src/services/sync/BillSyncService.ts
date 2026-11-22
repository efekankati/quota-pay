import { BillSession, LineItem, Participant } from '../../types/bill';
import { getSupabaseClient } from '../supabase/supabaseClient';
import { sanitizeReceiptUrlForPersistence } from '../../utils/imageMemoryManager';

class BillSyncServiceImpl {
  private channel: any = null;
  private listeners: Set<(bill: BillSession) => void> = new Set();
  private splitListeners: Map<string, Set<(split: any) => void>> = new Map();
  private splitChannels: Map<string, any> = new Map();
  private inFlightFetches: Map<string, Promise<BillSession | null>> = new Map();
  private saveQueues: Map<string, Promise<void>> = new Map();
  private inFlightActors: Map<string, { actorId: string; billSnapshot: BillSession }> = new Map();
  private lastLocalMutationAt: Map<string, number> = new Map();
  private isChannelReady = false;

  /**
   * Preserves in-flight local actor claims if an older cloud snapshot arrives before CAS/retry converges.
   */
  public applyPendingLocalActor(incomingBill: BillSession): BillSession {
    if (!incomingBill?.id) return incomingBill;
    const pending = this.inFlightActors.get(incomingBill.id);
    if (!pending) return incomingBill;
    return this.mergeBillSessions(incomingBill, pending.billSnapshot, pending.actorId);
  }

  constructor() {
    // Channels are lazily initialized on first subscription and torn down via supabase.removeChannel(channel) on unmount
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
    localBill: BillSession,
    actorParticipantId?: string
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
    const cloudPaidGuestIds = new Set(
      (cloudBill.participants || [])
        .filter((p) => !p.isOrganizer && p.id !== 'user_me' && p.status === 'paid')
        .map((p) => p.id)
    );
    const paidGuestIds = new Set(
      mergedParticipants
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

      // Start with all cloud claims, then overlay local claims.
      // If actorParticipantId is specified, only actorParticipantId can reduce/remove their own claim;
      // all other participants' claims in cloudItem are preserved so concurrent tabs never wipe each other!
      const mergedClaimed: Record<string, number> = {};

      if (actorParticipantId) {
        for (const [pId, qty] of Object.entries(cloudItem.claimedQuantities || {})) {
          if (pId !== actorParticipantId && qty > 0) {
            mergedClaimed[pId] = qty;
          }
        }
        const othersTotal = Object.values(mergedClaimed).reduce((sum, q) => sum + (q || 0), 0);
        if (cloudPaidGuestIds.has(actorParticipantId)) {
          const frozenQty = cloudItem.claimedQuantities?.[actorParticipantId] || 0;
          if (frozenQty > 0) {
            mergedClaimed[actorParticipantId] = frozenQty;
          }
        } else {
          const desiredActorQty = localItem.claimedQuantities?.[actorParticipantId] || 0;
          const maxAllowed = Math.max(0, (localItem.quantity || 1) - othersTotal);
          const boundedActorQty = Math.min(desiredActorQty, maxAllowed);
          if (boundedActorQty > 0) {
            mergedClaimed[actorParticipantId] = boundedActorQty;
          }
        }
      } else {
        for (const [pId, qty] of Object.entries(localItem.claimedQuantities || {})) {
          if (qty > 0) {
            mergedClaimed[pId] = qty;
          }
        }
        for (const [pId, qty] of Object.entries(cloudItem.claimedQuantities || {})) {
          if (paidGuestIds.has(pId) && qty > 0) {
            mergedClaimed[pId] = qty;
          }
        }
      }

      const assignedSet = new Set<string>();
      if (actorParticipantId) {
        for (const pId of cloudItem.assignedParticipantIds || []) {
          if (pId !== actorParticipantId) {
            assignedSet.add(pId);
          }
        }
        if (cloudPaidGuestIds.has(actorParticipantId)) {
          if ((cloudItem.assignedParticipantIds || []).includes(actorParticipantId)) {
            assignedSet.add(actorParticipantId);
          }
        } else if ((localItem.assignedParticipantIds || []).includes(actorParticipantId)) {
          const hasQtyClaims =
            Object.keys(mergedClaimed).length > 0 || (localItem.quantity || 1) > 1;
          if (!hasQtyClaims || (mergedClaimed[actorParticipantId] || 0) > 0) {
            assignedSet.add(actorParticipantId);
          }
        }
      } else {
        for (const pId of localItem.assignedParticipantIds || []) {
          assignedSet.add(pId);
        }
        for (const pId of cloudItem.assignedParticipantIds || []) {
          if (paidGuestIds.has(pId)) {
            assignedSet.add(pId);
          }
        }
      }
      for (const [pId, qty] of Object.entries(mergedClaimed)) {
        if (qty > 0) assignedSet.add(pId);
      }

      return {
        ...localItem,
        claimedQuantities: mergedClaimed,
        assignedParticipantIds: Array.from(assignedSet).sort(),
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

    // Recalculate whether the bill is fully settled across all merged participants
    const grandTotal =
      localBill.taxSummary?.grandTotal ||
      cloudBill.taxSummary?.grandTotal ||
      localBill.manualTotalAmount ||
      0;
    const totalPaidAmount = mergedParticipants.reduce(
      (sum, p) => (p.status === 'paid' ? sum + (p.paidAmount || 0) : sum),
      0
    );
    const allPaid =
      mergedParticipants.length > 0 && mergedParticipants.every((p) => p.status === 'paid');
    const allMoneyCovered =
      grandTotal > 0 && Math.round(totalPaidAmount * 100) >= Math.round(grandTotal * 100);
    const mergedStatus =
      allPaid && allMoneyCovered
        ? ('settled' as const)
        : localBill.status === 'settled' || cloudBill.status === 'settled'
        ? ('collecting' as const)
        : localBill.status;

    const cleanReceiptUrl =
      localBill.receiptImageUrl?.startsWith('blob:')
        ? localBill.receiptImageUrl
        : sanitizeReceiptUrlForPersistence(
            localBill.receiptImageUrl || cloudBill.receiptImageUrl
          );

    return {
      ...cloudBill,
      ...localBill,
      receiptImageUrl: cleanReceiptUrl,
      status: mergedStatus,
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
    if (this.channel) return;
    const supabase = getSupabaseClient();
    if (!supabase) return;

    try {
      const channel = supabase.channel('quota_bill_sync', {
        config: {
          broadcast: { self: false },
        },
      });
      this.channel = channel;

      channel
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
                  this.notifyListeners(incoming);
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
  public async broadcastBillUpdate(
    bill: BillSession,
    actorParticipantId?: string
  ): Promise<void> {
    if (!bill || !bill.id) return;
    this.lastLocalMutationAt.set(bill.id, Date.now());
    if (actorParticipantId) {
      this.inFlightActors.set(bill.id, {
        actorId: actorParticipantId,
        billSnapshot: bill,
      });
    }

    // Persist & merge atomically in Supabase first, then broadcast the canonical merged snapshot
    // so concurrent tabs never twitch between unmerged and merged states.
    this.saveBillToCloud(bill, actorParticipantId).catch((err) => {
      console.warn('[BillSync] Cloud save error:', err);
    });
  }

  /**
   * Serializes per-bill writes through a promise queue so rapid local taps never interleave.
   */
  public async saveBillToCloud(
    bill: BillSession,
    actorParticipantId?: string
  ): Promise<void> {
    if (!bill || !bill.id) return;
    if (actorParticipantId) {
      this.inFlightActors.set(bill.id, {
        actorId: actorParticipantId,
        billSnapshot: bill,
      });
    }
    const prev = this.saveQueues.get(bill.id) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => this.performSaveBillToCloud(bill, actorParticipantId));
    this.saveQueues.set(bill.id, next);
    try {
      await next;
    } finally {
      if (this.saveQueues.get(bill.id) === next) {
        this.saveQueues.delete(bill.id);
      }
    }
  }

  /**
   * Persists a serialized bill session snapshot, merging with any prior guest joins/claims
   * already stored in Supabase and verifying read-back so concurrent writes converge.
   */
  private async performSaveBillToCloud(
    bill: BillSession,
    actorParticipantId?: string
  ): Promise<void> {
    const supabase = getSupabaseClient();
    if (!supabase || !bill || !bill.id) {
      if (bill?.id) this.inFlightActors.delete(bill.id);
      return;
    }

    try {
      const { data: initialRows } = await supabase
        .from('bills')
        .select('id, title')
        .ilike('title', `%${bill.id}%`)
        .order('created_at', { ascending: false })
        .limit(1);

      let rowId: string | number | null =
        initialRows && initialRows.length > 0 ? initialRows[0].id : null;
      let existingTitle: string | null =
        initialRows && initialRows.length > 0 ? initialRows[0].title : null;

      let mergedBill = bill;
      let cloudSafeBill: BillSession = {
        ...mergedBill,
        receiptImageUrl: sanitizeReceiptUrlForPersistence(mergedBill.receiptImageUrl),
      };

      const maxAttempts = rowId !== null ? 4 : 1;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0 && rowId !== null) {
          const jitterMs = 45 + Math.floor(Math.random() * 100);
          await new Promise((resolve) => setTimeout(resolve, jitterMs));
          const { data: freshRows } = await supabase
            .from('bills')
            .select('id, title')
            .eq('id', rowId)
            .limit(1);
          existingTitle = freshRows && freshRows.length > 0 ? freshRows[0].title : existingTitle;
        }

        mergedBill = bill;
        if (existingTitle) {
          try {
            const parsedExisting = JSON.parse(existingTitle);
            if (parsedExisting?.bill) {
              mergedBill = this.mergeBillSessions(
                parsedExisting.bill as BillSession,
                bill,
                actorParticipantId
              );
            }
          } catch {
            mergedBill = bill;
          }
        }

        cloudSafeBill = {
          ...mergedBill,
          receiptImageUrl: sanitizeReceiptUrlForPersistence(mergedBill.receiptImageUrl),
        };

        const payloadStr = JSON.stringify({ q_id: cloudSafeBill.id, bill: cloudSafeBill });
        const grandTotal =
          cloudSafeBill.taxSummary?.grandTotal || cloudSafeBill.manualTotalAmount || 0;
        const status = cloudSafeBill.status === 'settled' ? 'completed' : 'pending';

        if (rowId !== null) {
          if (existingTitle === payloadStr) {
            break;
          }
          await supabase
            .from('bills')
            .update({
              title: payloadStr,
              total_amount: grandTotal,
              status,
              currency: cloudSafeBill.currency || 'EUR',
            })
            .eq('id', rowId);

          if (!actorParticipantId) {
            break;
          }

          const { data: verifyRows } = await supabase
            .from('bills')
            .select('title')
            .eq('id', rowId)
            .limit(1);
          const readBackTitle = verifyRows && verifyRows.length > 0 ? verifyRows[0].title : null;
          if (!readBackTitle || readBackTitle === payloadStr) {
            break;
          }
          existingTitle = readBackTitle;
        } else {
          const { data: inserted } = await supabase
            .from('bills')
            .insert({
              title: payloadStr,
              total_amount: grandTotal,
              status,
              currency: cloudSafeBill.currency || 'EUR',
            })
            .select('id')
            .limit(1);
          if (inserted && inserted.length > 0) {
            rowId = inserted[0].id;
          }
          break;
        }
      }

      const grandTotal =
        cloudSafeBill.taxSummary?.grandTotal || cloudSafeBill.manualTotalAmount || 0;

      // Always notify local store & broadcast the canonical merged state to all open tabs
      if (actorParticipantId) {
        const currentPending = this.inFlightActors.get(bill.id);
        if (currentPending?.actorId === actorParticipantId && currentPending.billSnapshot === bill) {
          this.inFlightActors.delete(bill.id);
        }
      }
      this.notifyListeners(mergedBill);
      if (this.channel && this.isChannelReady) {
        try {
          await this.channel.send({
            type: 'broadcast',
            event: 'bill_updated',
            payload: { bill: cloudSafeBill },
          });
        } catch {}
      }

      // 2. Persist Participant Rows in `bill_splits`
      try {
        const splitsRows = cloudSafeBill.participants.map((p) => {
          const splitId =
            p.splitId ||
            `split_${cloudSafeBill.id.replace(/^bill_/, '')}_${p.id.replace(/^part_/, '')}`;

          let owedAmount = p.paidAmount || 0;
          if (cloudSafeBill.splitMode === 'even') {
            const included =
              cloudSafeBill.includedParticipantIds ||
              cloudSafeBill.participants.map((pt) => pt.id);
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

          const resolvedOwedAmount =
            p.status === 'paid' && p.paidAmount !== undefined
              ? p.paidAmount
              : p.owedAmount !== undefined
              ? p.owedAmount
              : owedAmount;

          return {
            id: splitId,
            bill_id: cloudSafeBill.id,
            participant_id: p.id,
            participant_name: p.name,
            owed_amount: resolvedOwedAmount,
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
      if (cloudSafeBill.items && cloudSafeBill.items.length > 0) {
        try {
          const itemsRows = cloudSafeBill.items.map((it) => ({
            id: it.id,
            bill_id: cloudSafeBill.id,
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
    } finally {
      if (actorParticipantId && bill?.id) {
        const currentPending = this.inFlightActors.get(bill.id);
        if (currentPending?.actorId === actorParticipantId && currentPending.billSnapshot === bill) {
          this.inFlightActors.delete(bill.id);
        }
      }
    }
  }

  /**
   * Fetches the latest bill session snapshot from the cloud.
   * Deduplicates concurrent in-flight requests for the same billId.
   */
  public async fetchBillFromCloud(billId: string): Promise<BillSession | null> {
    const supabase = getSupabaseClient();
    if (!supabase || !billId) return null;

    const existingPromise = this.inFlightFetches.get(billId);
    if (existingPromise) {
      return existingPromise;
    }

    const fetchPromise = (async (): Promise<BillSession | null> => {
      try {
        const { data, error } = await supabase
          .from('bills')
          .select('title')
          .ilike('title', `%${billId}%`)
          .order('created_at', { ascending: false })
          .limit(1);

        if (error || !data || data.length === 0) return null;

        const parsed = JSON.parse(data[0].title);
        if (parsed?.bill) {
          const bill = parsed.bill as BillSession;
          bill.receiptImageUrl = sanitizeReceiptUrlForPersistence(bill.receiptImageUrl);
          return bill;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.inFlightFetches.delete(billId);
      }
    })();

    this.inFlightFetches.set(billId, fetchPromise);
    return fetchPromise;
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
   * Updates a split status to 'paid' in Supabase `bill_splits` table
   * (The canonical `bills` row is already merged and broadcast by `markParticipantPaid`).
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
  }

  /**
   * Subscribes to real-time changes on the `bill_splits` table for this bill.
   * Deduplicates channel creation per `billId` and strictly executes
   * `supabase.removeChannel(channel)` when the last subscriber unmounts.
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

    let channel = this.splitChannels.get(billId);
    if (!channel) {
      const channelName = `realtime_splits_${billId}`;
      channel = supabase
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

      this.splitChannels.set(billId, channel);
    }

    return () => {
      const listeners = this.splitListeners.get(billId);
      if (listeners) {
        listeners.delete(onSplitUpdate);
        if (listeners.size === 0) {
          this.splitListeners.delete(billId);
          const activeChannel = this.splitChannels.get(billId) || channel;
          this.splitChannels.delete(billId);
          if (activeChannel) {
            supabase.removeChannel(activeChannel);
          }
        }
      }
    };
  }

  /**
   * Subscribes to real-time bill updates.
   * Deduplicates the underlying `quota_bill_sync` channel and strictly calls
   * `supabase.removeChannel(channel)` when the last subscriber unmounts.
   */
  public subscribeToBillUpdates(listener: (bill: BillSession) => void): () => void {
    const supabase = getSupabaseClient();
    this.listeners.add(listener);
    if (!this.channel) {
      this.initRealtimeChannel();
    }
    const channel = this.channel;

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && (this.channel || channel)) {
        const activeChannel = this.channel || channel;
        this.channel = null;
        this.isChannelReady = false;
        if (supabase && activeChannel) {
          supabase.removeChannel(activeChannel);
        }
      }
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
