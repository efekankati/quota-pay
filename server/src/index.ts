import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { ServerGeminiProxy } from './geminiProxy';
import { SupabaseTokenLedger } from './supabaseLedger';

/**
 * Load environment variables from root .env or server/.env if present
 */
function loadDotEnv() {
  const candidates = [
    path.resolve(__dirname, '../../.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(process.cwd(), '.env'),
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf-8');
        for (const rawLine of content.split(/\r?\n/)) {
          const line = rawLine.trim();
          if (!line || line.startsWith('#')) continue;
          const eqIdx = line.indexOf('=');
          if (eqIdx === -1) continue;
          const key = line.slice(0, eqIdx).trim();
          let val = line.slice(eqIdx + 1).trim();
          if (
            (val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))
          ) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      } catch {
        // ignore read error
      }
    }
  }
}

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const SERVER_START_MS = Date.now();

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function readRequestBody(req: http.IncomingMessage, maxBytes = 15 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Request payload too large (max 15MB).'));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    req.on('error', (err: Error) => reject(err));
  });
}

function resolveStaticRoot(): string {
  const candidates = [
    process.env.STATIC_WEB_DIR ? path.resolve(process.env.STATIC_WEB_DIR) : '',
    path.resolve(__dirname, '../../dist'),
    path.resolve(__dirname, '../public'),
    path.resolve(process.cwd(), 'dist'),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(dir) && fs.existsSync(path.join(dir, 'index.html'))) {
      return dir;
    }
  }
  return path.resolve(__dirname, '../../dist');
}

export function createQuotaServer() {
  const staticRoot = resolveStaticRoot();

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method || 'GET';
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;

      // CORS preflight
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        });
        res.end();
        return;
      }

      // 1. Health & FinOps Telemetry Endpoint
      if (method === 'GET' && pathname === '/api/health') {
        const ledger = SupabaseTokenLedger.getLedgerStatusFast();
        const uptimeHours = (Date.now() - SERVER_START_MS) / (1000 * 3600);
        const spotHourlyRate = Number(process.env.SPOT_HOURLY_RATE_USD || 0.005);
        const computeCostUsd = Number((uptimeHours * spotHourlyRate).toFixed(6));

        sendJson(res, 200, {
          status: 'ok',
          service: 'quota-pay-backend',
          region: process.env.AWS_REGION || 'eu-south-1',
          uptimeSeconds: Math.round((Date.now() - SERVER_START_MS) / 1000),
          computeCostUsd,
          ledger,
        });
        return;
      }

      // 2. AI Token Ledger Status Endpoint
      if (method === 'GET' && pathname === '/api/ai/status') {
        const ledger = await SupabaseTokenLedger.getLedgerStatus();
        sendJson(res, 200, ledger);
        return;
      }

      // 3. Multimodal Receipt Parsing Endpoint (/api/ai/parse-receipt)
      if (method === 'POST' && pathname === '/api/ai/parse-receipt') {
        const maxBudget = SupabaseTokenLedger.getMaxBudgetUsd();
        const preCheckLedger = SupabaseTokenLedger.getLedgerStatusFast();

        if (preCheckLedger.budget_exceeded || preCheckLedger.is_paused) {
          sendJson(res, 429, {
            error: 'AI Quota Paused by Administrator',
            budgetExceeded: true,
            ledger: preCheckLedger,
          });
          return;
        }

        const rawBody = await readRequestBody(req);
        const body = JSON.parse(rawBody || '{}');
        const base64Data = String(body.base64Data || body.image || '');
        const mimeType = String(body.mimeType || 'image/jpeg');

        if (!base64Data) {
          sendJson(res, 400, { error: 'Missing required base64Data receipt image payload.' });
          return;
        }

        const { result, usage, modelUsed } = await ServerGeminiProxy.parseReceipt(
          base64Data,
          mimeType
        );

        // Atomically record tokens & cost (0ms in-memory + background Supabase RPC sync)
        const { budgetExceeded, ledger } = await SupabaseTokenLedger.recordGeminiTokens(
          usage.totalTokens,
          usage.estimatedCostUsd,
          maxBudget
        );

        if (budgetExceeded) {
          sendJson(res, 429, {
            error: 'AI Quota Paused by Administrator',
            budgetExceeded: true,
            usage,
            ledger,
          });
          return;
        }

        sendJson(res, 200, {
          result,
          usage,
          modelUsed,
          ledger,
        });
        return;
      }

      // 4. Dynamic UI String Translation Endpoint (/api/ai/translate)
      if (method === 'POST' && pathname === '/api/ai/translate') {
        const maxBudget = SupabaseTokenLedger.getMaxBudgetUsd();
        const preCheckLedger = SupabaseTokenLedger.getLedgerStatusFast();

        if (preCheckLedger.budget_exceeded || preCheckLedger.is_paused) {
          sendJson(res, 429, {
            error: 'AI Quota Paused by Administrator',
            budgetExceeded: true,
            ledger: preCheckLedger,
          });
          return;
        }

        const rawBody = await readRequestBody(req);
        const body = JSON.parse(rawBody || '{}');
        const text = String(body.text || '');
        const targetLang = String(body.targetLang || 'en');

        if (!text.trim()) {
          sendJson(res, 200, { translatedText: text, usage: { totalTokens: 0, estimatedCostUsd: 0 } });
          return;
        }

        const { translatedText, usage, modelUsed } = await ServerGeminiProxy.translateText(
          text,
          targetLang
        );

        const { budgetExceeded, ledger } = await SupabaseTokenLedger.recordGeminiTokens(
          usage.totalTokens,
          usage.estimatedCostUsd,
          maxBudget
        );

        if (budgetExceeded) {
          sendJson(res, 429, {
            error: 'AI Quota Paused by Administrator',
            budgetExceeded: true,
            usage,
            ledger,
          });
          return;
        }

        sendJson(res, 200, {
          translatedText,
          usage,
          modelUsed,
          ledger,
        });
        return;
      }

      // 5. Static Web Application Serving (with SPA Deep-Link Routing)
      if (method === 'GET' || method === 'HEAD') {
        const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
        let targetFile = path.join(staticRoot, safePath);

        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
          targetFile = path.join(targetFile, 'index.html');
        }

        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
          const ext = path.extname(targetFile).toLowerCase();
          const contentType = MIME_TYPES[ext] || 'application/octet-stream';
          res.writeHead(200, { 'Content-Type': contentType });
          if (method === 'HEAD') {
            res.end();
          } else {
            fs.createReadStream(targetFile).pipe(res);
          }
          return;
        }

        // SPA fallback to index.html for client-side routes (/bill/*, /pay/*, etc.)
        const indexHtml = path.join(staticRoot, 'index.html');
        if (fs.existsSync(indexHtml)) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          if (method === 'HEAD') {
            res.end();
          } else {
            fs.createReadStream(indexHtml).pipe(res);
          }
          return;
        }

        sendJson(res, 200, {
          name: 'Quota Pay Backend & Gemini AI Proxy',
          status: 'running',
          endpoints: [
            'GET /api/health',
            'GET /api/ai/status',
            'POST /api/ai/parse-receipt',
            'POST /api/ai/translate',
          ],
        });
        return;
      }

      sendJson(res, 404, { error: 'Not Found' });
    } catch (err: any) {
      console.error('[QuotaPayServer] Request error:', err);
      sendJson(res, 500, {
        error: err?.message || 'Internal Server Error',
      });
    }
  });

  return server;
}

if (require.main === module) {
  const server = createQuotaServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(
      `[QuotaPayServer] Listening on http://0.0.0.0:${PORT} (Max AI Budget: $${SupabaseTokenLedger.getMaxBudgetUsd().toFixed(2)})`
    );
  });
}
