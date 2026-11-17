/**
 * Edge function: /api/appointments/*  (patient-facing)
 *
 *   GET  /api/appointments/booked-times?doctor=…&date=YYYY-MM-DD  -> { times: ["HH:mm", …] }
 *   GET  /api/appointments?email=…                                 -> { appointments: [...] }
 *   POST /api/appointments                                         -> { appointment }  (status "pending")
 *   GET  /api/appointments/:id                                     -> { appointment }
 *   POST /api/appointments/:id/cancel                              -> { appointment }
 */
import * as db from './_db.ts';
import { HttpError, errorResponse, json, readJson, text } from './_http.ts';

const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function appointments(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/api\/appointments\/?/, '').split('/').filter(Boolean);
    const method = request.method;

    if (parts.length === 0) {
      if (method === 'GET') {
        const email = text(url.searchParams.get('email'), 254);
        if (!EMAIL_RE.test(email)) throw new HttpError(400, 'A valid email is required.');
        return json({ appointments: await db.listByEmail(email) });
      }
      if (method === 'POST') {
        const b = await readJson(request);
        const appointment = await db.createPending({
          specialty: text(b.specialty, 60),
          doctor: text(b.doctor, 80),
          appointment_datetime: text(b.appointment_datetime, 16),
          patient_name: text(b.patient_name, 100),
          patient_phone: text(b.patient_phone, 30),
          patient_email: text(b.patient_email, 254)
        });
        return json({ appointment }, 201);
      }
      throw new HttpError(405, 'Method not allowed.');
    }

    if (parts[0] === 'booked-times' && parts.length === 1 && method === 'GET') {
      const doctor = text(url.searchParams.get('doctor'), 80);
      const date = text(url.searchParams.get('date'), 10);
      if (!doctor || !DATE_RE.test(date)) throw new HttpError(400, 'doctor and date are required.');
      return json({ times: await db.bookedTimes(doctor, date) });
    }

    const id = parts[0];
    if (!ID_RE.test(id)) throw new HttpError(404, 'Not found.');

    if (parts.length === 1 && method === 'GET') {
      const appointment = await db.get(id);
      if (!appointment) throw new HttpError(404, 'Appointment not found.');
      return json({ appointment });
    }
    if (parts.length === 2 && parts[1] === 'cancel' && method === 'POST') {
      return json({ appointment: await db.cancel(id) });
    }
    throw new HttpError(404, 'Not found.');
  } catch (e) {
    return errorResponse(e);
  }
}
