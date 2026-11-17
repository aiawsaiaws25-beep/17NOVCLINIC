/**
 * Stripe helpers for the server-side payment functions.
 * Runs ONLY on the server — this is the only place the Stripe secret key is used.
 */
import { HttpError } from './_http.ts';

export interface Env {
  /** Stripe secret TEST key (sk_test_…). Read from project secrets / .env, never sent to the browser. */
  STRIPE_SECRET_KEY?: string;
  /** Public origin of the site, e.g. http://localhost:8080 — used to build Stripe redirect URLs. */
  PUBLIC_SITE_URL?: string;
  /** Password for the reception dashboard. */
  RECEPTION_PASSWORD?: string;
}

/** Fixed server-side so the browser can never change the amount. */
export const DEPOSIT = {
  amount: 10000, // AED 100.00 in fils
  currency: 'aed',
  name: 'Refundable consultation deposit'
} as const;

/** Stripe requires 30 min minimum; the slot is held slightly longer (35 min). */
export const CHECKOUT_EXPIRY_MINUTES = 31;

function secretKey(env: Env): string {
  const key = env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new HttpError(503, 'Payments are not configured yet (STRIPE_SECRET_KEY is missing on the server).');
  }
  if (!/^(sk|rk)_test_/.test(key)) {
    throw new HttpError(503, 'Payments are locked to Stripe test mode — STRIPE_SECRET_KEY must be a sk_test_ key.');
  }
  return key;
}

export async function stripeRequest<T>(
  env: Env,
  method: 'GET' | 'POST',
  path: string,
  params?: URLSearchParams
): Promise<T> {
  const key = secretKey(env);
  const query = method === 'GET' && params ? `?${params.toString()}` : '';
  const res = await fetch(`https://api.stripe.com/v1/${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: method === 'POST' && params ? params.toString() : undefined
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    console.error(`[stripe] ${method} ${path} failed (${res.status}):`, data.error?.message);
    if (res.status === 404) throw new HttpError(404, 'Payment session not found.');
    throw new HttpError(502, 'The payment provider returned an error. Please try again.');
  }
  return data as T;
}

export function siteOrigin(request: Request, env: Env): string {
  return (env.PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/+$/, '');
}
