-- 004: files in live chat (photos, GIFs, voice notes, documents).
-- Idempotent: safe to run on every api pre-deploy (scripts/db-init.js).

CREATE TABLE IF NOT EXISTS chat_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('image','gif','audio','file')),
  name            text NOT NULL,
  mime            text NOT NULL,
  size            int  NOT NULL,
  data            bytea NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_att_message ON chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_att_conv    ON chat_attachments(conversation_id);

-- Staff can now take bookings over the phone / at the desk: a fourth audit action.
-- (The column has no CHECK constraint; this comment documents the new value: 'create'.)
