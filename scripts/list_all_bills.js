const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

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

async function listAll() {
  const { data, error } = await supabase.from('bills').select('id, title, total_amount, created_at').order('created_at', { ascending: false });
  if (error) return console.error(error);
  console.log('Total rows in bills:', data.length);
  data.forEach((d, i) => {
    console.log(`[${i}] ID: ${d.id} | created_at: ${d.created_at} | total: ${d.total_amount}`);
    try {
      const p = JSON.parse(d.title);
      console.log(`     q_id: ${p.q_id} | bill.id: ${p.bill?.id} | title: ${p.bill?.title} | items: ${p.bill?.items?.length}`);
    } catch {
      console.log(`     raw title: ${String(d.title).slice(0, 100)}`);
    }
  });
}

listAll();
