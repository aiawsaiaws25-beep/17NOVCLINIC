/** Small HTTP helpers shared by all server functions (Web-standard Request/Response). */

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) return json({ error: e.message }, e.status);
  console.error('[functions] unexpected error:', e);
  return json({ error: 'Something went wrong. Please try again.' }, 500);
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!(request.headers.get('content-type') || '').includes('application/json')) {
    throw new HttpError(415, 'Expected a JSON request body.');
  }
  try {
    const body = await request.json();
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new HttpError(400, 'Invalid request body.');
}

export const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');
