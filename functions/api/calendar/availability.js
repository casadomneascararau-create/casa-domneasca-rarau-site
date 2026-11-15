function b64url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\\+/g, '-').replace(/\\//g, '_');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function googleAccessToken(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_PRIVATE_KEY || !env.GOOGLE_CALENDAR_ID) {
    throw new Error('Google Calendar credentials are not configured.');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + '.' + claim;
  const pem = env.GOOGLE_PRIVATE_KEY.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\\s/g, '');
  const binary = Uint8Array.from(atob(pem), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8', binary, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = unsigned + '.' + b64url(signature);
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await response.json();
  if (!response.ok || !data.access_token) throw new Error('Google OAuth token request failed.');
  return data.access_token;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const timeMin = url.searchParams.get('timeMin');
  const timeMax = url.searchParams.get('timeMax');
  if (!timeMin || !timeMax || !Number.isFinite(Date.parse(timeMin)) ||
      !Number.isFinite(Date.parse(timeMax)) || Date.parse(timeMax) <= Date.parse(timeMin)) {
    return json({ error: 'Provide valid timeMin and timeMax ISO timestamps.' }, 400);
  }
  try {
    const token = await googleAccessToken(env);
    const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: [{ id: env.GOOGLE_CALENDAR_ID }]
      })
    });
    const data = await response.json();
    if (!response.ok) return json({ error: 'Google Calendar availability lookup failed.' }, 502);
    const calendar = data.calendars?.[env.GOOGLE_CALENDAR_ID];
    return json({
      calendarId: env.GOOGLE_CALENDAR_ID,
      busy: calendar?.busy || [],
      errors: calendar?.errors || []
    });
  } catch (error) {
    console.error('Calendar availability error:', error?.message || error);
    return json({ error: 'Google Calendar is not configured or could not be reached.' }, 503);
  }
}
