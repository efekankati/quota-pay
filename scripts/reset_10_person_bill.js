const { createClient } = require('@supabase/supabase-js');
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
const TARGET_BILL_ID = '2cd8af15-b665-4421-970f-ccd563bd8fd9';

const fresh10PersonBill = {
  id: TARGET_BILL_ID,
  title: 'Dinner at Enzo',
  restaurantName: 'Trattoria Da Enzo al 29',
  createdAt: new Date().toISOString(),
  currency: 'EUR',
  status: 'collecting',
  organizerId: 'user_me',
  copertoPerPerson: 2.50,
  tipPercentage: 0,
  organizerIban: 'IT60X0542811101000000123456',
  organizerBankName: 'Intesa Sanpaolo S.p.A.',
  organizerAccountHolder: 'Ilaria di Piu Bella in Mondo',
  participants: [
    {
      id: 'user_me',
      name: 'Ilaria di Piu Bella in Mondo (Organizer)',
      isOrganizer: true,
      status: 'paid',
      paidAmount: 22.50,
      paymentMethod: 'apple_pay',
      paidAt: new Date().toISOString()
    },
    {
      id: 'part_1794074870358_8fnh275y',
      name: 'Ilaria',
      isOrganizer: false,
      status: 'pending',
      splitId: `split_${TARGET_BILL_ID}_1794074870358_8fnh275y`
    },
    {
      id: 'part_1794074877737_juzu11mt',
      name: 'Roberta',
      isOrganizer: false,
      status: 'pending',
      splitId: `split_${TARGET_BILL_ID}_1794074877737_juzu11mt`
    },
    {
      id: 'part_1794074882869_ym527wtp',
      name: 'Leonardo',
      isOrganizer: false,
      status: 'pending',
      splitId: `split_${TARGET_BILL_ID}_1794074882869_ym527wtp`
    },
    {
      id: 'part_1794074888405_p8596y6',
      name: 'Alice',
      isOrganizer: false,
      status: 'pending',
      splitId: `split_${TARGET_BILL_ID}_1794074888405_p8596y6`
    },
    {
      id: 'part_1794074913088_bzqlu7ap',
      name: 'Maria',
      isOrganizer: false,
      status: 'pending',
      splitId: `split_${TARGET_BILL_ID}_1794074913088_bzqlu7ap`
    },
    {
      id: 'part_1794074917295_bi184v0h',
      name: 'Emre',
      isOrganizer: false,
      status: 'pending',
      splitId: `split_${TARGET_BILL_ID}_1794074917295_bi184v0h`
    },
    {
      id: 'part_1794074921325_m0b3qmgm',
      name: 'Alperen',
      isOrganizer: false,
      status: 'pending',
      splitId: `split_${TARGET_BILL_ID}_1794074921325_m0b3qmgm`
    },
    {
      id: 'part_1794074937009_voihz0l',
      name: 'Fırat',
      isOrganizer: false,
      status: 'pending',
      splitId: `split_${TARGET_BILL_ID}_1794074937009_voihz0l`
    },
    {
      id: 'part_1794075007348_0msdu988',
      name: 'Marco',
      isOrganizer: false,
      status: 'pending',
      splitId: `split_${TARGET_BILL_ID}_1794075007348_0msdu988`
    }
  ],
  items: [
    {
      id: 'item_1',
      name: 'Carbonara Classica',
      rawText: 'Carbonara Classica',
      quantity: 3,
      unitPrice: 14.00,
      totalPrice: 42.00,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: ['user_me'],
      claimedQuantities: { user_me: 1 }
    },
    {
      id: 'item_2',
      name: 'Cacio e Pepe con Fiori di Zucca',
      rawText: 'Cacio e Pepe con Fiori di Zucca',
      quantity: 2,
      unitPrice: 13.50,
      totalPrice: 27.00,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: [],
      claimedQuantities: {}
    },
    {
      id: 'item_3',
      name: 'Amatriciana Tradizionale',
      rawText: 'Amatriciana Tradizionale',
      quantity: 3,
      unitPrice: 13.50,
      totalPrice: 40.50,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: [],
      claimedQuantities: {}
    },
    {
      id: 'item_4',
      name: 'Saltimbocca alla Romana',
      rawText: 'Saltimbocca alla Romana',
      quantity: 2,
      unitPrice: 18.00,
      totalPrice: 36.00,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: [],
      claimedQuantities: {}
    },
    {
      id: 'item_5',
      name: 'Carciofi alla Giudia',
      rawText: 'Carciofi alla Giudia',
      quantity: 4,
      unitPrice: 7.00,
      totalPrice: 28.00,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: [],
      claimedQuantities: {}
    },
    {
      id: 'item_6',
      name: 'Tiramisù Tradizionale',
      rawText: 'Tiramisù Tradizionale',
      quantity: 5,
      unitPrice: 6.00,
      totalPrice: 30.00,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: ['user_me'],
      claimedQuantities: { user_me: 1 }
    },
    {
      id: 'item_7',
      name: 'Vino Rosso della Casa (Caraffa 1L)',
      rawText: 'Vino Rosso della Casa (Caraffa 1L)',
      quantity: 2,
      unitPrice: 16.00,
      totalPrice: 32.00,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: [],
      claimedQuantities: {}
    },
    {
      id: 'item_8',
      name: 'Acqua Minerale Naturale e Frizzante 1L',
      rawText: 'Acqua Minerale Naturale e Frizzante 1L',
      quantity: 4,
      unitPrice: 3.00,
      totalPrice: 12.00,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: [],
      claimedQuantities: {}
    },
    {
      id: 'item_9',
      name: 'Caffè Espresso',
      rawText: 'Caffè Espresso',
      quantity: 7,
      unitPrice: 1.50,
      totalPrice: 10.50,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: [],
      claimedQuantities: {}
    },
    {
      id: 'item_10',
      name: 'Limoncello di Sorrento',
      rawText: 'Limoncello di Sorrento',
      quantity: 6,
      unitPrice: 3.50,
      totalPrice: 21.00,
      vatRate: 10,
      isCoperto: false,
      assignedParticipantIds: [],
      claimedQuantities: {}
    },
    {
      id: 'item_coperto',
      name: 'Coperto & Pane Casereccio (10 persone)',
      rawText: 'Coperto & Pane Casereccio (10 persone)',
      quantity: 10,
      unitPrice: 2.50,
      totalPrice: 25.00,
      vatRate: 10,
      isCoperto: true,
      assignedParticipantIds: [
        'user_me',
        'part_1794074870358_8fnh275y',
        'part_1794074877737_juzu11mt',
        'part_1794074882869_ym527wtp',
        'part_1794074888405_p8596y6',
        'part_1794074913088_bzqlu7ap',
        'part_1794074917295_bi184v0h',
        'part_1794074921325_m0b3qmgm',
        'part_1794074937009_voihz0l',
        'part_1794075007348_0msdu988'
      ],
      claimedQuantities: {}
    }
  ],
  taxSummary: {
    subtotal: 279.00,
    copertoTotal: 25.00,
    totalVat: 28.05,
    serviceCharge: 0,
    discount: 0,
    grandTotal: 304.00
  },
  includedParticipantIds: [
    'user_me',
    'part_1794074870358_8fnh275y',
    'part_1794074877737_juzu11mt',
    'part_1794074882869_ym527wtp',
    'part_1794074888405_p8596y6',
    'part_1794074913088_bzqlu7ap',
    'part_1794074917295_bi184v0h',
    'part_1794074921325_m0b3qmgm',
    'part_1794074937009_voihz0l',
    'part_1794075007348_0msdu988'
  ],
  splitMode: 'by_item'
};

async function reset() {
  const payloadStr = JSON.stringify({
    bill: fresh10PersonBill,
    version: 2,
    updated_at: new Date().toISOString()
  });

  const { error } = await supabase
    .from('bills')
    .update({
      title: payloadStr,
      total_amount: fresh10PersonBill.taxSummary.grandTotal,
      status: 'pending',
      currency: 'EUR'
    })
    .eq('id', TARGET_BILL_ID);

  if (error) {
    console.error('Reset error:', error);
    process.exit(1);
  }

  console.log('✅ Bill reset successfully for interactive testing with 10 phones.');
}

reset();

