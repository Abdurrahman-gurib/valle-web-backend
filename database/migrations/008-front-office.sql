-- 008: front-office operations. Idempotent.
--  * payments taken at the cashier (amount, method, receipt number)
--  * price adjustments: FOC passes, percentage / amount discounts, free entry, coupon codes
--  * 'postponed' status for weather days (no refund; the guest picks a new date)
--  * coupons table for codes the guest types on the website or staff apply
--  * which activities need a signed Disclaimer Form

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_amount       int  NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS paid_at           timestamptz;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS payment_method    text NOT NULL DEFAULT '';   -- cash | card | juice | online | other
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS receipt_no        text NOT NULL DEFAULT '';   -- cashier's till receipt number
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS adjustment_kind   text NOT NULL DEFAULT 'none'; -- none | percent | amount | foc | entry_free
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS adjustment_value  int  NOT NULL DEFAULT 0;    -- percent or rupees, per kind
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS adjustment_amount int  NOT NULL DEFAULT 0;    -- rupees actually taken off
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS adjustment_note   text NOT NULL DEFAULT '';   -- "FOC pass #12", "hotel partner 10%"
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS coupon_code       text NOT NULL DEFAULT '';
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS postponed_from    date;                       -- original visit date of a weather postponement

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check CHECK (status IN ('confirmed','arrived','cancelled','postponed'));

CREATE TABLE IF NOT EXISTS coupons (
  code        text PRIMARY KEY,                       -- upper case, as typed by the guest
  kind        text NOT NULL CHECK (kind IN ('percent','amount','foc','entry_free')),
  value       int  NOT NULL DEFAULT 0,                -- percent (1..100) or rupees
  note        text NOT NULL DEFAULT '',               -- what the guest sees: "Hotel partner offer"
  active      boolean NOT NULL DEFAULT true,
  valid_from  date,
  valid_to    date,
  max_uses    int,                                    -- null = unlimited
  uses        int  NOT NULL DEFAULT 0,
  created_by  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Activities that need a signed Disclaimer Form. Everything else (walks,
-- expeditions, restaurants, Kids Park, animal feeding, park entry) does not.
INSERT INTO settings(key, value) VALUES ('waiver_activities', '["zipline","bicycle","nepalese","quad","buggy","luge"]')
ON CONFLICT (key) DO NOTHING;
