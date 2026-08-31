/* =========================================================
   khatem-ali-media  —  Cloudflare Worker (R2 media storage)
   ---------------------------------------------------------
   Routes:
     GET  /health                -> status
     GET  /media/<key>           -> serve file from R2
     POST /upload   (Bearer)     -> { url }
     POST /delete   (Bearer)     -> { ok: true }

   REQUIRED Cloudflare settings for this Worker:
     Settings > Bindings > R2 bucket
        Variable name : MEDIA_BUCKET
        Bucket        : khatem-ali-media   (any R2 bucket)
     Settings > Variables and Secrets > Secret
        ADMIN_PASSWORD = your admin password (same value in both Workers)

   NOTE: error 1101 on /media/... means the R2 binding above is missing.
   ========================================================= */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...CORS, ...extra },
  });
}

/* ---- shared token helpers (must match catalog worker) ---- */
async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyToken(request, env) {
  const secret = env.ADMIN_PASSWORD;
  if (!secret) return false;
  const auth = request.headers.get("Authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [expStr, sig] = parts;
  const exp = parseInt(expStr, 10);
  if (!exp || Date.now() > exp) return false;
  return sig === (await hmac(secret, expStr));
}

function extOf(name, type) {
  const m = /\.([a-zA-Z0-9]{2,5})$/.exec(name || "");
  if (m) return m[1].toLowerCase();
  if ((type || "").indexOf("video/") === 0) return "mp4";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

const MIME = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
  gif: "image/gif", avif: "image/avif", mp4: "video/mp4", mov: "video/quicktime",
  webm: "video/webm",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return json({ ok: true, service: "khatem-ali-media", storage: "r2", bucketBound: !!env.MEDIA_BUCKET });
    }

    if (!env.MEDIA_BUCKET) {
      return json({ error: "R2 bucket binding MEDIA_BUCKET is missing on this Worker" }, 500);
    }

    /* ---------- serve media ---------- */
    if (request.method === "GET" && path.startsWith("/media/")) {
      const key = decodeURIComponent(path.slice("/media/".length));
      if (!key) return json({ error: "Invalid media key" }, 400);

      const object = await env.MEDIA_BUCKET.get(key);
      if (!object) return json({ error: "Not found" }, 404);

      const ext = extOf(key, "");
      const headers = new Headers(CORS);
      object.writeHttpMetadata(headers);
      headers.set("Content-Type", object.httpMetadata?.contentType || MIME[ext] || "application/octet-stream");
      headers.set("etag", object.httpEtag);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(object.body, { headers });
    }

    /* ---------- upload ---------- */
    if (request.method === "POST" && path === "/upload") {
      if (!(await verifyToken(request, env))) return json({ error: "Unauthorized" }, 401);

      let form;
      try { form = await request.formData(); } catch { return json({ error: "Invalid form data" }, 400); }

      const file = form.get("file");
      if (!file || typeof file === "string") return json({ error: "No file" }, 400);

      const isVideo = (file.type || "").indexOf("video/") === 0;
      const max = isVideo ? 100 * 1024 * 1024 : 12 * 1024 * 1024;
      if (file.size > max) return json({ error: "File too large" }, 413);
      if (!isVideo && (file.type || "").indexOf("image/") !== 0) {
        return json({ error: "Only images and videos are allowed" }, 415);
      }

      const key = `products/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${extOf(file.name, file.type)}`;
      await env.MEDIA_BUCKET.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
      });

      return json({ ok: true, key, url: `${url.origin}/media/${key}` });
    }

    /* ---------- delete ---------- */
    if (request.method === "POST" && path === "/delete") {
      if (!(await verifyToken(request, env))) return json({ error: "Unauthorized" }, 401);

      let body;
      try { body = await request.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

      const urls = Array.isArray(body?.urls) ? body.urls : [];
      const keys = urls
        .map((u) => {
          try { const p = new URL(u).pathname; return p.startsWith("/media/") ? decodeURIComponent(p.slice("/media/".length)) : null; }
          catch { return null; }
        })
        .filter(Boolean);

      for (const k of keys) await env.MEDIA_BUCKET.delete(k);
      return json({ ok: true, deleted: keys.length });
    }

    return json({ error: "Not found" }, 404);
  },
};
