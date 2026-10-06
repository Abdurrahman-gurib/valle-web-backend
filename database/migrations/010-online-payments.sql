-- 010: online payments. Idempotent.
--  * one row per attempt to pay a booking through a payment provider
--    (hosted checkout): pending until the provider's webhook settles it.
--  * bookings.paid_amount / paid_at / payment_method are updated when a
--    payment is paid or refunded, so the gate and the ticket read one number.

CREATE TABLE IF NOT EXISTS payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider        text NOT NULL,                        -- sandbox | peach | mips ...
  provider_ref    text NOT NULL DEFAULT '',             -- the provider's id for this checkout / transaction
  amount          int  NOT NULL,                        -- rupees requested
  currency        text NOT NULL DEFAULT 'MUR',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled','refunded')),
  refunded_amount int  NOT NULL DEFAULT 0,
  failure_reason  text NOT NULL DEFAULT '',
  raw             jsonb,                                -- the provider's last payload, for support
  created_at      timestamptz NOT NULL DEFAULT now(),
  settled_at      timestamptz,                          -- when the webhook marked it paid / failed
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_booking_idx ON payments(booking_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_provider_ref_idx ON payments(provider, provider_ref);
CREATE INDEX IF NOT EXISTS payments_pending_idx ON payments(created_at) WHERE status = 'pending';
