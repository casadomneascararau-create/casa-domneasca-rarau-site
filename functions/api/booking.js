const ROOMS = [
  { id: 1, type: "double", capacity: 2 },
  { id: 2, type: "double", capacity: 2 },
  { id: 3, type: "triple", capacity: 3 },
  { id: 4, type: "triple", capacity: 3 },
  { id: 5, type: "quadruple", capacity: 4 },
  { id: 6, type: "quadruple", capacity: 4 },
  { id: 7, type: "quadruple", capacity: 4 }
];

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z"));
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}
async function ensureDb(db) {
  await db.prepare("SELECT id FROM rooms LIMIT 1").first();
}
function isAdmin(request, env) {
  const token = request.headers.get("Authorization") || "";
  return Boolean(env.ADMIN_TOKEN && token === `Bearer ${env.ADMIN_TOKEN}`);
}

export async function onRequestGet({ request, env }) {
  if (!env.BOOKINGS) return json({ error: "Baza de rezervări nu este configurată." }, 503);
  try {
    await ensureDb(env.BOOKINGS);
    const url = new URL(request.url);
    const start = url.searchParams.get("checkIn");
    const end = url.searchParams.get("checkOut");
    if (!validDate(start) || !validDate(end) || start >= end) {
      return json({ error: "Trimiteți checkIn și checkOut în format YYYY-MM-DD; checkOut trebuie să fie după checkIn." }, 400);
    }
    const rows = await env.BOOKINGS.prepare(
      "SELECT room_id FROM reservations WHERE status = 'confirmed' AND check_in < ? AND check_out > ?"
    ).bind(end, start).all();
    const occupied = new Set((rows.results || []).map(row => Number(row.room_id)));
    return json({
      checkIn: start,
      checkOut: end,
      rooms: ROOMS.map(room => ({ ...room, available: !occupied.has(room.id) }))
    });
  } catch {
    return json({ error: "Motorul de rezervări nu este inițializat. Verificați configurarea bazei D1." }, 503);
  }
}

export async function onRequestPost({ request, env }) {
  if (!env.BOOKINGS) return json({ error: "Baza de rezervări nu este configurată." }, 503);
  if (!isAdmin(request, env)) return json({ error: "Operațiune neautorizată." }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Date JSON invalide." }, 400); }
  const roomId = Number(body.roomId);
  const room = ROOMS.find(item => item.id === roomId);
  const { checkIn, checkOut, guestName, guestPhone, guests } = body;
  if (!room || !validDate(checkIn) || !validDate(checkOut) || checkIn >= checkOut ||
      typeof guestName !== "string" || !guestName.trim() || guestName.length > 120 ||
      typeof guestPhone !== "string" || !guestPhone.trim() || guestPhone.length > 40 ||
      !Number.isInteger(Number(guests)) || Number(guests) < 1 || Number(guests) > room.capacity) {
    return json({ error: "Datele rezervării sunt incomplete sau invalide." }, 400);
  }
  const id = crypto.randomUUID();
  try {
    const result = await env.BOOKINGS.prepare(`
      INSERT INTO reservations (id, room_id, check_in, check_out, guest_name, guest_phone, guests, status, source, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1 FROM reservations
        WHERE room_id = ? AND status = 'confirmed'
          AND check_in < ? AND check_out > ?
      )
    `).bind(id, roomId, checkIn, checkOut, guestName.trim(), guestPhone.trim(),
      Number(guests), String(body.source || "admin").slice(0, 30),
      roomId, checkOut, checkIn).run();
    if (!result.meta?.changes) return json({ error: "Camera nu mai este disponibilă pentru perioada selectată." }, 409);
    return json({ ok: true, reservationId: id, roomId, checkIn, checkOut, status: "confirmed" }, 201);
  } catch {
    return json({ error: "Rezervarea nu a putut fi salvată." }, 503);
  }
}
