/**
 * Worker entry point for the 13:30 Handover Meeting run sheet.
 *
 * Responsibilities, in order, for every incoming request:
 *   1. Password-gate the whole site via a signed, HttpOnly session cookie.
 *      Nothing — not even static files — is served without a valid session,
 *      except the /login route itself (or the cookie would never be
 *      obtainable in the first place).
 *   2. Proxy multi-device sync calls to JSONBin.io under /api/sync, so the
 *      real JSONBin API key and Bin ID never reach the browser. The client
 *      only ever talks to same-origin /api/sync.
 *   3. Once authenticated, fall through to the static assets in ./public
 *      via the ASSETS binding for everything else.
 *
 * Required Worker secrets (Settings → Variables and Secrets, type "Secret"):
 *   SITE_PASSWORD    - the shared password everyone types in to get in
 *   SESSION_SECRET    - random string used to HMAC-sign session cookies
 *   JSONBIN_BIN_ID    - the JSONBin.io Bin ID holding the run sheet JSON
 *   JSONBIN_API_KEY   - JSONBin.io X-Master-Key
 */

const COOKIE_NAME = "session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

// ---------------------------------------------------------------------------
// Crypto helpers
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signPayload(payload, secret) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return bytesToBase64Url(new Uint8Array(sig));
}

async function verifyPayload(payload, signature, secret) {
  const key = await hmacKey(secret);
  let sigBytes;
  try {
    sigBytes = base64UrlToBytes(signature);
  } catch (e) {
    return false;
  }
  return crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(payload));
}

// Constant-time-ish string comparison: hash both sides first (fixed-length
// output) so the final comparison loop doesn't leak input length or content
// through timing, then compare byte-by-byte without short-circuiting.
async function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode("timing-safe-compare-key"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const [da, db] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(String(a))),
    crypto.subtle.sign("HMAC", key, enc.encode(String(b))),
  ]);
  const va = new Uint8Array(da);
  const vb = new Uint8Array(db);
  if (va.length !== vb.length) return false;
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Session cookie
// ---------------------------------------------------------------------------

async function createSessionToken(env) {
  const expiry = Date.now() + SESSION_TTL_MS;
  const payload = String(expiry);
  const sig = await signPayload(payload, env.SESSION_SECRET);
  return `${payload}.${sig}`;
}

async function isValidSessionToken(token, env) {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot < 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expiry = Number(payload);
  if (!Number.isFinite(expiry) || Date.now() > expiry) return false;
  return verifyPayload(payload, sig, env.SESSION_SECRET);
}

function parseCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const parts = header.split(/;\s*/);
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}

function sessionCookieHeader(token, maxAgeSeconds) {
  return (
    `${COOKIE_NAME}=${encodeURIComponent(token)}; ` +
    `Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
  );
}

async function requestIsAuthenticated(request, env) {
  const token = parseCookie(request, COOKIE_NAME);
  return isValidSessionToken(token, env);
}

// ---------------------------------------------------------------------------
// Login page
// ---------------------------------------------------------------------------

function loginPageHtml(errorMessage) {
  const errorBlock = errorMessage
    ? `<div class="error">${escapeHtml(errorMessage)}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Sign in — 13:30 Handover Meeting</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  *{box-sizing:border-box;}
  body{
    margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    font-family:'Lexend', system-ui, sans-serif; background:
      radial-gradient(1200px 500px at 100% -10%, rgba(153,214,234,.25), transparent 60%),
      radial-gradient(900px 400px at -10% 110%, rgba(255,214,55,.18), transparent 55%),
      #FFFFFF;
    color:#0B0B0C;
  }
  .card{
    width:100%; max-width:360px; margin:20px; background:#fff; border:1px solid #E7E5DE;
    border-radius:14px; box-shadow:0 6px 20px rgba(11,11,12,.08); overflow:hidden;
  }
  .bar{height:4px; background:#47D7AC;}
  .inner{padding:28px 26px 26px;}
  h1{font-size:19px; font-weight:700; margin:0 0 4px;}
  .sub{font-size:13px; color:#7a776c; margin:0 0 18px;}
  input[type=password]{
    width:100%; padding:11px 12px; border:1.5px solid #E7E5DE; border-radius:9px;
    font-size:14px; font-family:inherit; margin-bottom:14px; background:#FAFAF7; color:#0B0B0C;
  }
  input[type=password]:focus{outline:2px solid #47D7AC; outline-offset:0; border-color:#47D7AC;}
  button{
    width:100%; padding:11px 12px; border:none; border-radius:9px; background:#0B0B0C;
    color:#fff; font-family:inherit; font-size:14px; font-weight:700; cursor:pointer;
  }
  button:hover{background:#7566A0;}
  .error{
    background:rgba(117,102,160,.1); border:1px solid #7566A0; color:#4a3f68;
    font-size:12.5px; padding:9px 11px; border-radius:8px; margin-bottom:14px;
  }
</style>
</head>
<body>
  <form class="card" method="POST" action="/login">
    <div class="bar"></div>
    <div class="inner">
      <h1>13:30 Handover Meeting</h1>
      <p class="sub">Enter the site password to continue.</p>
      ${errorBlock}
      <input type="password" name="password" placeholder="Password" autofocus required>
      <button type="submit">Sign in</button>
    </div>
  </form>
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// ---------------------------------------------------------------------------
// JSONBin sync proxy
// ---------------------------------------------------------------------------

async function handleSync(request, env) {
  const binId = env.JSONBIN_BIN_ID;
  const apiKey = env.JSONBIN_API_KEY;

  if (request.method === "GET") {
    const upstream = await fetch(`https://api.jsonbin.io/v3/b/${binId}/latest`, {
      headers: { "X-Master-Key": apiKey, "X-Bin-Meta": "false" },
    });
    if (upstream.status === 404) {
      return new Response("null", { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: "sync read failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    const body = await upstream.text();
    return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
  }

  if (request.method === "PUT" || request.method === "POST") {
    let payload;
    try {
      payload = await request.text();
      JSON.parse(payload); // validate it's actually JSON before forwarding
    } catch (e) {
      return new Response(JSON.stringify({ error: "invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const upstream = await fetch(`https://api.jsonbin.io/v3/b/${binId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": apiKey },
      body: payload,
    });
    if (!upstream.ok) {
      return new Response(JSON.stringify({ error: "sync write failed" }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("Method not allowed", { status: 405 });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- Login route: always reachable, never itself gated ---
    if (path === "/login") {
      if (request.method === "GET") {
        return new Response(loginPageHtml(null), {
          status: 200,
          headers: { "Content-Type": "text/html; charset=UTF-8" },
        });
      }
      if (request.method === "POST") {
        const form = await request.formData();
        const submitted = form.get("password") || "";
        const expected = env.SITE_PASSWORD || "";
        const ok = expected && (await timingSafeEqual(submitted, expected));
        if (!ok) {
          return new Response(loginPageHtml("That password didn't work — try again."), {
            status: 401,
            headers: { "Content-Type": "text/html; charset=UTF-8" },
          });
        }
        const token = await createSessionToken(env);
        return new Response(null, {
          status: 303,
          headers: {
            Location: "/",
            "Set-Cookie": sessionCookieHeader(token, SESSION_TTL_MS / 1000),
          },
        });
      }
      return new Response("Method not allowed", { status: 405 });
    }

    // --- Logout: clears the cookie, always reachable ---
    if (path === "/logout" && request.method === "POST") {
      return new Response(null, {
        status: 303,
        headers: {
          Location: "/login",
          "Set-Cookie": `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
        },
      });
    }

    // --- Everything else requires a valid session ---
    const authed = await requestIsAuthenticated(request, env);
    if (!authed) {
      const wantsHtml = (request.headers.get("Accept") || "").includes("text/html");
      if (wantsHtml || path === "/") {
        return Response.redirect(new URL("/login", request.url).toString(), 302);
      }
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // --- Sync API, only reachable once authenticated ---
    if (path === "/api/sync") {
      return handleSync(request, env);
    }

    // --- Static site files ---
    return env.ASSETS.fetch(request);
  },
};
