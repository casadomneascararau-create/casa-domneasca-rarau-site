function b64url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function extractDates(message) {
  const iso = [...message.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)].map(m => m[0]);
  const ro = [...message.matchAll(/\b(\d{1,2})[./](\d{1,2})[./](20\d{2})\b/g)]
    .map(m => `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`);
  return [...new Set([...iso, ...ro])].filter(d => !Number.isNaN(Date.parse(d + 'T00:00:00Z'))).sort();
}

// Google Calendar read-only check; no AI service or paid chatbot is used.
async function getCalendarAvailability(env, message) {
  const ids = (env.GOOGLE_CALENDAR_IDS || env.GOOGLE_CALENDAR_ID || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!ids.length || !env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY) {
    return { error: 'Calendar credentials or calendar IDs are not configured.' };
  }
  const dates = extractDates(message);
  if (dates.length < 2 || dates[0] >= dates[1]) return { needsDates: true };
  const start = dates[0], end = dates[1];
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
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
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
  return {
    start, end,
    rooms: ids.map((id, i) => {
      const cal = data.calendars?.[id];
      return { name: `Camera ${i + 1}`, checked: !!cal && !cal.errors?.length,
        busy: !!cal && !cal.errors?.length && (cal.busy || []).length > 0 };
    })
  };
}

function makeReply(message, availability) {
  const q = message.toLocaleLowerCase('ro');
  if (availability?.rooms) {
    const checked = availability.rooms.filter(r => r.checked);
    if (!checked.length) return 'Nu am reușit să verificăm calendarele. Vă rugăm să sunați la 0787 445 908 pentru confirmarea disponibilității.';
    const free = checked.filter(r => !r.busy).map(r => r.name);
    const busy = checked.filter(r => r.busy).map(r => r.name);
    let reply = `Am verificat preliminar calendarele pentru ${availability.start} – ${availability.end}.\n`;
    reply += free.length ? `Fără evenimente ocupate în calendar: ${free.join(', ')}.\n` : '';
    reply += busy.length ? `Cu evenimente ocupate: ${busy.join(', ')}.\n` : '';
    reply += 'Aceasta este o verificare preliminară; disponibilitatea și rezervarea trebuie confirmate de proprietate la 0787 445 908.';
    return reply;
  }
  if (/\b(20\d{2})-(\d{2})-(\d{2})\b|\b\d{1,2}[./]\d{1,2}[./]20\d{2}\b/.test(message)) {
    return 'Pentru verificarea disponibilității, trimiteți perioada completă cu data sosirii și data plecării (de exemplu 20.12.2026 – 22.12.2026), tipul camerei și numărul de persoane.';
  }
  if (/pre[tț]|tarif|cost|lei|preț/i.test(q)) {
    return 'Tariful publicat pentru camera dublă este 300 lei/noapte, cu mic dejun inclus. Pentru camere triple și tarifele perioadei solicitate, vă rugăm să confirmați direct la 0787 445 908.';
  }
  if (/adres|unde|loca|ajung/i.test(q)) {
    return 'Casa Domnească Rarău se află pe Calea Transilvaniei nr. 40, Câmpulung Moldovenesc, județul Suceava.';
  }
  if (/rezerv|disponibil|liber|camer|cazare|weekend|perioad/i.test(q)) {
    return 'Cu drag vă ajutăm! Trimiteți, vă rog, data sosirii și data plecării în format ZZ.LL.AAAA, tipul camerei (dublă/triplă) și numărul de persoane. Pentru confirmarea finală sunați la 0787 445 908.';
  }
  if (/meniu|mâncare|mancare|restaurant|cin[ăa]|pr[aâ]nz/i.test(q)) {
    return 'Pensiunea are restaurant cu preparate tradiționale și cramă. Mâncarea se pregătește la comandă, pentru oaspeții cazați. Pentru detalii sunați la 0787 445 908.';
  }
  return 'Bună ziua! Ați contactat Casa Domnească Rarău din Câmpulung Moldovenesc. Vă pot oferi informații despre cazare, tarife și restaurant. Pentru rezervări: 0787 445 908 sau casa.domneasca.rarau@gmail.com.';
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
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
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
          let availability = null;
          try {
            availability = await getCalendarAvailability(env, incoming);
          } catch (calendarError) {
            console.error('Google Calendar lookup error:', calendarError);
            availability = { error: true };
          }
          const reply = availability?.error
            ? 'Momentan nu pot verifica automat calendarele. Pentru disponibilitate și rezervări, sunați la 0787 445 908.'
            : makeReply(incoming, availability);
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
