const SYSTEM_PROMPT = `Ești asistentul virtual oficial al pensiunii Casa Domnească Rarău din Câmpulung Moldovenesc, Bucovina. Răspunzi politicos, cald și concis, în limba clientului (implicit română).
Pensiunea are cazare de 3 stele, restaurant cu preparate tradiționale, cramă și terase. Rezervări și confirmarea disponibilității: 0787 445 908, casa.domneasca.rarau@gmail.com.
Tarife publicate: cameră dublă 300 lei/noapte, mic dejun inclus. Pentru camere triple, alte perioade, tarife actuale și disponibilitate, solicită perioada, numărul de persoane și tipul camerei, apoi precizează că proprietatea trebuie să confirme.
Nu confirma și nu efectua rezervări și nu pretinde că ai acces la calendar sau la disponibilitatea camerelor. Nu cere date de card, parole sau date sensibile. Dacă nu știi, îndrumă clientul să sune la pensiune.`;

function b64url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// Read-only Google Calendar lookup. It never creates, edits, or confirms reservations.
async function getCalendarContext(env, message) {
  const ids = (env.GOOGLE_CALENDAR_IDS || env.GOOGLE_CALENDAR_ID || '')
    .split(',').map(x => x.trim()).filter(Boolean);
  if (!ids.length || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) return null;

  const iso = [...message.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)].map(m => m[0]);
  const ro = [...message.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/g)]
    .map(m => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  const dates = [...new Set([...iso, ...ro])].filter(d => !Number.isNaN(Date.parse(d + 'T00:00:00Z')));
  if (dates.length < 2) return null;
  const [start, end] = dates.slice(0, 2).sort();
  if (end <= start) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  }));
  const unsigned = header + '.' + claim;
  const pem = env.GOOGLE_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const keyBytes = Uint8Array.from(atob(pem), ch => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + '.' + b64url(signature);
  const auth = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion
    })
  });
  const authData = await auth.json();
  if (!auth.ok || !authData.access_token) throw new Error('Google Calendar authorization failed');

  const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + authData.access_token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      timeMin: start + 'T00:00:00Z',
      timeMax: end + 'T23:59:59Z',
      items: ids.map(id => ({ id }))
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error('Google Calendar free/busy lookup failed');
  const calendars = data.calendars || {};
  const summary = ids.map((id, i) => {
    const cal = calendars[id];
    if (!cal || cal.errors?.length) return `Calendar ${i + 1}: unavailable to check`;
    return `Calendar ${i + 1}: ${(cal.busy || []).length ? 'has busy periods' : 'no busy periods returned'}`;
  });
  return `Read-only calendar check for ${start} through ${end}: ${summary.join('; ')}. This is only a preliminary indication; do not confirm a reservation. Ask the owner to verify room mapping and final availability.`;
}


async function sendWhatsApp(env, to, body) {
  const version = (env.WHATSAPP_API_VERSION || 'v23.0').replace(/^\/+|\/+$/g, '');
  const url = `https://graph.facebook.com/${version}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
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
    console.error('WhatsApp send failed:', response.status, detail.slice(0, 500));
  }
  return response.ok;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');
  if (mode === 'subscribe' && token && env.WHATSAPP_VERIFY_TOKEN &&
      token === env.WHATSAPP_VERIFY_TOKEN && challenge) {
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }
  return new Response('Forbidden', { status: 403 });
}

export async function onRequestPost({ request, env }) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID || !env.AI) {
    return new Response('WhatsApp integration is not configured', { status: 503 });
  }
  let payload;
  try { payload = await request.json(); }
  catch { return new Response('Bad Request', { status: 400 }); }

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    for (const change of (entry.changes || [])) {
      const value = change.value || {};
      for (const message of (value.messages || [])) {
        if (message.type !== 'text' || !message.from || !message.text?.body) continue;
        const incoming = message.text.body.slice(0, 1500);
        try {
          let calendarContext = '';
          try {
            const context = await getCalendarContext(env, incoming);
            if (context) calendarContext = '\\n\\nINTERNAL CALENDAR CONTEXT (read-only): ' + context;
          } catch (calendarError) {
            console.error('Google Calendar lookup error:', calendarError);
            calendarContext = '\\n\\nINTERNAL CALENDAR CONTEXT: calendar lookup failed; do not claim availability.';
          }
          const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: incoming + calendarContext }
            ],
            max_tokens: 350,
            temperature: 0.35
          });
          const reply = result?.response || result?.result?.response ||
            'Vă rugăm să sunați la 0787 445 908 pentru ajutor.';
          await sendWhatsApp(env, message.from, reply);
        } catch (error) {
          console.error('WhatsApp assistant error:', error);
          await sendWhatsApp(env, message.from,
            'Vă mulțumim pentru mesaj! Pentru ajutor și rezervări, sunați la 0787 445 908.');
        }
      }
    }
  }
  return new Response('EVENT_RECEIVED', { status: 200 });
}
