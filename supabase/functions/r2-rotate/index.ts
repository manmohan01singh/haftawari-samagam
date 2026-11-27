// r2-rotate — scheduled rotation of expired hosted assets.
// Invocation: POST with header  x-cron-secret: <CRON_SECRET>
// (an admin JWT is also accepted for manual runs). The candidate set
// comes from public.hosted_rotation_candidates() (migration 0005):
// expired assets with a READY replacement whose video is not in an
// upcoming/now_playing session. Each candidate goes through the
// shared rotation routine, which re-checks safety at action time,
// swaps publish state to the replacement video, deletes the expired
// R2 objects, and audit-logs every step. Nothing is ever deleted
// when a check fails — the candidate is reported as skipped.
// If R2 secrets are not configured: 503 {error:'R2_NOT_CONFIGURED'}.
// If CRON_SECRET is not configured and no admin calls: 503
// {error:'CRON_NOT_CONFIGURED'}.

import { CORS_HEADERS, getCaller, json, serviceRest } from "../_shared/auth.ts";
import { getR2Config } from "../_shared/s3.ts";
import { rotateAsset, type RotationCandidate } from "../_shared/rotate.ts";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });

  const cfg = getR2Config();
  if (!cfg) return json(503, { error: "R2_NOT_CONFIGURED" });

  // Authorization: shared cron secret OR an admin's JWT.
  const cronSecret = Deno.env.get("CRON_SECRET");
  const provided = req.headers.get("x-cron-secret");
  let actorId: string | null = null;
  if (cronSecret && provided && provided === cronSecret) {
    actorId = null; // scheduled run; audit entries record actor null + via
  } else {
    const caller = await getCaller(req).catch(() => null);
    if (!caller) {
      return cronSecret
        ? json(401, { error: "UNAUTHENTICATED" })
        : json(503, { error: "CRON_NOT_CONFIGURED" });
    }
    if (caller.role !== "admin") return json(403, { error: "ADMIN_ONLY" });
    actorId = caller.userId;
  }

  try {
    const candidates = await serviceRest<RotationCandidate[]>(
      "POST",
      "/rest/v1/rpc/hosted_rotation_candidates",
      {},
    );
    const rotated: string[] = [];
    const skipped: { asset_id: string; reason: string }[] = [];
    for (const candidate of candidates ?? []) {
      try {
        const outcome = await rotateAsset(cfg, candidate, actorId, "r2-rotate");
        if (outcome.ok) rotated.push(candidate.asset_id);
        else skipped.push({ asset_id: candidate.asset_id, reason: outcome.reason });
      } catch (e) {
        skipped.push({
          asset_id: candidate.asset_id,
          reason: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return json(200, { ok: true, rotated, skipped });
  } catch (e) {
    return json(502, { error: "ROTATE_ERROR", detail: e instanceof Error ? e.message : String(e) });
  }
});
