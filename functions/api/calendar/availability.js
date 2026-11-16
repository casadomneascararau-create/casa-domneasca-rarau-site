function b64url(value) {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

async function googleAccessToken(env) {
  const privateKey = env.GOOGLE_PRIVATE_KEY || env['GOOGLE_PRIVATE_KEY.'];
  const calendarIds = env.GOOGLE_CALENDAR_IDS || env.GOOGLE_CALENDAR_ID;
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !privateKey || !calendarIds) {
    throw new Error('Google Calendar credentials are not configured.');
  }
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  }));
  const unsigned = header + '.' + claim;
  const pem = privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
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
    const calendarIds = env.GOOGLE_CALENDAR_IDS || env.GOOGLE_CALENDAR_ID;
    if (!calendarIds) return json({ error: 'Google Calendar IDs are not configured.' }, 503);
    const token = await googleAccessToken(env);
    const response = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin,
        timeMax,
        items: calendarIds.split(',').map(id => id.trim()).filter(Boolean).map(id => ({ id }))
      })
    });
    const data = await response.json();
    if (!response.ok) return json({ error: 'Google Calendar availability lookup failed.' }, 502);
    return json({ calendars: data.calendars || {} });
  } catch (error) {
    console.error('Calendar availability error:', error?.message || error);
    return json({ error: 'Google Calendar is not configured or could not be reached.' }, 503);
  }
}


export async function onRequestPost({ request, env }) {
  const auth = request.headers.get('Authorization') || '';
  if (!env.WHATSAPP_VERIFY_TOKEN || auth !== 'Bearer ' + env.WHATSAPP_VERIFY_TOKEN) {
    return json({ error: 'Unauthorized.' }, 401);
  }
  let body;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON.' }, 400); }
  const { checkIn, checkOut, roomNumber, guestName, phone, adults = 1, children = 0, bookingRef } = body || {};
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z'));
  if (!validDate(checkIn) || !validDate(checkOut) || checkOut <= checkIn ||
      !Number.isInteger(roomNumber) || roomNumber < 1 || roomNumber > 7 ||
      typeof guestName !== 'string' || guestName.trim().length < 2 || guestName.length > 100 ||
      typeof phone !== 'string' || !/^\+?[0-9 ()-]{8,20}$/.test(phone) ||
      !Number.isInteger(adults) || adults < 1 || adults > 12 ||
      !Number.isInteger(children) || children < 0 || children > 10 ||
      typeof bookingRef !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(bookingRef)) {
    return json({ error: 'Required: valid checkIn/checkOut, roomNumber 1-7, guestName, phone, adults, children and bookingRef.' }, 400);
  }
  try {
    const privateKey = env.GOOGLE_PRIVATE_KEY || env['GOOGLE_PRIVATE_KEY.'];
    const calendarIds = (env.GOOGLE_CALENDAR_IDS || env.GOOGLE_CALENDAR_ID || '').split(',').map(x => x.trim()).filter(Boolean);
    if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !privateKey || calendarIds.length < 7) {
      return json({ error: 'Google Calendar credentials or seven room calendars are missing.' }, 503);
    }
    const token = await googleAccessToken(env);
    const calendarId = calendarIds[roomNumber - 1];
    const freeBusy = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timeMin: checkIn + 'T00:00:00+02:00',
        timeMax: checkOut + 'T00:00:00+02:00',
        items: [{ id: calendarId }]
      })
    });
    const busyData = await freeBusy.json();
    if (!freeBusy.ok || busyData.calendars?.[calendarId]?.errors?.length) {
      return json({ error: 'Calendar availability could not be verified.' }, 502);
    }
    if ((busyData.calendars?.[calendarId]?.busy || []).length) {
      return json({ error: 'Room is not available for the selected dates.' }, 409);
    }
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bookingRef));
    const eventId = [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    const eventResponse = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(calendarId) + '/events', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: eventId,
        summary: 'Rezervare – ' + guestName.trim(),
        description: 'Referință: ' + bookingRef + '\nTelefon: ' + phone + '\nAdulți: ' + adults + '\nCopii: ' + children + '\nSursă: WhatsApp',
        start: { date: checkIn, timeZone: 'Europe/Bucharest' },
        end: { date: checkOut, timeZone: 'Europe/Bucharest' },
        visibility: 'private',
        transparency: 'opaque'
      })
    });
    const eventData = await eventResponse.json();
    if (eventResponse.status === 409) {
      return json({ ok: true, duplicate: true, roomNumber, bookingRef, eventId });
    }
    if (!eventResponse.ok) {
      console.error('Google Calendar event creation failed:', eventData?.error?.message || eventResponse.status);
      return json({ error: 'Could not create the calendar reservation.' }, 502);
    }
    return json({ ok: true, roomNumber, bookingRef, eventId, htmlLink: eventData.htmlLink || null }, 201);
  } catch (error) {
    console.error('Calendar booking error:', error?.message || error);
    return json({ error: 'Google Calendar booking failed.' }, 503);
  }
}
