// Shared helpers for the R2 Edge Functions: JSON responses, caller
// verification against Supabase Auth, and service-role PostgREST calls.
// No secrets in code: SUPABASE_URL / SUPABASE_ANON_KEY /
// SUPABASE_SERVICE_ROLE_KEY are provided by the Supabase Edge Runtime.

export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export interface Caller {
  userId: string;
  role: "admin" | "member";
}

function supabaseUrl(): string {
  return Deno.env.get("SUPABASE_URL") ?? "";
}

function serviceKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function anonKey(): string {
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

/**
 * Verify the caller's Supabase JWT (Authorization: Bearer <token>) and
 * load their profile role. Returns null for missing/invalid tokens.
 * Role enforcement stays consistent with the app: profiles.role is
 * the truth, exactly as RLS sees it.
 */
export async function getCaller(req: Request): Promise<Caller | null> {
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const userRes = await fetch(`${supabaseUrl()}/auth/v1/user`, {
    headers: { apikey: anonKey(), Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return null;
  const user = (await userRes.json()) as { id?: string };
  if (!user.id) return null;
  const rows = await serviceRest<Array<{ role: string }>>(
    "GET",
    `/rest/v1/profiles?id=eq.${user.id}&select=role`,
  );
  const role = rows && rows[0]?.role === "admin" ? "admin" : "member";
  return { userId: user.id, role };
}

/** Service-role PostgREST call (bypasses RLS — server-side only). */
export async function serviceRest<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T | null> {
  const res = await fetch(`${supabaseUrl()}${path}`, {
    method,
    headers: {
      apikey: serviceKey(),
      Authorization: `Bearer ${serviceKey()}`,
      "Content-Type": "application/json",
      Prefer: method === "POST" ? "return=representation" : "",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Supabase REST ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T | null;
}

/** Append an audit_logs entry (same columns the app writes). */
export async function writeAudit(
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown>,
): Promise<void> {
  await serviceRest("POST", "/rest/v1/audit_logs", {
    actor_id: actorId,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });
}
