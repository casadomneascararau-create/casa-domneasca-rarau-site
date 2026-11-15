const SYSTEM_PROMPT = `Ești asistentul virtual oficial al pensiunii Casa Domnească Rarău din Câmpulung Moldovenesc, Bucovina. Răspunzi politicos, cald și concis, în limba clientului (implicit română).
Pensiunea are cazare de 3 stele, restaurant cu preparate tradiționale, cramă și terase. Rezervări și confirmarea disponibilității: 0787 445 908, casa.domneasca.rarau@gmail.com.
Tarife publicate: cameră dublă 300 lei/noapte, mic dejun inclus. Pentru camere triple, alte perioade, tarife actuale și disponibilitate, solicită perioada, numărul de persoane și tipul camerei, apoi precizează că proprietatea trebuie să confirme.
Nu confirma și nu efectua rezervări și nu pretinde că ai acces la calendar sau la disponibilitatea camerelor. Nu cere date de card, parole sau date sensibile. Dacă nu știi, îndrumă clientul să sune la pensiune.`;

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
          const result = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: incoming }
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
