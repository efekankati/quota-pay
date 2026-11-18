const { createClient } = require('@supabase/supabase-js');
const { randomUUID } = require('crypto');
const fs = require('fs');
const path = require('path');

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

const billId = randomUUID();
const billData = {
  id: billId,
  title: 'Trattoria Da Enzo al 29',
  restaurantName: 'Trattoria Da Enzo al 29',
  currency: 'EUR',
  createdAt: new Date().toISOString(),
  settled: false,
  copertoPerPerson: 2.50,
  taxRate: 10,
  tipPercent: 0,
  items: [
    { id: 'item_coperto', name: 'Coperto (10 persone)', quantity: 10, unitPrice: 2.50, totalPrice: 25.00, isCoperto: true },
    { id: 'item_1', name: 'Carbonara Classica', quantity: 3, unitPrice: 14.00, totalPrice: 42.00, isCoperto: false },
    { id: 'item_2', name: 'Cacio e Pepe con Fiori di Zucca', quantity: 2, unitPrice: 13.50, totalPrice: 27.00, isCoperto: false },
    { id: 'item_3', name: 'Amatriciana Tradizionale', quantity: 3, unitPrice: 13.50, totalPrice: 40.50, isCoperto: false },
    { id: 'item_4', name: 'Saltimbocca alla Romana', quantity: 2, unitPrice: 18.00, totalPrice: 36.00, isCoperto: false },
    { id: 'item_5', name: 'Carciofi alla Giudia', quantity: 4, unitPrice: 7.00, totalPrice: 28.00, isCoperto: false },
    { id: 'item_6', name: 'Tiramisu Artigianale', quantity: 5, unitPrice: 6.50, totalPrice: 32.50, isCoperto: false },
    { id: 'item_7', name: 'Vino Rosso della Casa (Caraffa 1L)', quantity: 2, unitPrice: 16.00, totalPrice: 32.00, isCoperto: false },
    { id: 'item_8', name: 'Acqua Minerale Naturale 1L', quantity: 4, unitPrice: 3.00, totalPrice: 12.00, isCoperto: false },
    { id: 'item_9', name: 'Caffe Espresso', quantity: 7, unitPrice: 1.50, totalPrice: 10.50, isCoperto: false },
    { id: 'item_10', name: 'Limoncello di Sorrento', quantity: 6, unitPrice: 3.50, totalPrice: 21.00, isCoperto: false }
  ],
  totals: {
    subtotal: 280.45,
    tax: 28.05,
    tip: 0,
    grandTotal: 308.50,
    paidAmount: 0,
    remainingAmount: 308.50
  },
  participants: [
    { id: 'p_org', name: 'Efe (Host)', isHost: true, totalOwed: 308.50, paidAmount: 0, hasPaid: false, claimedItemIds: [] }
  ]
};

async function create() {
  const payload = {
    id: billId,
    title: JSON.stringify(billData),
    total_amount: billData.totals.grandTotal,
    created_at: new Date().toISOString()
  };
  const { error } = await supabase.from('bills').upsert(payload);
  if (error) {
    console.error('Supabase Error:', error);
    process.exit(1);
  }
  console.log('SUCCESS');
  console.log('BILL_ID:' + billId);
  console.log('TOTAL: €' + billData.totals.grandTotal.toFixed(2));
}

create();
