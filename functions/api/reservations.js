// Private reservation API for Casa Domneasca Rarau.
// Deploy as a separate Cloudflare Pages Function. Requires secrets and 7 Google calendars
// shared with the configured Google service account. This endpoint is NOT connected to
// Meta Business Agent until an authorized Meta action/webhook is configured.

const TZ = "Europe/Bucharest";
const ROOM_IDS = ["room-1","room-2","room-3","room-4","room-5","room-6","room-7"];

function b64url(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem) {
  const clean = pem.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function googleAccessToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Google service account credentials are not configured.");
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + "." + claim;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + "." + b64url(new Uint8Array(signature));
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion
    })
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) {
    throw new Error("Google OAuth token exchange failed.");
  }
  return tokenData.access_token;
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function validDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0,10) === s;
}

function bucharestMidnight(date) {
  const probe = new Date(date + "T12:00:00Z");
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, timeZoneName: "shortOffset"
  }).formatToParts(probe).find(p => p.type === "timeZoneName")?.value || "GMT+2";
  const match = part.match(/GMT([+-])(\\d{1,2})(?::(\\d{2}))?/);
  const sign = match?.[1] === "-" ? "-" : "+";
  const hours = String(Number(match?.[2] || 2)).padStart(2, "0");
  const minutes = String(Number(match?.[3] || 0)).padStart(2, "0");
  return date + "T00:00:00" + sign + hours + ":" + minutes;
}

function calendarForRoom(env, roomId) {
  if (!ROOM_IDS.includes(roomId)) return null;
  return env["GOOGLE_CALENDAR_" + roomId.replace("-", "_").toUpperCase()];
}

async function googleRequest(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || "Google Calendar API request failed.");
  return data;
}

export async function onRequestPost({ request, env }) {
  if (!env.RESERVATION_API_SECRET) return json({ error: "Reservation API is not configured." }, 503);
  const auth = request.headers.get("Authorization") || "";
  if (auth !== "Bearer " + env.RESERVATION_API_SECRET) return json({ error: "Unauthorized." }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
  const { action, roomId, arrival, departure } = body || {};
  if (!ROOM_IDS.includes(roomId) || !calendarForRoom(env, roomId)) {
    return json({ error: "Unknown room or calendar not configured." }, 400);
  }
  if (!validDate(arrival) || !validDate(departure) || departure <= arrival) {
    return json({ error: "Use valid arrival/departure dates; departure must be after arrival." }, 400);
  }

  try {
    const token = await googleAccessToken(env);
    const calendarId = encodeURIComponent(calendarForRoom(env, roomId));
    const timeMin = arrival + "T00:00:00+02:00";
    const timeMax = departure + "T00:00:00+02:00";

    if (action === "availability") {
      const result = await googleRequest("https://www.googleapis.com/calendar/v3/freeBusy", token, {
        method: "POST",
        body: JSON.stringify({
          timeMin, timeMax, timeZone: TZ,
          items: [{ id: calendarForRoom(env, roomId) }]
        })
      });
      const busy = result.calendars?.[calendarForRoom(env, roomId)]?.busy || [];
      return json({ roomId, available: busy.length === 0, conflicts: busy.length });
    }

    if (action === "create") {
      const { guestName, guestPhone, adults, children, source = "WhatsApp" } = body;
      if (typeof guestName !== "string" || !guestName.trim() || !Number.isInteger(adults) || adults < 1) {
        return json({ error: "Guest name and adult count are required." }, 400);
      }
      const freeBusy = await googleRequest("https://www.googleapis.com/calendar/v3/freeBusy", token, {
        method: "POST",
        body: JSON.stringify({
          timeMin, timeMax, timeZone: TZ,
          items: [{ id: calendarForRoom(env, roomId) }]
        })
      });
      const busy = freeBusy.calendars?.[calendarForRoom(env, roomId)]?.busy || [];
      if (busy.length) return json({ error: "Room is not available for the requested dates.", available: false }, 409);

      const event = await googleRequest(
        "https://www.googleapis.com/calendar/v3/calendars/" + calendarId + "/events",
        token,
        {
          method: "POST",
          body: JSON.stringify({
            summary: "REZERVARE – " + roomId + " – " + guestName.trim(),
            description: [
              "Sursă: " + String(source).slice(0,80),
              "Client: " + guestName.trim().slice(0,160),
              "Telefon: " + String(guestPhone || "").slice(0,40),
              "Adulți: " + adults,
              "Copii: " + (Number.isInteger(children) ? children : 0),
              "Creat prin API rezervări Casa Domnească Rarău."
            ].join("\n"),
            start: { date: arrival },
            end: { date: departure },
            transparency: "opaque"
          })
        }
      );
      return json({ created: true, roomId, eventId: event.id, htmlLink: event.htmlLink });
    }

    return json({ error: "Action must be availability or create." }, 400);
  } catch (error) {
    return json({ error: "Calendar operation failed.", detail: String(error.message || error) }, 502);
  }
}
