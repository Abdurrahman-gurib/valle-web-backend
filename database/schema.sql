-- =============================================================
-- VALLÉ Advenature™ Park: PostgreSQL schema
-- Target: PostgreSQL 14+  (uses built-in gen_random_uuid())
-- Load order: schema.sql, then seed.sql
-- =============================================================

BEGIN;

-- ride_order is listed only so that databases created by an earlier version of
-- this schema get it cleaned up; it is no longer created (the v3 design has no
-- section that consumes it).
DROP TABLE IF EXISTS ride_order,
  job_applications, job_vacancies,
  chat_messages, chat_conversations,
  booking_audit, booking_lines, bookings, staff_users, quotes,
  gallery_shots, experience_galleries, experience_facts,
  map_pins, menu_items, menu_groups, restaurant_gallery, restaurants,
  package_tier_items, package_tiers, package_addons, vip_items,
  combo_items, combos, cinematic_items, price_list,
  photo_tiers, photo_addons, team_pack_items, team_packs,
  hero_slides, experiences, categories, settings CASCADE;

-- ---------- catalog ----------

CREATE TABLE categories (
  id          text PRIMARY KEY,              -- adventure | nature | kids | tours
  name        text NOT NULL,
  badge       text NOT NULL,
  color       text NOT NULL,
  fg          text NOT NULL,
  pulse       text NOT NULL
);

CREATE TABLE experiences (
  id             text PRIMARY KEY,           -- zipline, quad, ...
  name           text NOT NULL,
  category_id    text NOT NULL REFERENCES categories(id),
  thrill         int  NOT NULL CHECK (thrill BETWEEN 1 AND 5),
  duration_label text NOT NULL,
  age_label      text NOT NULL,
  base_price     int  NOT NULL DEFAULT 0,    -- "from" price (MUR); equals resident rate where rates differ
  price_mode     text NOT NULL CHECK (price_mode IN ('pp','flat','entry','kiosk')),
  flat_label     text,                       -- e.g. '/ buggy' when price_mode='flat'
  image          text NOT NULL,
  blurb          text NOT NULL,
  detail         text,
  price_rr       int,                        -- rate-dependent "from" prices (null = not rate dependent)
  price_nr       int,
  sort_order     int NOT NULL
);

CREATE TABLE experience_facts (               -- "good to know" bullets
  id            serial PRIMARY KEY,
  experience_id text NOT NULL REFERENCES experiences(id) ON DELETE CASCADE,
  text          text NOT NULL,
  sort_order    int  NOT NULL
);

CREATE TABLE experience_galleries (           -- editorial gallery blocks on detail pages
  experience_id text PRIMARY KEY REFERENCES experiences(id) ON DELETE CASCADE,
  eyebrow       text NOT NULL,
  t1            text NOT NULL,
  t2            text NOT NULL,
  copy          text NOT NULL,
  foot          text NOT NULL,
  cta           text NOT NULL
);

CREATE TABLE gallery_shots (
  id            serial PRIMARY KEY,
  experience_id text NOT NULL REFERENCES experience_galleries(experience_id) ON DELETE CASCADE,
  src           text NOT NULL,
  tag           text NOT NULL,
  cap           text NOT NULL,
  pos           text,                        -- optional object-position override
  sort_order    int  NOT NULL
);

CREATE TABLE map_pins (
  id            serial PRIMARY KEY,
  code          text NOT NULL,               -- A..J, GZ, W
  px            numeric(5,1) NOT NULL,       -- % from left
  py            numeric(5,1) NOT NULL,       -- % from top
  kind          text NOT NULL CHECK (kind IN ('main','sub')),
  name          text NOT NULL,
  sub           text,
  image         text NOT NULL,
  btn_label     text,
  experience_id text REFERENCES experiences(id),
  go_target     text,                        -- plan | chamouze | citronelle | kids
  sort_order    int NOT NULL
);

-- ---------- dining ----------

CREATE TABLE restaurants (
  id            text PRIMARY KEY,            -- chamouze | citronelle
  name          text NOT NULL,
  badge         text NOT NULL,
  image         text NOT NULL,
  tag           text NOT NULL,
  cuisine       text NOT NULL,
  hours_label   text NOT NULL,
  price_label   text NOT NULL,
  setting_label text NOT NULL,
  about         text NOT NULL,
  detail        text NOT NULL,
  menu_pdf      text NOT NULL DEFAULT '',
  sort_order    int NOT NULL
);

CREATE TABLE restaurant_gallery (
  id            serial PRIMARY KEY,
  restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  src           text NOT NULL,
  sort_order    int  NOT NULL
);

CREATE TABLE menu_groups (
  id            serial PRIMARY KEY,
  restaurant_id text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  title         text NOT NULL,
  sort_order    int  NOT NULL
);

CREATE TABLE menu_items (
  id          serial PRIMARY KEY,
  group_id    int  NOT NULL REFERENCES menu_groups(id) ON DELETE CASCADE,
  name        text NOT NULL,
  note        text NOT NULL DEFAULT '',
  price_label text NOT NULL,
  sort_order  int  NOT NULL
);

-- ---------- packages ----------

CREATE TABLE package_tiers (
  id           serial PRIMARY KEY,
  family       text NOT NULL CHECK (family IN ('ls','ex')),   -- Light/Standard | Exclusive tiers
  name         text NOT NULL,
  badge        text,
  color        text NOT NULL,
  fg           text,
  image        text NOT NULL,
  single_label text NOT NULL,               -- e.g. 'Rs 11,100'
  dbl_label    text NOT NULL,
  note         text,
  hero         text,
  sort_order   int NOT NULL
);

CREATE TABLE package_tier_items (
  id         serial PRIMARY KEY,
  tier_id    int  NOT NULL REFERENCES package_tiers(id) ON DELETE CASCADE,
  text       text NOT NULL,
  sort_order int  NOT NULL
);

CREATE TABLE package_addons (
  id          serial PRIMARY KEY,
  text        text NOT NULL,
  price_label text NOT NULL,
  sort_order  int  NOT NULL
);

CREATE TABLE vip_items (                      -- VIP Ultimate inclusions
  id         serial PRIMARY KEY,
  text       text NOT NULL,
  sort_order int  NOT NULL
);

CREATE TABLE combos (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  color      text NOT NULL,
  rr_single  int  NOT NULL,
  rr_dbl     int  NOT NULL,
  nr_single  int  NOT NULL,
  nr_dbl     int  NOT NULL,
  sort_order int  NOT NULL
);

CREATE TABLE combo_items (
  id         serial PRIMARY KEY,
  combo_id   int  NOT NULL REFERENCES combos(id) ON DELETE CASCADE,
  text       text NOT NULL,
  sort_order int  NOT NULL
);

CREATE TABLE cinematic_items (
  id         serial PRIMARY KEY,
  name       text NOT NULL,
  price      int  NOT NULL,
  sort_order int  NOT NULL
);

-- ---------- price list (detail pages + admission) ----------

CREATE TABLE price_list (
  id         serial PRIMARY KEY,
  group_key  text NOT NULL,                  -- 'admission' or an experience id
  label      text NOT NULL,
  rr         int  NOT NULL,                  -- resident MUR (0 = FREE)
  nr         int  NOT NULL,                  -- non-resident MUR
  sort_order int  NOT NULL
);
CREATE INDEX idx_price_list_group ON price_list(group_key);

-- ---------- photo packages ----------

CREATE TABLE photo_tiers (
  id               serial PRIMARY KEY,
  rate             text NOT NULL CHECK (rate IN ('rr','nr')),
  name             text NOT NULL,
  color            text NOT NULL,
  activities_label text NOT NULL,
  single_label     text NOT NULL,
  dbl_label        text NOT NULL,
  sort_order       int  NOT NULL
);

CREATE TABLE photo_addons (
  id          serial PRIMARY KEY,
  rate        text NOT NULL CHECK (rate IN ('rr','nr')),
  text        text NOT NULL,
  price_label text NOT NULL,
  sort_order  int  NOT NULL
);

-- ---------- team building ----------

CREATE TABLE team_packs (
  id         serial PRIMARY KEY,
  image      text NOT NULL,
  sort_order int  NOT NULL
);

CREATE TABLE team_pack_items (
  id           serial PRIMARY KEY,
  team_pack_id int  NOT NULL REFERENCES team_packs(id) ON DELETE CASCADE,
  text         text NOT NULL,
  sort_order   int  NOT NULL
);

-- ---------- home page content ----------

CREATE TABLE hero_slides (
  id         serial PRIMARY KEY,
  src        text NOT NULL,
  sort_order int  NOT NULL
);

-- ---------- settings ----------

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- ---------- staff back office ----------
-- Not linked from anywhere on the public site: reachable only by URL and always
-- behind a login. Defined before the transactional tables because bookings,
-- chat and careers all reference an operator.
--
-- Roles gate which back-office area an account can reach:
--   agent   : reservations dashboard only
--   hr      : careers back office only
--   manager : both

CREATE TABLE staff_users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  role          text NOT NULL DEFAULT 'agent'
                  CHECK (role IN ('agent','hr','manager')),
  password_hash text NOT NULL,              -- bcrypt
  active        boolean NOT NULL DEFAULT true,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- transactions ----------

CREATE TABLE bookings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code     text NOT NULL UNIQUE,          -- VAL-1234-26
  visit_date   date NOT NULL,
  slot         text NOT NULL CHECK (slot IN ('morning','afternoon')),
  adults       int  NOT NULL CHECK (adults BETWEEN 1 AND 12),
  kids         int  NOT NULL CHECK (kids BETWEEN 0 AND 12),
  rate         text NOT NULL CHECK (rate IN ('rr','nr')),
  guest_name   text NOT NULL,
  phone        text NOT NULL DEFAULT '',
  email        text NOT NULL DEFAULT '',
  nationality  text NOT NULL DEFAULT '',
  pay_mode     text NOT NULL CHECK (pay_mode IN ('gate','online')),
  status       text NOT NULL DEFAULT 'confirmed'
                 CHECK (status IN ('confirmed','arrived','cancelled')),
  entry_amount int  NOT NULL,
  subtotal     int  NOT NULL,                 -- before discount, incl. entry
  discount     int  NOT NULL DEFAULT 0,
  total        int  NOT NULL,
  currency     text NOT NULL DEFAULT 'MUR',
  staff_note   text NOT NULL DEFAULT '',      -- internal only, never returned publicly
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_visit  ON bookings(visit_date, status);
CREATE INDEX idx_bookings_created ON bookings(created_at DESC);

-- Every staff change to a reservation, so an edit can always be traced back.
CREATE TABLE booking_audit (
  id          bigserial PRIMARY KEY,
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  staff_id    uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  staff_email text NOT NULL DEFAULT '',       -- kept even if the account is deleted
  action      text NOT NULL,                  -- edit | status | note
  changes     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_booking_audit_booking ON booking_audit(booking_id, created_at DESC);

CREATE TABLE booking_lines (
  id            serial PRIMARY KEY,
  booking_id    uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  experience_id text REFERENCES experiences(id),  -- null for the park-entry line
  label         text NOT NULL,
  adults        int  NOT NULL DEFAULT 0,
  kids          int  NOT NULL DEFAULT 0,
  units         int  NOT NULL DEFAULT 0,
  amount        int  NOT NULL,
  sort_order    int  NOT NULL
);

CREATE TABLE quotes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  company        text NOT NULL DEFAULT '',
  email          text NOT NULL,
  phone          text NOT NULL DEFAULT '',
  group_size     text NOT NULL DEFAULT '',
  preferred_date text NOT NULL DEFAULT '',
  message        text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- live chat ----------

CREATE TABLE chat_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_key     text NOT NULL,             -- opaque id held in the visitor's browser
  visitor_name    text NOT NULL DEFAULT '',
  visitor_email   text NOT NULL DEFAULT '',
  subject         text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  assigned_to     uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  unread_staff    int  NOT NULL DEFAULT 0,   -- messages awaiting a staff reply
  unread_visitor  int  NOT NULL DEFAULT 0,   -- replies the visitor has not seen
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_conv_visitor ON chat_conversations(visitor_key);
CREATE INDEX idx_chat_conv_recent  ON chat_conversations(status, last_message_at DESC);

CREATE TABLE chat_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender          text NOT NULL CHECK (sender IN ('visitor','staff','system')),
  staff_user_id   uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  body            text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_chat_msg_conv ON chat_messages(conversation_id, created_at);

-- ---------- careers ----------
-- Public site lists `published` vacancies at /vacancies; HR manages them at /hr.

CREATE TABLE job_vacancies (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text NOT NULL UNIQUE,          -- url-safe, e.g. zipline-guide
  title         text NOT NULL,
  department    text NOT NULL DEFAULT '',      -- Adventure, Food & Beverage, ...
  location      text NOT NULL DEFAULT 'Chamouny, Mauritius',
  employment    text NOT NULL DEFAULT 'full-time'
                  CHECK (employment IN ('full-time','part-time','seasonal','internship')),
  summary       text NOT NULL DEFAULT '',      -- one line for the listing card
  description   text NOT NULL DEFAULT '',
  requirements  text NOT NULL DEFAULT '',      -- one requirement per line
  benefits      text NOT NULL DEFAULT '',
  salary_range  text NOT NULL DEFAULT '',
  status        text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','published','closed')),
  closes_on     date,
  created_by    uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_vacancies_public ON job_vacancies(status, created_at DESC);

CREATE TABLE job_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id    uuid NOT NULL REFERENCES job_vacancies(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  email         text NOT NULL,
  phone         text NOT NULL DEFAULT '',
  -- A link to a CV rather than an upload: accepting binaries from the public
  -- internet is a malware and storage-abuse surface this site does not need.
  cv_url        text NOT NULL DEFAULT '',
  cover_letter  text NOT NULL DEFAULT '',
  years_experience int,
  status        text NOT NULL DEFAULT 'new'
                  CHECK (status IN ('new','reviewing','shortlisted','interviewed','offered','rejected','hired')),
  hr_note       text NOT NULL DEFAULT '',      -- internal only
  reviewed_by   uuid REFERENCES staff_users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_applications_vacancy ON job_applications(vacancy_id, created_at DESC);
CREATE INDEX idx_applications_status  ON job_applications(status, created_at DESC);

COMMIT;
