function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function verifySignature(rawBody, signature, secret) {
  if (!signature?.startsWith("sha256=") || !secret) return false;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(signature.slice(7).toLowerCase(), hex);
}

function validDate(value) {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(value || "")) return false;
  const d = new Date(value + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

async function sendWhatsApp(env, to, body) {
  const version = env.WHATSAPP_GRAPH_VERSION || "v23.0";
  const url = `https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    console.error("WhatsApp Cloud API send failed", response.status, detail.slice(0, 500));
    throw new Error("WhatsApp message could not be sent");
  }
}

async function getAvailability(db, checkIn, checkOut) {
  const rows = await db.prepare(
    "SELECT room_id FROM reservations WHERE status = 'confirmed' AND check_in < ? AND check_out > ?"
  ).bind(checkOut, checkIn).all();
  const occupied = new Set((rows.results || []).map(row => Number(row.room_id)));
  const rooms = [
    { id: 1, type: "dublă", capacity: 2 }, { id: 2, type: "dublă", capacity: 2 },
    { id: 3, type: "triplă", capacity: 3 }, { id: 4, type: "triplă", capacity: 3 },
    { id: 5, type: "cvadruplă", capacity: 4 }, { id: 6, type: "cvadruplă", capacity: 4 },
    { id: 7, type: "cvadruplă", capacity: 4 }
  ];
  return rooms.filter(room => !occupied.has(room.id));
}

async function handleIncomingMessage(message, env) {
  const from = message.from;
  if (!from || message.type !== "text") return;
  const text = (message.text?.body || "").trim();
  const match = text.match(/^(?:disponibilitate|camere)\\s+(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{4}-\\d{2}-\\d{2})$/i);
  let reply;
  if (match && validDate(match[1]) && validDate(match[2]) && match[1] < match[2]) {
    if (!env.BOOKINGS) {
      reply = "Momentan verificarea automată nu este disponibilă. Vă rugăm să sunați la 0787 445 908.";
    } else {
      try {
        const rooms = await getAvailability(env.BOOKINGS, match[1], match[2]);
        const nights = Math.round((Date.parse(match[2] + "T00:00:00Z") - Date.parse(match[1] + "T00:00:00Z")) / 86400000);
        if (!rooms.length) {
          reply = `Nu avem camere libere în perioada ${match[1]} – ${match[2]} (${nights} nopți). Pentru alternative, sunați la 0787 445 908.`;
        } else {
          const list = rooms.map(r => `Camera ${r.id} – ${r.type}, ${r.capacity} persoane`).join("\\n");
          reply = `Disponibilitate orientativă pentru ${match[1]} – ${match[2]}:\\n${list}\\n\\nDisponibilitatea se reconfirmă înainte de confirmarea rezervării. Pentru rezervare, trimiteți numele și numărul de persoane sau sunați la 0787 445 908.`;
        }
      } catch {
        reply = "Nu am putut verifica disponibilitatea acum. Vă rugăm să sunați la 0787 445 908.";
      }
    }
  } else {
    reply = "Bun venit la Casa Domnească Rarău!\\n\\nPentru verificarea camerelor, trimiteți: DISPONIBILITATE AAAA-LL-ZZ AAAA-LL-ZZ\\nExemplu: DISPONIBILITATE 2026-12-01 2026-12-03\\n\\nAvem 7 camere: 2 duble, 2 triple și 3 cvadruple. Pentru ajutor: 0787 445 908.";
  }
  await sendWhatsApp(env, from, reply);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && env.WHATSAPP_VERIFY_TOKEN &&
      token && timingSafeEqual(token, env.WHATSAPP_VERIFY_TOKEN) && challenge) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Webhook verification failed", { status: 403 });
}

export async function onRequestPost({ request, env }) {
  if (!env.WHATSAPP_APP_SECRET || !env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    return json({ error: "WhatsApp Cloud API is not configured." }, 503);
  }
  const rawBody = await request.text();
  const signature = request.headers.get("X-Hub-Signature-256");
  if (!await verifySignature(rawBody, signature, env.WHATSAPP_APP_SECRET)) {
    return json({ error: "Invalid webhook signature." }, 401);
  }
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON." }, 400); }
  if (payload.object !== "whatsapp_business_account") return json({ received: true });

  const messages = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const message of change.value?.messages || []) messages.push(message);
    }
  }
  for (const message of messages) {
    if (message.id && env.BOOKINGS) {
      try {
        const seen = await env.BOOKINGS.prepare(
          "INSERT OR IGNORE INTO whatsapp_webhook_events (message_id) VALUES (?)"
        ).bind(message.id).run();
        if (!seen.meta?.changes) continue;
      } catch {
        console.error("WhatsApp webhook event table missing; apply migration 0002.");
        return json({ error: "WhatsApp webhook storage is not initialized." }, 503);
      }
    }
    try { await handleIncomingMessage(message, env); }
    catch (error) { console.error("WhatsApp inbound processing failed", String(error)); }
  }
  return json({ received: true });
}
