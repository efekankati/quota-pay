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

async function inspect() {
  const { data, error } = await supabase.from('bills').select('*').eq('id', '2cd8af15-b665-4421-970f-ccd563bd8fd9').single();
  if (error) {
    console.error(error);
    return;
  }
  const payload = JSON.parse(data.title);
  const b = payload.bill;
  console.log('Bill ID:', b.id);
  console.log('Title:', b.title, '| Restaurant:', b.restaurantName);
  console.log('GrandTotal:', b.taxSummary?.grandTotal, '| copertoPerPerson:', b.copertoPerPerson);
  console.log('Items:');
  b.items.forEach(it => {
    console.log(`  - [${it.id}] ${it.quantity}x "${it.name}" @ €${it.unitPrice} = €${it.totalPrice} (isCoperto: ${it.isCoperto})`);
    console.log(`    claimedQuantities:`, it.claimedQuantities);
    console.log(`    assignedParticipantIds:`, it.assignedParticipantIds);
  });
  console.log('Participants:');
  b.participants.forEach(p => {
    console.log(`  - [${p.id}] ${p.name} (isOrg: ${p.isOrganizer}): status=${p.status}, paidAmount=€${p.paidAmount}`);
  });
}

inspect();
