/**
 * Read a JSON request body that must be a plain object.
 *
 * Returns null for anything else — unparseable JSON, `null`, an array, a string or a
 * number — so API routes can answer 400 "Invalid data format" instead of destructuring
 * a non-object (a 500) or silently treating it as an empty request (a false 200).
 */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }
  return body as Record<string, unknown>;
}

export function invalidDataResponse(): Response {
  return new Response(JSON.stringify({ error: 'Invalid data format' }), {
    status: 400,
    headers: { 'Content-Type': 'application/json' },
  });
}
