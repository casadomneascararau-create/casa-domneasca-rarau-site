CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY,
  room_type TEXT NOT NULL CHECK (room_type IN ('double','triple','quadruple')),
  capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 4)
);
INSERT OR IGNORE INTO rooms (id, room_type, capacity) VALUES
  (1,'double',2),(2,'double',2),(3,'triple',3),(4,'triple',3),
  (5,'quadruple',4),(6,'quadruple',4),(7,'quadruple',4);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES rooms(id),
  check_in TEXT NOT NULL,
  check_out TEXT NOT NULL,
  guest_name TEXT NOT NULL,
  guest_phone TEXT NOT NULL,
  guests INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  source TEXT NOT NULL DEFAULT 'direct',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (check_in < check_out)
);
CREATE INDEX IF NOT EXISTS reservations_room_dates_status
  ON reservations (room_id, status, check_in, check_out);
