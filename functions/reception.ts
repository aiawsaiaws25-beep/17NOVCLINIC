/**
 * Edge function: /api/reception/*  (password-protected staff dashboard API)
 *
 *   POST /api/reception/login   { password }      -> sets an HttpOnly session cookie
 *   POST /api/reception/logout
 *   GET  /api/reception/session                   -> { authenticated }
 *   GET  /api/reception/today                     -> { date, count, appointments }
 *   POST /api/reception/appointments/:id/status   { status: "arrived" | "done" | "no_show" }
 *
 * The password lives only in the server environment (RECEPTION_PASSWORD).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import * as db from './_db.ts';
import { HttpError, errorResponse, json, readJson, text } from './_http.ts';
import type { Env } from './_stripe.ts';

const COOKIE = 'reception_session';
const SESSION_HOURS = 12;
const MAX_FAILURES = 5;
const LOCKOUT_MINUTES = 15;
const RECEPTION_STATUSES = ['arrived', 'done', 'no_show'] as const;
type ReceptionStatus = (typeof RECEPTION_STATUSES)[number];

// In-memory: staff simply log in again after a server restart.
const sessions = new Map<string, number>();
const failures = new Map<string, { count: number; until: number }>();

const sha256 = (s: string): Buffer => createHash('sha256').update(s, 'utf8').digest();

function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected));
}

function cookieValue(request: Request, name: string): string {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function isAuthenticated(request: Request): boolean {
  const token = cookieValue(request, COOKIE);
  const expires = token ? sessions.get(token) : undefined;
  if (!expires) return false;
  if (expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

const sessionCookie = (token: string, maxAge: number): string =>
  `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/api/reception; Max-Age=${maxAge}`;

async function login(request: Request, env: Env): Promise<Response> {
  const expected = env.RECEPTION_PASSWORD;
  if (!expected) throw new HttpError(503, 'Reception login is not configured (RECEPTION_PASSWORD missing on the server).');

  const client = request.headers.get('x-client-ip') || 'unknown';
  const now = Date.now();
  let record = failures.get(client);
  if (record && record.until > now) {
    throw new HttpError(429, `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minutes.`);
  }
  if (record && record.until) record = undefined; // previous lockout has expired

  const password = text((await readJson(request)).password, 200);
  if (!password || !passwordMatches(password, expected)) {
    const count = (record?.count ?? 0) + 1;
    failures.set(client, { count, until: count >= MAX_FAILURES ? now + LOCKOUT_MINUTES * 60000 : 0 });
    throw new HttpError(401, 'Incorrect password.');
  }

  failures.delete(client);
  const token = randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_HOURS * 3600000);
  return json({ authenticated: true }, 200, { 'Set-Cookie': sessionCookie(token, SESSION_HOURS * 3600) });
}

export default async function reception(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const route = url.pathname.replace(/^\/api\/reception\/?/, '');
    const method = request.method;

    if (route === 'login' && method === 'POST') return await login(request, env);

    if (route === 'logout' && method === 'POST') {
      sessions.delete(cookieValue(request, COOKIE));
      return json({ authenticated: false }, 200, { 'Set-Cookie': sessionCookie('', 0) });
    }

    if (route === 'session' && method === 'GET') return json({ authenticated: isAuthenticated(request) });

    if (!isAuthenticated(request)) throw new HttpError(401, 'Please log in to the reception dashboard.');

    if (route === 'today' && method === 'GET') {
      const date = db.clinicToday();
      const appointments = await db.listForDate(date);
      return json({ date, count: appointments.length, doctors: db.DOCTORS, appointments });
    }

    const m = /^appointments\/([A-Za-z0-9-]{8,64})\/status$/.exec(route);
    if (m && method === 'POST') {
      const status = text((await readJson(request)).status, 20) as ReceptionStatus;
      if (!RECEPTION_STATUSES.includes(status)) throw new HttpError(400, 'Invalid status.');
      return json({ appointment: await db.setReceptionStatus(m[1], status) });
    }

    throw new HttpError(404, 'Not found.');
  } catch (e) {
    return errorResponse(e);
  }
}
