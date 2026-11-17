/**
 * Storage layer for appointments, users and the login session.
 *
 * All data access for the site lives in this file:
 *  - Appointments are stored on our own server (data/appointments.json) via the
 *    /api/appointments endpoints, so patients and reception share the same data.
 *  - Patient accounts ("users") and the login "session" stay in this browser's
 *    localStorage (demo mode).
 * To move to a real database / auth provider later, re-implement the functions
 * below (keeping the same signatures) â€” the rest of the site only talks to
 * `AppointmentStore` and `AuthStore`.
 *
 * Build: `npm run build` compiles this file to storage.js, which the pages load.
 */

type AppointmentStatus = 'pending' | 'booked' | 'arrived' | 'done' | 'no_show' | 'cancelled';

interface Appointment {
  id: string;
  specialty: string;
  doctor: string;
  /** Clinic-local time (Dubai), "YYYY-MM-DDTHH:mm" */
  appointment_datetime: string;
  patient_name: string;
  patient_phone: string;
  patient_email: string;
  status: AppointmentStatus;
  /** ISO 8601 timestamp */
  created_at: string;
  updated_at?: string;
  /** While "pending", the slot is held until this ISO timestamp (covers the Stripe Checkout window). */
  hold_expires_at?: string;
  /** Latest Stripe Checkout Session created for the deposit */
  stripe_session_id?: string;
  /** Set by the server once Stripe confirms the deposit was paid */
  paid_at?: string;
}

type NewAppointment = Pick<
  Appointment,
  'specialty' | 'doctor' | 'appointment_datetime' | 'patient_name' | 'patient_phone' | 'patient_email'
>;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (window.location.protocol === 'file:') {
    throw new Error('This site needs its server. Run "npm start" and open http://localhost:8080.');
  }
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) }
    });
  } catch {
    throw new Error('Could not reach the server. Please check your connection and try again.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function generateId(): string {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

const AppointmentStore = {
  async get(id: string): Promise<Appointment | null> {
    try {
      return (await api<{ appointment: Appointment }>(`/api/appointments/${encodeURIComponent(id)}`)).appointment;
    } catch {
      return null;
    }
  },

  /** Creates a "pending" appointment that holds its slot while the deposit is paid. */
  async createPending(input: NewAppointment): Promise<Appointment> {
    const res = await api<{ appointment: Appointment }>('/api/appointments', {
      method: 'POST',
      body: JSON.stringify(input)
    });
    return res.appointment;
  },

  async cancel(id: string): Promise<Appointment> {
    const res = await api<{ appointment: Appointment }>(`/api/appointments/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
      body: '{}'
    });
    return res.appointment;
  },

  /** Returns "HH:mm" times taken (booked, or held while payment is pending) for a doctor on a date ("YYYY-MM-DD"). */
  async bookedTimes(doctor: string, date: string): Promise<string[]> {
    const q = new URLSearchParams({ doctor, date });
    return (await api<{ times: string[] }>(`/api/appointments/booked-times?${q}`)).times;
  },

  /** All appointments for a patient email (case-insensitive), soonest first. */
  async listByEmail(email: string): Promise<Appointment[]> {
    const q = new URLSearchParams({ email });
    return (await api<{ appointments: Appointment[] }>(`/api/appointments?${q}`)).appointments;
  }
};

/* ------------------------------------------------------------------ */
/* Users & session                                                     */
/* ------------------------------------------------------------------ */

interface User {
  id: string;
  name: string;
  email: string;
  /** PBKDF2-SHA256 hash (hex). Plain-text passwords are never stored. */
  password_hash: string;
  /** Random per-user salt (hex) */
  password_salt: string;
  created_at: string;
}

/** Public view of a user â€” never exposes the password hash. */
type SessionUser = Pick<User, 'id' | 'name' | 'email'>;

interface Session {
  user: SessionUser;
  created_at: string;
}

const USERS_KEY = 'users';
const SESSION_KEY = 'session';
const PBKDF2_ITERATIONS = 100000;

/** Demo account, created automatically in each browser so the site can be tried right away. */
const DEMO_USER = { name: 'Demo Patient', email: 'demo@lakeside.ae', password: 'Demo1234' };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function readUsers(): User[] {
  try {
    const raw = window.localStorage.getItem(USERS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as User[]) : [];
  } catch {
    return [];
  }
}

function writeUsers(users: User[]): void {
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
}

const toHex = (buf: ArrayBuffer | Uint8Array): string =>
  Array.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');

const fromHex = (hex: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array((hex.match(/.{2}/g) || []).map(h => parseInt(h, 16)));

async function hashPassword(password: string, saltHex: string): Promise<string> {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error('Secure password hashing is not available in this browser.');
  }
  const key = await window.crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await window.crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    key,
    256
  );
  return toHex(bits);
}

function toSessionUser(u: User): SessionUser {
  return { id: u.id, name: u.name, email: u.email };
}

function startSession(user: SessionUser): Session {
  const session: Session = { user, created_at: new Date().toISOString() };
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return session;
}

async function ensureDemoUser(): Promise<void> {
  const users = readUsers();
  if (users.some(u => u.email === DEMO_USER.email)) return;
  const salt = toHex(window.crypto.getRandomValues(new Uint8Array(16)));
  users.push({
    id: generateId(),
    name: DEMO_USER.name,
    email: DEMO_USER.email,
    password_hash: await hashPassword(DEMO_USER.password, salt),
    password_salt: salt,
    created_at: new Date().toISOString()
  });
  writeUsers(users);
}

const AuthStore = {
  demoCredentials: { email: DEMO_USER.email, password: DEMO_USER.password },

  async signUp(input: { name: string; email: string; password: string }): Promise<SessionUser> {
    await ensureDemoUser();
    const email = normalizeEmail(input.email);
    const users = readUsers();
    if (users.some(u => u.email === email)) {
      throw new Error('An account with this email already exists. Please log in.');
    }
    const salt = toHex(window.crypto.getRandomValues(new Uint8Array(16)));
    const user: User = {
      id: generateId(),
      name: input.name.trim(),
      email,
      password_hash: await hashPassword(input.password, salt),
      password_salt: salt,
      created_at: new Date().toISOString()
    };
    users.push(user);
    writeUsers(users);
    const sessionUser = toSessionUser(user);
    startSession(sessionUser);
    return sessionUser;
  },

  async logIn(emailInput: string, password: string): Promise<SessionUser> {
    const email = normalizeEmail(emailInput);
    if (email === DEMO_USER.email) await ensureDemoUser();
    const user = readUsers().find(u => u.email === email);
    const hash = user ? await hashPassword(password, user.password_salt) : '';
    if (!user || hash !== user.password_hash) {
      throw new Error('Incorrect email or password.');
    }
    const sessionUser = toSessionUser(user);
    startSession(sessionUser);
    return sessionUser;
  },

  async logOut(): Promise<void> {
    window.localStorage.removeItem(SESSION_KEY);
  },

  /** Synchronous so pages can decide what to render immediately. */
  currentUser(): SessionUser | null {
    try {
      const raw = window.localStorage.getItem(SESSION_KEY);
      const session = raw ? (JSON.parse(raw) as Session) : null;
      return session && session.user ? session.user : null;
    } catch {
      return null;
    }
  }
};

const w = window as unknown as {
  AppointmentStore: typeof AppointmentStore;
  AuthStore: typeof AuthStore;
};
w.AppointmentStore = AppointmentStore;
w.AuthStore = AuthStore;
