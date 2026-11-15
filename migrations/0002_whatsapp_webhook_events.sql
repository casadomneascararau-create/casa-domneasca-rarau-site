CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
  message_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
