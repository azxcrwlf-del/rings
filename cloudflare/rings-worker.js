/*
 * rings — combined Cloudflare Worker for the website catalog and R2 media
 * Required bindings:
 *   MEDIA_BUCKET  -> R2 bucket rings media bucket
 *   CATALOG_BUCKET -> R2 bucket rings catalog bucket
 * Required secret:
 *   ADMIN_PASSWORD -> same private password used by the admin panel
 */

const CATALOG_KEY = "catalog.json";
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...CORS,
    },
  });
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

async function makeToken(secret) {
  const expires = String(Date.now() + TOKEN_TTL_MS);
  return expires + "." + await hmac(secret, expires);
}

async function verifyToken(request, env) {
  const secret = env.ADMIN_PASSWORD;
  if (!secret) return false;
  const token = (request.headers.get("Authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const expires = parseInt(parts[0], 10);
  if (!expires || Date.now() > expires) return false;
  const expected = await hmac(secret, parts[0]);
  return timingSafeEqual(parts[1], expected);
}

function extensionFor(name, type) {
  const match = /\.([a-zA-Z0-9]{2,5})$/.exec(name || "");
  if (match) return match[1].toLowerCase();
  if ((type || "").startsWith("video/")) return "mp4";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return "jpg";
}

const MIME = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    if (path === "/health") {
      return json({
        ok: true,
        service: "rings",
        mediaBucketBound: !!env.MEDIA_BUCKET,
        catalogBucketBound: !!env.CATALOG_BUCKET,
        secretSet: !!env.ADMIN_PASSWORD,
      });
    }

    if (path === "/auth" && request.method === "POST") {
      if (!env.ADMIN_PASSWORD) {
        return json({ error: "ADMIN_PASSWORD secret is not set" }, 500);
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const password = typeof body?.password === "string"
        ? body.password.trim()
        : "";
      if (!password || !timingSafeEqual(password, env.ADMIN_PASSWORD.trim())) {
        return json({ error: "Invalid password" }, 401);
      }
      return json({ ok: true, token: await makeToken(env.ADMIN_PASSWORD) });
    }

    if (path === "/catalog" && request.method === "GET") {
      if (!env.CATALOG_BUCKET) {
        return json({ error: "CATALOG_BUCKET binding is missing" }, 500);
      }
      const object = await env.CATALOG_BUCKET.get(CATALOG_KEY);
      if (!object) return json({ categories: [], products: [], updatedAt: null });
      return new Response(object.body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          ...CORS,
        },
      });
    }

    if (path === "/catalog" && request.method === "PUT") {
      if (!env.CATALOG_BUCKET) {
        return json({ error: "CATALOG_BUCKET binding is missing" }, 500);
      }
      if (!(await verifyToken(request, env))) return json({ error: "Unauthorized" }, 401);
      let payload;
      try {
        payload = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      if (!payload || !Array.isArray(payload.products)) {
        return json({ error: "Invalid catalog payload" }, 400);
      }
      const saved = {
        categories: Array.isArray(payload.categories) ? payload.categories : [],
        products: payload.products,
        siteContent: payload.siteContent && typeof payload.siteContent === "object"
          ? payload.siteContent
          : undefined,
        updatedAt: new Date().toISOString(),
      };
      await env.CATALOG_BUCKET.put(CATALOG_KEY, JSON.stringify(saved, null, 2), {
        httpMetadata: { contentType: "application/json; charset=utf-8" },
      });
      return json({ ok: true, updatedAt: saved.updatedAt, count: saved.products.length });
    }

    if (path.startsWith("/media/") && request.method === "GET") {
      if (!env.MEDIA_BUCKET) {
        return json({ error: "MEDIA_BUCKET binding is missing" }, 500);
      }
      const key = decodeURIComponent(path.slice("/media/".length));
      if (!key) return json({ error: "Invalid media key" }, 400);
      const object = await env.MEDIA_BUCKET.get(key);
      if (!object) return json({ error: "Not found" }, 404);
      const headers = new Headers(CORS);
      object.writeHttpMetadata(headers);
      headers.set("Content-Type", object.httpMetadata?.contentType || MIME[extensionFor(key)] || "application/octet-stream");
      headers.set("ETag", object.httpEtag);
      headers.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(object.body, { headers });
    }

    if (path === "/upload" && request.method === "POST") {
      if (!env.MEDIA_BUCKET) {
        return json({ error: "MEDIA_BUCKET binding is missing" }, 500);
      }
      if (!(await verifyToken(request, env))) return json({ error: "Unauthorized" }, 401);
      let form;
      try {
        form = await request.formData();
      } catch {
        return json({ error: "Invalid form data" }, 400);
      }
      const file = form.get("file");
      if (!file || typeof file === "string") return json({ error: "No file" }, 400);
      const isVideo = (file.type || "").startsWith("video/");
      const maxBytes = isVideo ? 100 * 1024 * 1024 : 12 * 1024 * 1024;
      if (file.size > maxBytes) return json({ error: "File too large" }, 413);
      if (!isVideo && !(file.type || "").startsWith("image/")) {
        return json({ error: "Only images and videos are allowed" }, 415);
      }
      const key = "products/" + Date.now() + "-" + crypto.randomUUID().slice(0, 8) + "." + extensionFor(file.name, file.type);
      await env.MEDIA_BUCKET.put(key, file.stream(), {
        httpMetadata: { contentType: file.type || "application/octet-stream" },
      });
      return json({ ok: true, key, url: url.origin + "/media/" + key });
    }

    if (path === "/delete" && request.method === "POST") {
      if (!env.MEDIA_BUCKET) {
        return json({ error: "MEDIA_BUCKET binding is missing" }, 500);
      }
      if (!(await verifyToken(request, env))) return json({ error: "Unauthorized" }, 401);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON" }, 400);
      }
      const urls = Array.isArray(body?.urls) ? body.urls : [];
      const keys = urls.map((value) => {
        try {
          const pathname = new URL(value).pathname;
          return pathname.startsWith("/media/")
            ? decodeURIComponent(pathname.slice("/media/".length))
            : null;
        } catch {
          return null;
        }
      }).filter(Boolean);
      for (const key of keys) await env.MEDIA_BUCKET.delete(key);
      return json({ ok: true, deleted: keys.length });
    }

    return json({ error: "Not found" }, 404);
  },
};
