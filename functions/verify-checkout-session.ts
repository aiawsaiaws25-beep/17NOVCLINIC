/**
 * Edge function: GET /api/verify-checkout-session?session_id=cs_test_…
 *
 * Retrieves the Checkout Session directly from Stripe (never trusting the
 * browser redirect). Only if Stripe reports payment_status = "paid" does the
 * server set the appointment to "booked"; otherwise it stays "pending".
 *
 * Response JSON: { paid, payment_status, status, amount_total, currency, appointment }
 */
import * as db from './_db.ts';
import { HttpError, errorResponse, json } from './_http.ts';
import { stripeRequest, type Env } from './_stripe.ts';

interface CheckoutSession {
  id: string;
  status: 'open' | 'complete' | 'expired' | null;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  client_reference_id: string | null;
  amount_total: number | null;
  currency: string | null;
  metadata: Record<string, string> | null;
}

const SESSION_ID_RE = /^cs_test_[A-Za-z0-9]{10,250}$/;

export default async function verifyCheckoutSession(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method !== 'GET') throw new HttpError(405, 'Method not allowed.');

    const sessionId = new URL(request.url).searchParams.get('session_id') || '';
    if (!SESSION_ID_RE.test(sessionId)) throw new HttpError(400, 'Invalid payment session reference.');

    const session = await stripeRequest<CheckoutSession>(env, 'GET', `checkout/sessions/${encodeURIComponent(sessionId)}`);
    const appointmentId = session.client_reference_id || session.metadata?.appointment_id || '';
    const paid = session.payment_status === 'paid';

    let appointment = appointmentId ? await db.get(appointmentId) : null;
    if (appointment && paid) appointment = await db.markPaid(appointment.id, session.id);

    return json({
      session_id: session.id,
      paid,
      payment_status: session.payment_status,
      status: session.status,
      amount_total: session.amount_total,
      currency: session.currency,
      appointment
    });
  } catch (e) {
    return errorResponse(e);
  }
}
