/**
 * Edge function: POST /api/create-checkout-session
 *
 * Creates a Stripe Checkout Session (test mode) for the AED 100 refundable
 * consultation deposit of an existing *pending* appointment, and returns its
 * hosted-checkout URL. Appointment details come from the server-side store,
 * never from the browser.
 *
 * Request JSON: { appointment_id }
 * Response JSON: { id, url }
 */
import * as db from './_db.ts';
import { HttpError, errorResponse, json, readJson, text } from './_http.ts';
import { CHECKOUT_EXPIRY_MINUTES, DEPOSIT, siteOrigin, stripeRequest, type Env } from './_stripe.ts';

interface CheckoutSession {
  id: string;
  url: string | null;
}

export default async function createCheckoutSession(request: Request, env: Env): Promise<Response> {
  try {
    if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    const appointmentId = text((await readJson(request)).appointment_id, 64);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(appointmentId)) throw new HttpError(400, 'Invalid appointment reference.');

    // Re-checks the slot and extends the hold so it outlasts the checkout session.
    const appt = await db.renewHold(appointmentId);

    const origin = siteOrigin(request, env);
    const expiresAt = Math.floor(Date.now() / 1000) + CHECKOUT_EXPIRY_MINUTES * 60;

    const params = new URLSearchParams({
      mode: 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': DEPOSIT.currency,
      'line_items[0][price_data][unit_amount]': String(DEPOSIT.amount),
      'line_items[0][price_data][product_data][name]': DEPOSIT.name,
      'line_items[0][price_data][product_data][description]':
        `${appt.specialty} with ${appt.doctor} on ${appt.appointment_datetime.replace('T', ' at ')} — Lakeside Medical Clinic, JLT`,
      customer_email: appt.patient_email,
      client_reference_id: appt.id,
      'metadata[appointment_id]': appt.id,
      'payment_intent_data[metadata][appointment_id]': appt.id,
      'payment_intent_data[description]': `Consultation deposit — appointment ${appt.id}`,
      success_url: `${origin}/booking-success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/index.html?payment=cancelled&appointment_id=${encodeURIComponent(appt.id)}#book`,
      expires_at: String(expiresAt)
    });

    const session = await stripeRequest<CheckoutSession>(env, 'POST', 'checkout/sessions', params);
    if (!session.url) throw new HttpError(502, 'Stripe did not return a checkout URL.');
    await db.setPaymentSession(appt.id, session.id);

    return json({ id: session.id, url: session.url });
  } catch (e) {
    return errorResponse(e);
  }
}
