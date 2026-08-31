/* =========================================================
   khatem-ali-catalog — Cloudflare Worker (login + catalog)
   ---------------------------------------------------------
   Routes:
     GET  /health              -> status
     POST /auth  {password}    -> { token }
     GET  /catalog             -> published catalog JSON
     PUT  /catalog  (Bearer)   -> save catalog JSON

   REQUIRED Cloudflare settings for this Worker:
     Settings > Bindings > R2 bucket
        Variable name : CATALOG_BUCKET
        Bucket        : khatem-ali-catalog   (any R2 bucket)
     Settings > Variables and Secrets > Secret
        ADMIN_PASSWORD = your admin password (same value in both Workers)

   NOTE: error 1101 on /catalog means the R2 binding above is missing.
   ========================================================= */

const CATALOG_KEY = "catalog.json";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
  });
}

/* ---- shared token helpers (must match media worker) ---- */
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function makeToken(secret) {
  const exp = String(Date.now() + TOKEN_TTL_MS);
  return `${exp}.${await hmac(secret, exp)}`;
}

async function verifyToken(request, env) {
  const secret = env.ADMIN_PASSWORD;
  if (!secret) return false;
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const exp = parseInt(parts[0], 10);
  if (!exp || Date.now() > exp) return false;
  return parts[1] === (await hmac(secret, parts[0]));
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const path = new URL(request.url).pathname;

    if (path === "/health") {
      return json({ ok: true, service: "khatem-ali-catalog", bucketBound: !!env.CATALOG_BUCKET, secretSet: !!env.ADMIN_PASSWORD });
    }

    /* ---------- login ---------- */
    if (request.method === "POST" && path === "/auth") {
      if (!env.ADMIN_PASSWORD) return json({ error: "ADMIN_PASSWORD secret is not set on this Worker" }, 500);

      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

      const password = typeof body?.password === "string" ? body.password.trim() : "";
      if (!password || !timingSafeEqual(password, env.ADMIN_PASSWORD.trim())) {
        return json({ error: "Invalid password" }, 401);
      }
      return json({ ok: true, token: await makeToken(env.ADMIN_PASSWORD) });
    }

    if (!env.CATALOG_BUCKET) {
      return json({ error: "R2 bucket binding CATALOG_BUCKET is missing on this Worker" }, 500);
    }

    /* ---------- read catalog ---------- */
    if (request.method === "GET" && path === "/catalog") {
      const object = await env.CATALOG_BUCKET.get(CATALOG_KEY);
      if (!object) return json({ categories: [], products: [], updatedAt: null });
      return new Response(object.body, {
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS },
      });
    }

    /* ---------- publish catalog ---------- */
    if (request.method === "PUT" && path === "/catalog") {
      if (!(await verifyToken(request, env))) return json({ error: "Unauthorized" }, 401);

      let payload;
      try { payload = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
      if (!payload || !Array.isArray(payload.products)) return json({ error: "Invalid catalog payload" }, 400);

      const saved = {
        categories: Array.isArray(payload.categories) ? payload.categories : [],
        products: payload.products,
        updatedAt: new Date().toISOString(),
      };

      await env.CATALOG_BUCKET.put(CATALOG_KEY, JSON.stringify(saved, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      });

      return json({ ok: true, updatedAt: saved.updatedAt, count: saved.products.length });
    }

    return json({ error: "Not found" }, 404);
  },
};
