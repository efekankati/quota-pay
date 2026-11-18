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

async function check() {
  const { data, error } = await supabase
    .from('bills')
    .select('id, created_at, total_amount, title')
    .ilike('title', '%2cd8af15-b665-4421-970f-ccd563bd8fd9%')
    .order('created_at', { ascending: false });

  if (error) {
    console.error(error);
    return;
  }
  console.log('Matches count:', data.length);
  data.forEach((d, idx) => {
    console.log(`Match ${idx} -> id: ${d.id}, created_at: ${d.created_at}, total_amount: ${d.total_amount}`);
  });
}

check();

