const GRAPH_VERSION = 'v23.0';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function verifySignature(request, rawBody, secret) {
  if (!secret) return false;
  const signature = request.headers.get('X-Hub-Signature-256') || '';
  if (!signature.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = 'sha256=' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < signature.length; i++) diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

async function sendWhatsAppText(env, to, body) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error('WhatsApp API credentials are not configured.');
  }
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: String(body).slice(0, 3500) }
    })
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`WhatsApp send failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return response.json();
}

async function generateReply(env, userText) {
  if (!env.AI || typeof env.AI.run !== 'function') {
    return 'Bună ziua! Vă mulțumim că ați contactat Casa Domnească Rarău. Pentru rezervări, sunați la 0787 445 908 sau scrieți la casa.domneasca.rarau@gmail.com.';
  }
  const system = `Ești asistentul WhatsApp al pensiunii Casa Domnească Rarău din Câmpulung Moldovenesc, Bucovina. Răspunde în română, cald și concis. Telefon: 0787 445 908. E-mail: casa.domneasca.rarau@gmail.com. Pensiunea are cinci camere, mic dejun, cramă și restaurant cu preparate la comandă. Camera dublă este publicată la 300 lei/noapte cu mic dejun inclus. Nu confirma rezervări și nu afirma că ai verificat disponibilitatea calendarului. Pentru a pregăti o solicitare, cere perioada (check-in și check-out), numărul de adulți/copii și tipul camerei. Spune clar că rezervarea devine confirmată numai după confirmarea pensiunii. Nu solicita date de card, parole sau date sensibile.`;
  const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
    messages: [{ role: 'system', content: system }, { role: 'user', content: userText.slice(0, 2000) }],
    max_tokens: 300,
    temperature: 0.3
  });
  return String(result?.response || result?.result?.response || 'Vă rugăm să ne contactați la 0787 445 908 pentru ajutor.').slice(0, 1000);
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && env.WHATSAPP_VERIFY_TOKEN && token === env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(challenge || '', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('WhatsApp webhook is ready. Configure the Meta callback URL and verify token.', { status: 200 });
}

export async function onRequestPost({ request, env }) {
  const rawBody = await request.text();
  if (!(await verifySignature(request, rawBody, env.META_APP_SECRET))) {
    return json({ error: 'Invalid webhook signature.' }, 401);
  }
  let payload;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: 'Invalid JSON.' }, 400); }

  // Meta expects a quick 200 acknowledgement. Process only actual incoming text messages.
  const entries = payload?.entry || [];
  for (const entry of entries) {
    for (const change of entry?.changes || []) {
      const value = change?.value || {};
      for (const message of value?.messages || []) {
        if (message?.type !== 'text' || !message?.from || !message?.text?.body) continue;
        try {
          const reply = await generateReply(env, message.text.body);
          await sendWhatsAppText(env, message.from, reply);
        } catch (error) {
          console.error('WhatsApp webhook processing error:', error?.message || error);
        }
      }
    }
  }
  return json({ received: true });
}
