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

async function dump() {
  const { data } = await supabase.from('bills').select('id, title').eq('id', '2cd8af15-b665-4421-970f-ccd563bd8fd9');
  const payload = JSON.parse(data[0].title);
  console.log(JSON.stringify(payload.bill, null, 2));
}

dump();

