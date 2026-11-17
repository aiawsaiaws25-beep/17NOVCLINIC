/**
 * Server-side appointment store.
 *
 * Persists to a JSON file (data/appointments.json) so every browser — patients
 * and reception — sees the same appointments. To move to a real database later,
 * re-implement the exported functions with the same signatures.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { HttpError } from './_http.ts';

export type AppointmentStatus = 'pending' | 'booked' | 'arrived' | 'done' | 'no_show' | 'cancelled';

export interface Appointment {
  id: string;
  specialty: string;
  doctor: string;
  /** Clinic-local time (Dubai), "YYYY-MM-DDTHH:mm" */
  appointment_datetime: string;
  patient_name: string;
  patient_phone: string;
  patient_email: string;
  status: AppointmentStatus;
  created_at: string;
  updated_at?: string;
  /** While "pending", the slot is held until this ISO timestamp (covers the Stripe Checkout window). */
  hold_expires_at?: string;
  stripe_session_id?: string;
  paid_at?: string;
}

export const CLINIC_TIMEZONE = 'Asia/Dubai';

export const DOCTORS: Record<string, string> = {
  'General Physician': 'Dr. Sara Ahmed',
  ENT: 'Dr. Omar Khan',
  Dentist: 'Dr. Lina Haddad',
  Cardiologist: 'Dr. Raj Mehta'
};

const OPEN_MINUTES = 9 * 60;
const CLOSE_MINUTES = 21 * 60;
const SLOT_MINUTES = 30;
/** Must outlast the Stripe Checkout Session expiry (31 min). */
export const PENDING_HOLD_MINUTES = 35;

/** Statuses that occupy a slot regardless of time (pending ones only until their hold expires). */
const ACTIVE: AppointmentStatus[] = ['booked', 'arrived', 'done', 'no_show'];

const DATA_FILE = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR, 'appointments.json')
  : fileURLToPath(new URL('../data/appointments.json', import.meta.url));

let cache: Appointment[] | null = null;
let writeChain: Promise<void> = Promise.resolve();

async function load(): Promise<Appointment[]> {
  if (cache) return cache;
  try {
    const parsed: unknown = JSON.parse(await readFile(DATA_FILE, 'utf8'));
    cache = Array.isArray(parsed) ? (parsed as Appointment[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Atomic write (temp file + rename), serialised so concurrent requests can't interleave. */
function persist(): Promise<void> {
  const snapshot = JSON.stringify(cache ?? [], null, 2);
  writeChain = writeChain.then(async () => {
    await mkdir(path.dirname(DATA_FILE), { recursive: true });
    const tmp = `${DATA_FILE}.${process.pid}.tmp`;
    await writeFile(tmp, snapshot, 'utf8');
    await rename(tmp, DATA_FILE);
  });
  return writeChain;
}

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

export function clinicToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: CLINIC_TIMEZONE }).format(now);
}

function clinicNowKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function occupiesSlot(a: Appointment, now = Date.now()): boolean {
  if (ACTIVE.includes(a.status)) return true;
  return a.status === 'pending' && !!a.hold_expires_at && Date.parse(a.hold_expires_at) > now;
}

function slotTaken(all: Appointment[], doctor: string, datetime: string, excludeId?: string): boolean {
  return all.some(a => a.id !== excludeId && a.doctor === doctor && a.appointment_datetime === datetime && occupiesSlot(a));
}

const holdUntil = (): string => new Date(Date.now() + PENDING_HOLD_MINUTES * 60000).toISOString();

function validateSlot(datetime: string): void {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(datetime);
  if (!m) throw new HttpError(400, 'Invalid appointment date/time.');
  const [, y, mo, d, h, mi] = m.map(Number);
  const day = new Date(Date.UTC(y, mo - 1, d));
  if (day.getUTCMonth() !== mo - 1) throw new HttpError(400, 'Invalid appointment date.');
  if (day.getUTCDay() === 0) throw new HttpError(400, 'The clinic is closed on Sundays.');
  const minutes = h * 60 + mi;
  if (minutes < OPEN_MINUTES || minutes >= CLOSE_MINUTES || minutes % SLOT_MINUTES !== 0) {
    throw new HttpError(400, 'Please choose a time slot between 9:00 AM and 8:30 PM.');
  }
  if (datetime <= clinicNowKey()) throw new HttpError(400, 'This time has already passed. Please choose another slot.');
}

export interface NewAppointment {
  specialty: string;
  doctor: string;
  appointment_datetime: string;
  patient_name: string;
  patient_phone: string;
  patient_email: string;
}

export async function createPending(input: NewAppointment): Promise<Appointment> {
  if (DOCTORS[input.specialty] !== input.doctor) throw new HttpError(400, 'Unknown specialty or doctor.');
  validateSlot(input.appointment_datetime);
  if (input.patient_name.length < 2) throw new HttpError(400, 'Please enter the patient name.');
  if (!/^\+?[\d\s()-]{7,}$/.test(input.patient_phone)) throw new HttpError(400, 'Please enter a valid phone number.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.patient_email)) throw new HttpError(400, 'Please enter a valid email.');

  const all = await load();
  if (slotTaken(all, input.doctor, input.appointment_datetime)) {
    throw new HttpError(409, 'This time slot has just been booked. Please choose another time.');
  }
  const appointment: Appointment = {
    id: randomUUID(),
    ...input,
    patient_email: normalizeEmail(input.patient_email),
    status: 'pending',
    created_at: new Date().toISOString(),
    hold_expires_at: holdUntil()
  };
  all.push(appointment);
  await persist();
  return appointment;
}

export async function get(id: string): Promise<Appointment | null> {
  return (await load()).find(a => a.id === id) ?? null;
}

export async function listByEmail(email: string): Promise<Appointment[]> {
  const target = normalizeEmail(email);
  return (await load())
    .filter(a => a.patient_email === target)
    .sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime));
}

export async function listForDate(date: string): Promise<Appointment[]> {
  const now = Date.now();
  return (await load())
    .filter(a => a.appointment_datetime.startsWith(date + 'T') && a.status !== 'cancelled')
    // Abandoned checkouts (pending with an expired hold) are not real appointments.
    .filter(a => a.status !== 'pending' || occupiesSlot(a, now))
    .sort((a, b) => a.appointment_datetime.localeCompare(b.appointment_datetime));
}

export async function bookedTimes(doctor: string, date: string): Promise<string[]> {
  const now = Date.now();
  return (await load())
    .filter(a => a.doctor === doctor && a.appointment_datetime.startsWith(date + 'T') && occupiesSlot(a, now))
    .map(a => a.appointment_datetime.slice(11, 16));
}

async function update(id: string, change: (a: Appointment) => void): Promise<Appointment> {
  const a = (await load()).find(x => x.id === id);
  if (!a) throw new HttpError(404, 'Appointment not found.');
  change(a);
  a.updated_at = new Date().toISOString();
  await persist();
  return a;
}

/** Re-reserves a pending appointment's slot before (re)starting payment. */
export async function renewHold(id: string): Promise<Appointment> {
  const all = await load();
  const a = all.find(x => x.id === id);
  if (!a) throw new HttpError(404, 'Appointment not found.');
  if (a.status !== 'pending') throw new HttpError(409, 'This appointment is no longer awaiting payment.');
  if (slotTaken(all, a.doctor, a.appointment_datetime, id)) {
    throw new HttpError(409, 'Sorry, this time slot is no longer available. Please book a different time.');
  }
  return update(id, x => { x.hold_expires_at = holdUntil(); });
}

export async function setPaymentSession(id: string, sessionId: string): Promise<Appointment> {
  return update(id, a => { a.stripe_session_id = sessionId; });
}

/** Only called by the server after Stripe itself reports payment_status = "paid". */
export async function markPaid(id: string, sessionId: string): Promise<Appointment> {
  return update(id, a => {
    if (a.status !== 'pending') return;
    a.status = 'booked';
    a.stripe_session_id = sessionId;
    a.paid_at = new Date().toISOString();
    delete a.hold_expires_at;
  });
}

export async function cancel(id: string): Promise<Appointment> {
  return update(id, a => {
    if (a.status !== 'pending' && a.status !== 'booked') {
      throw new HttpError(409, 'This appointment can no longer be cancelled online.');
    }
    a.status = 'cancelled';
    delete a.hold_expires_at;
  });
}

export async function setReceptionStatus(id: string, status: 'arrived' | 'done' | 'no_show'): Promise<Appointment> {
  return update(id, a => {
    if (a.status === 'cancelled') throw new HttpError(409, 'This appointment was cancelled.');
    a.status = status;
    delete a.hold_expires_at;
  });
}
