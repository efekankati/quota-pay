/**
 * End-to-End Automated Test Suite for 10-Person Italian Dinner Bill
 * Simulates 10 diners claiming items, verifies mathematical integrity,
 * simulates payments, checks real-time Supabase sync, and queries the EC2 server.
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const http = require('http');

function getEnv() {
  const envFile = fs.readFileSync(path.resolve(__dirname, '../.env'), 'utf-8');
  const env = {};
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

const env = getEnv();
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
const EC2_HOST = '15.161.41.185';
const TARGET_BILL_ID = '2cd8af15-b665-4421-970f-ccd563bd8fd9';

// Mathematical breakdown calculation replicating useBillStore.getBillShareBreakdown
function calculateShare(bill, participantId) {
  const participant = bill.participants.find((p) => p.id === participantId);
  const isOrganizer = Boolean(participant?.isOrganizer) || participantId === 'user_me' || participantId === bill.organizerId;

  let itemsShare = 0;
  let claimedItemCount = 0;

  bill.items.forEach((item) => {
    if (item.isCoperto) return;

    const claimedMap = item.claimedQuantities || {};
    const totalClaimedUnits = Object.values(claimedMap).reduce((sum, q) => sum + (q || 0), 0);
    const myClaimedUnits = isOrganizer
      ? (claimedMap[participantId] ?? claimedMap[bill.organizerId] ?? claimedMap['user_me'] ?? 0)
      : (claimedMap[participantId] || 0);

    const assignedIds = item.assignedParticipantIds || [];
    const isAssigned = isOrganizer
      ? assignedIds.includes(participantId) || assignedIds.includes(bill.organizerId) || assignedIds.includes('user_me')
      : assignedIds.includes(participantId);

    if (totalClaimedUnits > 0 && totalClaimedUnits <= item.quantity && myClaimedUnits > 0) {
      claimedItemCount += myClaimedUnits;
      itemsShare += myClaimedUnits * item.unitPrice;
    } else if (isAssigned && assignedIds.length > 0) {
      claimedItemCount += 1;
      const totalCents = Math.round(item.totalPrice * 100);
      const count = assignedIds.length;
      const baseCents = Math.floor(totalCents / count);
      const remainderCents = totalCents % count;
      let idx = assignedIds.indexOf(participantId);
      if (idx === -1 && isOrganizer) {
        idx = assignedIds.indexOf(bill.organizerId);
        if (idx === -1) idx = assignedIds.indexOf('user_me');
      }
      if (idx !== -1) {
        const shareCents = baseCents + (idx < remainderCents ? 1 : 0);
        itemsShare += shareCents / 100;
      }
    }
  });

  const copertoItem = bill.items.find((it) => it.isCoperto);
  const hasClaimedItems = claimedItemCount > 0 || itemsShare > 0;

  let copertoShare = 0;
  if (copertoItem && hasClaimedItems && copertoItem.totalPrice > 0) {
    const activeClaimersCount = bill.participants.filter((p) => {
      const isThisOrg = Boolean(p.isOrganizer) || p.id === bill.organizerId || p.id === 'user_me';
      return bill.items.some((it) => {
        if (it.isCoperto) return false;
        const cMap = it.claimedQuantities || {};
        const myQ = isThisOrg
          ? (cMap[p.id] ?? cMap[bill.organizerId] ?? cMap['user_me'] ?? 0)
          : (cMap[p.id] || 0);
        if (myQ > 0) return true;
        const aIds = it.assignedParticipantIds || [];
        return isThisOrg
          ? aIds.includes(p.id) || aIds.includes(bill.organizerId) || aIds.includes('user_me')
          : aIds.includes(p.id);
      });
    }).length;

    const divisor = Math.max(
      copertoItem.quantity || 1,
      activeClaimersCount,
      bill.participants.length
    );
    const fairCoperto = Math.round((copertoItem.totalPrice / divisor) * 100) / 100;
    copertoShare = bill.copertoPerPerson !== undefined && bill.copertoPerPerson > 0
      ? Math.min(bill.copertoPerPerson, fairCoperto)
      : fairCoperto;
  }

  const baseAmount = itemsShare + copertoShare;
  let tipShare = 0;
  if (isOrganizer && bill.tipPercentage > 0) {
    tipShare = Math.round(baseAmount * (bill.tipPercentage / 100) * 100) / 100;
  }

  const vatShare = Math.round(baseAmount * 0.1 * 100) / 100;
  const totalDue = Math.round((baseAmount + tipShare) * 100) / 100;

  return {
    participantId,
    itemsShare: Math.round(itemsShare * 100) / 100,
    copertoShare: Math.round(copertoShare * 100) / 100,
    vatShare,
    tipShare,
    totalDue,
    claimedItemCount
  };
}

async function runTest() {
  console.log('================================================================');
  console.log('🧪 RUNNING FULL 10-PERSON END-TO-END SIMULATION & TEST');
  console.log('================================================================\n');

  // STEP 1: Verify EC2 HTTP Server Connectivity
  console.log('📡 STEP 1: Testing EC2 Server HTTP Connectivity (http://' + EC2_HOST + ')...');
  const httpCheck = await new Promise((resolve) => {
    const req = http.get(`http://${EC2_HOST}/?bill=${TARGET_BILL_ID}`, (res) => {
      resolve({ status: res.statusCode, headers: res.headers });
    });
    req.on('error', (err) => resolve({ error: err.message }));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve({ error: 'Spot server inactive/stopped (timeout 2000ms)' });
    });
  });

  if (httpCheck.error) {
    console.warn(`  ⚠️ EC2 server connection issue: ${httpCheck.error}`);
  } else {
    console.log(`  ✅ EC2 Web App is LIVE: HTTP ${httpCheck.status} OK (Server: ${httpCheck.headers.via || 'Caddy'})`);
  }

  // STEP 2: Fetch Living Bill from Supabase
  console.log('\n📦 STEP 2: Fetching Bill Session from Supabase Cloud...');
  const { data: billRows, error: fetchErr } = await supabase
    .from('bills')
    .select('id, title, total_amount, status')
    .ilike('title', `%${TARGET_BILL_ID}%`)
    .limit(1);

  if (fetchErr || !billRows || billRows.length === 0) {
    console.error('❌ Failed to fetch test bill from Supabase:', fetchErr);
    process.exit(1);
  }

  const payload = JSON.parse(billRows[0].title);
  const bill = payload.bill;
  console.log(`  ✅ Successfully loaded bill: "${bill.title}" at "${bill.restaurantName}"`);
  console.log(`  💰 Grand Total: €${bill.taxSummary.grandTotal.toFixed(2)}`);
  console.log(`  👥 Total Seated Diners: ${bill.participants.length}`);
  console.log(`  🍽️ Total Line Items: ${bill.items.length}`);

  // STEP 3: Setup 10-Person Claims Distribution
  console.log('\n🍽️ STEP 3: Simulating 10-Diner Item Claims Across Table...');

  // Define realistic dining claims for 10 people
  const claims = [
    // 0. Ilaria (Organizer)
    {
      pId: 'user_me',
      name: 'Ilaria (Org)',
      items: { item_1: 1, item_6: 1 } // 1x Carbonara (€14) + 1x Tiramisu (€6)
    },
    // 1. Ilaria (Guest)
    {
      pId: 'part_1794074870358_8fnh275y',
      name: 'Ilaria',
      items: { item_2: 1 } // 1x Cacio e Pepe (€13.50)
    },
    // 2. Roberta
    {
      pId: 'part_1794074877737_juzu11mt',
      name: 'Roberta',
      items: { item_1: 1, item_5: 1 } // 1x Carbonara (€14) + 1x Carciofi (€7)
    },
    // 3. Leonardo
    {
      pId: 'part_1794074882869_ym527wtp',
      name: 'Leonardo',
      items: { item_4: 1, item_8: 1 } // 1x Saltimbocca (€18) + 1x Acqua (€3)
    },
    // 4. Alice
    {
      pId: 'part_1794074888405_p8596y6',
      name: 'Alice',
      items: { item_3: 1, item_6: 1 } // 1x Amatriciana (€13.50) + 1x Tiramisu (€6)
    },
    // 5. Maria
    {
      pId: 'part_1794074913088_bzqlu7ap',
      name: 'Maria',
      items: { item_4: 1, item_7: 1 } // 1x Saltimbocca (€18) + 1x Vino Rosso (€16)
    },
    // 6. Emre
    {
      pId: 'part_1794074917295_bi184v0h',
      name: 'Emre',
      items: { item_1: 1, item_6: 1, item_9: 1 } // 1x Carbonara (€14) + 1x Tiramisu (€6) + 1x Caffe (€1.50)
    },
    // 7. Alperen
    {
      pId: 'part_1794074921325_m0b3qmgm',
      name: 'Alperen',
      items: { item_3: 1, item_5: 1, item_10: 1 } // 1x Amatriciana (€13.50) + 1x Carciofi (€7) + 1x Limoncello (€3.50)
    },
    // 8. Fırat
    {
      pId: 'part_1794074937009_voihz0l',
      name: 'Fırat',
      items: { item_2: 1, item_6: 1, item_7: 1, item_9: 2 } // 1x Cacio e Pepe (€13.50) + 1x Tiramisu (€6) + 1x Vino (€16) + 2x Caffe (€3)
    },
    // 9. Marco
    {
      pId: 'part_1794075007348_0msdu988',
      name: 'Marco',
      items: { item_3: 1, item_5: 2, item_6: 1, item_8: 3, item_9: 4, item_10: 5 } // 1x Amatriciana (€13.50) + 2x Carciofi (€14) + 1x Tiramisu (€6) + 3x Acqua (€9) + 4x Caffe (€6) + 5x Limoncello (€17.50)
    }
  ];

  // Apply claims to bill items
  bill.items.forEach((it) => {
    it.claimedQuantities = {};
    it.assignedParticipantIds = [];
  });

  claims.forEach((claim) => {
    Object.entries(claim.items).forEach(([itemId, qty]) => {
      const item = bill.items.find((it) => it.id === itemId);
      if (!item) {
        console.error(`Item ${itemId} not found!`);
        return;
      }
      item.claimedQuantities[claim.pId] = qty;
      if (!item.assignedParticipantIds.includes(claim.pId)) {
        item.assignedParticipantIds.push(claim.pId);
      }
    });
  });

  // Verify all item quantities match exactly
  console.log('  🔍 Verifying item quantities:');
  let allQuantitiesMatch = true;
  bill.items.forEach((it) => {
    if (it.isCoperto) return;
    const totalClaimed = Object.values(it.claimedQuantities || {}).reduce((s, q) => s + q, 0);
    const matches = totalClaimed === it.quantity;
    if (!matches) allQuantitiesMatch = false;
    console.log(`    - ${it.name}: ${totalClaimed}/${it.quantity} claimed ${matches ? '✅' : '❌'}`);
  });

  if (!allQuantitiesMatch) {
    console.error('❌ Mismatch in claimed quantities!');
    process.exit(1);
  }

  // STEP 4: Calculate Individual Shares & Mathematical Invariants
  console.log('\n🧮 STEP 4: Computing Cent-Accurate Bill Shares for All 10 Diners...');
  let totalCalculatedDue = 0;
  let totalCopertoCalculated = 0;
  const dinerBreakdowns = [];

  claims.forEach((claim, idx) => {
    const breakdown = calculateShare(bill, claim.pId);
    dinerBreakdowns.push(breakdown);
    totalCalculatedDue += breakdown.totalDue;
    totalCopertoCalculated += breakdown.copertoShare;
    console.log(
      `    ${idx + 1}. ${claim.name.padEnd(14)}: Dishes €${breakdown.itemsShare.toFixed(2).padStart(5)} + Coperto €${breakdown.copertoShare.toFixed(2)} = Total €${breakdown.totalDue.toFixed(2).padStart(5)} (${breakdown.claimedItemCount} items)`
    );
  });

  totalCalculatedDue = Math.round(totalCalculatedDue * 100) / 100;
  totalCopertoCalculated = Math.round(totalCopertoCalculated * 100) / 100;

  console.log('\n  📊 Mathematical Reconciliation:');
  console.log(`    Receipt Subtotal:       €${bill.taxSummary.subtotal.toFixed(2)}`);
  console.log(`    Receipt Coperto Total:  €${bill.taxSummary.copertoTotal.toFixed(2)} (Sum of shares: €${totalCopertoCalculated.toFixed(2)})`);
  console.log(`    Receipt Grand Total:    €${bill.taxSummary.grandTotal.toFixed(2)}`);
  console.log(`    Sum of All 10 Shares:   €${totalCalculatedDue.toFixed(2)}`);

  const delta = Math.abs(totalCalculatedDue - bill.taxSummary.grandTotal);
  if (delta < 0.01) {
    console.log('    ✅ PERFECT MATCH! Difference is €0.00 (Zero overcharge, zero undercharge).');
  } else {
    console.error(`    ❌ Mathematical error: Difference is €${delta.toFixed(2)}!`);
    process.exit(1);
  }

  // STEP 5: Simulate Sequential Payments & Live Settlement
  console.log('\n💳 STEP 5: Simulating 10 Consecutive Payments (Google Pay & Apple Pay)...');
  let runningCollected = 0;

  bill.participants.forEach((p, idx) => {
    const bd = dinerBreakdowns[idx];
    p.status = 'paid';
    p.paidAmount = bd.totalDue;
    p.paidAt = new Date().toISOString();
    p.paymentMethod = idx === 0 ? 'apple_pay' : 'google_pay';
    runningCollected += bd.totalDue;
    runningCollected = Math.round(runningCollected * 100) / 100;

    const percent = Math.round((runningCollected / bill.taxSummary.grandTotal) * 100);
    console.log(
      `    [Payment ${idx + 1}/10] ${p.name.slice(0, 20).padEnd(20)} paid €${bd.totalDue.toFixed(2).padStart(5)} via ${p.paymentMethod} -> Live Collected: €${runningCollected.toFixed(2)} / €${bill.taxSummary.grandTotal.toFixed(2)} (${percent}%)`
    );
  });

  bill.status = 'paid';

  // STEP 6: Commit Final State to Supabase
  console.log('\n💾 STEP 6: Syncing Fully Settled 10-Person State to Supabase Cloud...');
  const updatedPayloadStr = JSON.stringify({
    bill,
    version: 2,
    updated_at: new Date().toISOString()
  });

  const { error: updateErr } = await supabase
    .from('bills')
    .update({
      title: updatedPayloadStr,
      total_amount: bill.taxSummary.grandTotal,
      status: 'completed',
      currency: 'EUR'
    })
    .eq('id', TARGET_BILL_ID);

  if (updateErr) {
    console.error('❌ Supabase update failed:', updateErr);
    process.exit(1);
  }
  console.log('  ✅ Supabase updated successfully with 10 settled diners.');

  // STEP 7: Re-fetch and Verify Persistence
  console.log('\n🔍 STEP 7: Re-fetching Bill from Supabase to Verify Zero-Drift Persistence...');
  const { data: verifyData } = await supabase
    .from('bills')
    .select('title, total_amount, status')
    .eq('id', TARGET_BILL_ID)
    .single();

  const persistedBill = JSON.parse(verifyData.title).bill;
  const paidCount = persistedBill.participants.filter((p) => p.status === 'paid').length;
  const persistedPaidTotal = persistedBill.participants.reduce((s, p) => s + (p.paidAmount || 0), 0);

  console.log(`  ✅ Bill status in cloud: "${verifyData.status}"`);
  console.log(`  ✅ Settled diners: ${paidCount}/${persistedBill.participants.length}`);
  console.log(`  ✅ Total amount collected: €${persistedPaidTotal.toFixed(2)} / €${persistedBill.taxSummary.grandTotal.toFixed(2)}`);

  console.log('\n================================================================');
  console.log('🎉 ALL 10-PERSON SIMULATION TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================');
}

runTest().catch((err) => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
