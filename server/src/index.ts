import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { pipeline } from 'stream';
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
export const MAX_RECEIPT_BODY_BYTES = 10 * 1024 * 1024; // Strict 10MB payload limit
const MAX_TRANSLATE_BODY_BYTES = 64 * 1024; // 64KB limit for UI string translation

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

const COMPRESSIBLE_EXTENSIONS = new Set([
  '.html',
  '.js',
  '.mjs',
  '.css',
  '.json',
  '.svg',
]);

const IMMUTABLE_ASSET_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.css',
  '.woff',
  '.woff2',
  '.ttf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.ico',
]);

class PayloadTooLargeError extends Error {
  public readonly statusCode = 413;
  constructor(maxBytes: number) {
    super(`Request payload too large (max ${Math.round(maxBytes / (1024 * 1024))}MB).`);
    this.name = 'PayloadTooLargeError';
  }
}

function sendJson(res: http.ServerResponse, statusCode: number, payload: unknown) {
  if (res.headersSent) return;
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function readRequestBody(
  req: http.IncomingMessage,
  maxBytes = MAX_RECEIPT_BODY_BYTES,
  timeoutMs = 15000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const declaredLength = Number(req.headers['content-length'] || 0);
    if (declaredLength > maxBytes) {
      req.resume();
      reject(new PayloadTooLargeError(maxBytes));
      return;
    }

    let chunks: Buffer[] = [];
    let total = 0;
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      chunks = [];
      req.destroy();
      reject(new Error('Request body read timed out.'));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
    };

    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > maxBytes) {
        settled = true;
        cleanup();
        chunks = [];
        req.destroy();
        reject(new PayloadTooLargeError(maxBytes));
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (settled) return;
      settled = true;
      cleanup();
      const combined = Buffer.concat(chunks, total).toString('utf-8');
      chunks = [];
      resolve(combined);
    });

    req.on('error', (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      chunks = [];
      reject(err);
    });
  });
}

function streamStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  filePath: string,
  pathname: string,
  isSpaFallback: boolean
) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  const isImmutableAsset =
    !isSpaFallback &&
    ext !== '.html' &&
    (pathname.startsWith('/_expo/static/') ||
      pathname.startsWith('/assets/') ||
      IMMUTABLE_ASSET_EXTENSIONS.has(ext));

  const cacheControl = isImmutableAsset
    ? 'public, max-age=31536000, immutable'
    : 'no-cache, no-store, must-revalidate';

  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Cache-Control': cacheControl,
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Accept-Encoding',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  const shouldCompress = COMPRESSIBLE_EXTENSIONS.has(ext);
  const rawStream = fs.createReadStream(filePath);

  if (shouldCompress && /\bbr\b/.test(acceptEncoding)) {
    headers['Content-Encoding'] = 'br';
    res.writeHead(200, headers);
    const brotli = zlib.createBrotliCompress({
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: 4,
      },
    });
    pipeline(rawStream, brotli, res, (err: Error | null) => {
      if (err && !res.headersSent) {
        res.destroy();
      }
    });
    return;
  }

  if (shouldCompress && /\bgzip\b/.test(acceptEncoding)) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    const gzip = zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED });
    pipeline(rawStream, gzip, res, (err: Error | null) => {
      if (err && !res.headersSent) {
        res.destroy();
      }
    });
    return;
  }

  res.writeHead(200, headers);
  pipeline(rawStream, res, (err: Error | null) => {
    if (err && !res.headersSent) {
      res.destroy();
    }
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
        const memUsage = process.memoryUsage();

        sendJson(res, 200, {
          status: 'ok',
          service: 'quota-pay-backend',
          region: process.env.AWS_REGION || 'eu-south-1',
          uptimeSeconds: Math.round((Date.now() - SERVER_START_MS) / 1000),
          memoryRssMb: Math.round((memUsage.rss / (1024 * 1024)) * 10) / 10,
          heapUsedMb: Math.round((memUsage.heapUsed / (1024 * 1024)) * 10) / 10,
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

        let rawBody: string | null = await readRequestBody(req, MAX_RECEIPT_BODY_BYTES);
        let body: any = JSON.parse(rawBody || '{}');
        rawBody = null; // Release raw string buffer early for GC

        let base64Data: string | null = String(body.base64Data || body.image || '');
        const mimeType = String(body.mimeType || 'image/jpeg');
        body = null;

        if (!base64Data) {
          sendJson(res, 400, { error: 'Missing required base64Data receipt image payload.' });
          return;
        }

        const { result, usage, modelUsed } = await ServerGeminiProxy.parseReceipt(
          base64Data,
          mimeType
        );
        base64Data = null; // Allow GC to reclaim base64 payload immediately

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

        const rawBody = await readRequestBody(req, MAX_TRANSLATE_BODY_BYTES);
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
        // Never serve source maps in production
        if (pathname.endsWith('.map') && process.env.NODE_ENV === 'production') {
          sendJson(res, 404, { error: 'Source maps are disabled in production.' });
          return;
        }

        const safePath = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
        let targetFile = path.join(staticRoot, safePath);

        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isDirectory()) {
          targetFile = path.join(targetFile, 'index.html');
        }

        if (fs.existsSync(targetFile) && fs.statSync(targetFile).isFile()) {
          streamStaticFile(req, res, targetFile, pathname, false);
          return;
        }

        // SPA fallback to index.html for client-side routes (/bill/*, /pay/*, etc.)
        const indexHtml = path.join(staticRoot, 'index.html');
        if (fs.existsSync(indexHtml)) {
          streamStaticFile(req, res, indexHtml, pathname, true);
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
      if (err instanceof PayloadTooLargeError || err?.statusCode === 413) {
        sendJson(res, 413, {
          error: err.message || 'Payload Too Large (max 10MB).',
        });
        return;
      }
      console.error('[QuotaPayServer] Request error:', err);
      sendJson(res, 500, {
        error: err?.message || 'Internal Server Error',
      });
    }
  });

  // Prevent dangling sockets and slowloris connection leaks
  server.keepAliveTimeout = 30000;
  server.headersTimeout = 35000;
  server.requestTimeout = 30000;

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
