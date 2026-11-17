/**
 * Local dev server for Lakeside Medical Clinic.
 *
 *  - Serves the public site files (only whitelisted file types from this folder —
 *    .env, data/, server code and TypeScript sources are never served).
 *  - Runs the edge functions in ./functions at /api/* (same Request -> Response
 *    handlers you would deploy to Supabase / Cloudflare / Vercel edge).
 *  - Appointments are stored server-side in data/appointments.json.
 *  - Reads secrets (STRIPE_SECRET_KEY, RECEPTION_PASSWORD) from .env on each API
 *    call, so changing them does not require a restart.
 *
 * Start: npm start   (then open http://localhost:8080, reception at /reception)
 */
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import createCheckoutSession from './functions/create-checkout-session.ts';
import verifyCheckoutSession from './functions/verify-checkout-session.ts';
import appointments from './functions/appointments.ts';
import reception from './functions/reception.ts';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 16 * 1024;

const FUNCTIONS = {
  '/api/create-checkout-session': createCheckoutSession,
  '/api/verify-checkout-session': verifyCheckoutSession
};

/** Functions that own every path under a prefix. */
const PREFIX_FUNCTIONS = [
  ['/api/appointments', appointments],
  ['/api/reception', reception]
];

function findFunction(pathname) {
  if (FUNCTIONS[pathname]) return FUNCTIONS[pathname];
  const hit = PREFIX_FUNCTIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'));
  return hit ? hit[1] : null;
}

const ROUTES = {
  '/': 'index.html',
  '/booking-success': 'booking-success.html',
  '/reception': 'reception.html'
};

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

async function loadEnv() {
  let fileEnv = {};
  try {
    fileEnv = parseEnv(await readFile(path.join(ROOT, '.env'), 'utf8'));
  } catch {
    // no .env file — fall back to real environment variables
  }
  // Prefer STRIPE_SECRET_KEY; also accept a secret key saved as STRIPE_API_KEY (never a publishable pk_ key).
  const pick = name => process.env[name] || fileEnv[name];
  const legacy = pick('STRIPE_API_KEY');
  return {
    STRIPE_SECRET_KEY: pick('STRIPE_SECRET_KEY') || (legacy && /^(sk|rk)_/.test(legacy) ? legacy : undefined),
    PUBLIC_SITE_URL: pick('PUBLIC_SITE_URL') || `http://localhost:${PORT}`,
    RECEPTION_PASSWORD: pick('RECEPTION_PASSWORD')
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function runFunction(handler, req, res, url) {
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v !== undefined && k !== 'x-client-ip') headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  }
  // Trusted client address for login rate limiting (any incoming value is discarded above).
  headers.set('x-client-ip', req.socket.remoteAddress || 'unknown');
  const request = new Request(url, {
    method: req.method,
    headers,
    body: hasBody ? await readBody(req) : undefined
  });
  const response = await handler(request, await loadEnv());
  const outHeaders = {};
  response.headers.forEach((v, k) => { outHeaders[k] = v; });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) outHeaders['set-cookie'] = cookies;
  res.writeHead(response.status, outHeaders);
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function serveStatic(pathname, res) {
  const fileName = ROUTES[pathname] || decodeURIComponent(pathname.slice(1));
  const ext = path.extname(fileName).toLowerCase();
  // Only plain files at the top level of the site folder, with an allowed extension.
  if (!fileName || fileName.includes('/') || fileName.includes('\\') || fileName.startsWith('.') || !CONTENT_TYPES[ext]) {
    return notFound(res);
  }
  try {
    const data = await readFile(path.join(ROOT, fileName));
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext], 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    notFound(res);
  }
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  try {
    const url = new URL(req.url, `http://${HOST}:${PORT}`);
    const handler = findFunction(url.pathname);
    if (handler) return await runFunction(handler, req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound(res);
    await serveStatic(url.pathname, res);
  } catch (e) {
    console.error('[server] error:', e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Server error' }));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Lakeside Medical Clinic running at http://localhost:${PORT}`);
});
