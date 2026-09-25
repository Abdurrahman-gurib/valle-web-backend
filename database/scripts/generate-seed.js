#!/usr/bin/env node
/**
 * VALLÉ Advenature™ Park: seed.sql generator
 *
 * Reads  ../seed/data.json  (authoritative content data)
 * Writes ../seed.sql        (INSERTs for every content table in schema.sql)
 *
 * Usage:  node scripts/generate-seed.js
 * No dependencies: Node core only.
 *
 * bookings / booking_lines / quotes are transactional tables and stay empty.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_PATH = path.join(__dirname, '..', 'seed', 'data.json');
const OUT_PATH = path.join(__dirname, '..', 'seed.sql');

// strip UTF-8 BOM if present
const raw = fs.readFileSync(DATA_PATH, 'utf8').replace(/^﻿/, '');
const data = JSON.parse(raw);

// ---------- SQL helpers ----------

/** SQL string literal ('' escaping); null/undefined -> NULL */
function q(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

/** SQL numeric literal; null/undefined -> NULL */
function num(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v !== 'number' || !isFinite(v)) {
    throw new Error('Not a number: ' + JSON.stringify(v));
  }
  return String(v);
}

const out = [];
const counts = {};

function insert(table, cols, valueRows) {
  if (valueRows.length === 0) return;
  out.push(`-- ${table}`);
  out.push(`INSERT INTO ${table} (${cols.join(', ')}) VALUES`);
  out.push(valueRows.map((r) => `  (${r.join(', ')})`).join(',\n') + ';');
  out.push('');
  counts[table] = (counts[table] || 0) + valueRows.length;
}

// ---------- header ----------

const CONTENT_TABLES = [
  'gallery_shots', 'experience_galleries', 'experience_facts',
  'map_pins', 'menu_items', 'menu_groups', 'restaurant_gallery', 'restaurants',
  'package_tier_items', 'package_tiers', 'package_addons', 'vip_items',
  'combo_items', 'combos', 'cinematic_items', 'price_list',
  'photo_tiers', 'photo_addons', 'team_pack_items', 'team_packs',
  'hero_slides', 'experiences', 'categories', 'settings',
  'job_applications', 'job_vacancies', 'staff_users',
];

out.push('-- =============================================================');
out.push('-- VALLÉ Advenature™ Park: seed data');
out.push('-- GENERATED FILE. Do not edit by hand.');
out.push('-- Regenerate with:  node scripts/generate-seed.js');
out.push('-- Source of truth:  seed/data.json');
out.push('-- Load after schema.sql. Re-runnable (truncates content tables).');
out.push('-- =============================================================');
out.push('');
out.push("SET client_encoding = 'UTF8';");
out.push('');
out.push('BEGIN;');
out.push('');
out.push('TRUNCATE TABLE');
out.push('  ' + CONTENT_TABLES.join(', '));
out.push('RESTART IDENTITY CASCADE;');
out.push('');

// ---------- categories ----------

const CAT_ORDER = ['adventure', 'nature', 'kids', 'tours'];
insert('categories', ['id', 'name', 'badge', 'color', 'fg', 'pulse'],
  CAT_ORDER.map((id) => {
    const c = data.CAT[id];
    return [q(id), q(c.name), q(c.badge), q(c.color), q(c.fg), q(c.pulse)];
  })
);

// ---------- experiences ----------

insert('experiences',
  ['id', 'name', 'category_id', 'thrill', 'duration_label', 'age_label',
   'base_price', 'price_mode', 'flat_label', 'image', 'blurb', 'detail',
   'price_rr', 'price_nr', 'sort_order'],
  data.ACTS.map((a, i) => {
    const rate = data.RATEP[a.id] || null;
    return [
      q(a.id), q(a.name), q(a.cat), num(a.thrill), q(a.dur), q(a.age),
      num(a.price), q(a.mode), q(a.flatLabel ?? null), q(a.img), q(a.blurb),
      q(a.detail ?? null),
      rate ? num(rate[0]) : 'NULL',
      rate ? num(rate[1]) : 'NULL',
      num(i),
    ];
  })
);

// ---------- experience_facts ("good to know") ----------

{
  const rows = [];
  for (const a of data.ACTS) {
    (a.gtk || []).forEach((f, i) => {
      rows.push([q(a.id), q(f.t), num(i)]);
    });
  }
  insert('experience_facts', ['experience_id', 'text', 'sort_order'], rows);
}

// ---------- experience_galleries + gallery_shots ----------

{
  const galRows = [];
  const shotRows = [];
  for (const [expId, g] of Object.entries(data.GAL)) {
    galRows.push([q(expId), q(g.eyebrow), q(g.t1), q(g.t2), q(g.copy), q(g.foot), q(g.cta)]);
    (g.shots || []).forEach((s, i) => {
      shotRows.push([q(expId), q(s.src), q(s.tag), q(s.cap), q(s.pos ?? null), num(i)]);
    });
  }
  insert('experience_galleries',
    ['experience_id', 'eyebrow', 't1', 't2', 'copy', 'foot', 'cta'], galRows);
  insert('gallery_shots',
    ['experience_id', 'src', 'tag', 'cap', 'pos', 'sort_order'], shotRows);
}

// ---------- map_pins ----------

insert('map_pins',
  ['code', 'px', 'py', 'kind', 'name', 'sub', 'image', 'btn_label',
   'experience_id', 'go_target', 'sort_order'],
  data.PINS.map((p, i) => [
    q(p.n), num(p.px), num(p.py), q(p.kind), q(p.name), q(p.sub ?? null),
    q(p.img), q(p.btnLabel ?? null), q(p.act ?? null), q(p.go ?? null), num(i),
  ])
);

// ---------- restaurants + gallery + menus ----------

{
  const RESTO_ORDER = ['chamouze', 'citronelle'];
  const restoRows = [];
  const galleryRows = [];
  const groupRows = [];
  const itemRows = [];
  let groupId = 0;

  RESTO_ORDER.forEach((rid, ri) => {
    const r = data.RESTOS[rid];
    restoRows.push([
      q(rid), q(r.name), q(r.badge), q(r.img), q(r.tag), q(r.cuisine),
      q(r.hours), q(r.price), q(r.setting), q(r.about), q(r.detail),
      q(r.menuPdf ?? ''), num(ri),
    ]);
    (r.gallery || []).forEach((src, i) => {
      galleryRows.push([q(rid), q(src), num(i)]);
    });
    (r.menuGroups || []).forEach((g, gi) => {
      groupId += 1;
      groupRows.push([num(groupId), q(rid), q(g.title), num(gi)]);
      (g.items || []).forEach((it, ii) => {
        itemRows.push([num(groupId), q(it.n), q(it.note ?? ''), q(it.p), num(ii)]);
      });
    });
  });

  insert('restaurants',
    ['id', 'name', 'badge', 'image', 'tag', 'cuisine', 'hours_label',
     'price_label', 'setting_label', 'about', 'detail', 'menu_pdf', 'sort_order'],
    restoRows);
  insert('restaurant_gallery', ['restaurant_id', 'src', 'sort_order'], galleryRows);
  insert('menu_groups', ['id', 'restaurant_id', 'title', 'sort_order'], groupRows);
  insert('menu_items', ['group_id', 'name', 'note', 'price_label', 'sort_order'], itemRows);
  out.push(`SELECT setval(pg_get_serial_sequence('menu_groups','id'), ${groupId});`);
  out.push('');
}

// ---------- package tiers (ls + ex) ----------

{
  const tierRows = [];
  const itemRows = [];
  let tierId = 0;

  for (const family of ['ls', 'ex', 'diamond', 'resident', 'senior']) {
    (data.PACKS[family] || []).forEach((t, i) => {
      tierId += 1;
      tierRows.push([
        num(tierId), q(family), q(t.name), q(t.badge ?? null), q(t.color),
        q(t.fg ?? null), q(t.img), q(t.single), q(t.dbl),
        q(t.note ?? null), q(t.hero ?? null), num(i),
      ]);
      (t.items || []).forEach((it, ii) => {
        itemRows.push([num(tierId), q(it.t), num(ii)]);
      });
    });
  }

  insert('package_tiers',
    ['id', 'family', 'name', 'badge', 'color', 'fg', 'image',
     'single_label', 'dbl_label', 'note', 'hero', 'sort_order'],
    tierRows);
  insert('package_tier_items', ['tier_id', 'text', 'sort_order'], itemRows);
  out.push(`SELECT setval(pg_get_serial_sequence('package_tiers','id'), ${tierId});`);
  out.push('');
}

// ---------- package_addons ----------

insert('package_addons', ['text', 'price_label', 'sort_order'],
  data.PACKS.addons.map((a, i) => [q(a.t), q(a.p), num(i)])
);

// ---------- vip_items ----------

insert('vip_items', ['text', 'sort_order'],
  data.PACKS.vip.map((v, i) => [q(v.t), num(i)])
);

// ---------- combos + combo_items ----------

{
  const comboRows = [];
  const itemRows = [];
  data.COMBO.forEach((c, i) => {
    const id = i + 1;
    comboRows.push([
      num(id), q(c.name), q(c.color),
      num(c.rr[0]), num(c.rr[1]), num(c.nr[0]), num(c.nr[1]), num(i),
    ]);
    (c.items || []).forEach((it, ii) => {
      itemRows.push([num(id), q(it.t), num(ii)]);
    });
  });
  insert('combos',
    ['id', 'name', 'color', 'rr_single', 'rr_dbl', 'nr_single', 'nr_dbl', 'sort_order'],
    comboRows);
  insert('combo_items', ['combo_id', 'text', 'sort_order'], itemRows);
  out.push(`SELECT setval(pg_get_serial_sequence('combos','id'), ${data.COMBO.length});`);
  out.push('');
}

// ---------- cinematic_items ----------

insert('cinematic_items', ['name', 'price', 'sort_order'],
  data.CINE.map((c, i) => [q(c.n), num(c.p), num(i)])
);

// ---------- price_list ----------

{
  const rows = [];
  for (const [groupKey, items] of Object.entries(data.PL)) {
    items.forEach((it, i) => {
      rows.push([q(groupKey), q(it.n), num(it.rr), num(it.nr), num(i)]);
    });
  }
  insert('price_list', ['group_key', 'label', 'rr', 'nr', 'sort_order'], rows);
}

// ---------- photo_tiers + photo_addons ----------

{
  const tierRows = [];
  const addonRows = [];
  for (const rate of ['rr', 'nr']) {
    const p = data.PHOTO[rate];
    (p.tiers || []).forEach((t, i) => {
      tierRows.push([q(rate), q(t.name), q(t.color), q(t.act), q(t.single), q(t.dbl), num(i)]);
    });
    (p.addons || []).forEach((a, i) => {
      addonRows.push([q(rate), q(a.t), q(a.p), num(i)]);
    });
  }
  insert('photo_tiers',
    ['rate', 'name', 'color', 'activities_label', 'single_label', 'dbl_label', 'sort_order'],
    tierRows);
  insert('photo_addons', ['rate', 'text', 'price_label', 'sort_order'], addonRows);
}

// ---------- team_packs + team_pack_items ----------

{
  const packRows = [];
  const itemRows = [];
  data.TEAM.forEach((p, i) => {
    const id = i + 1;
    packRows.push([num(id), q(p.img), num(i)]);
    (p.items || []).forEach((it, ii) => {
      itemRows.push([num(id), q(it.t), num(ii)]);
    });
  });
  insert('team_packs', ['id', 'image', 'sort_order'], packRows);
  insert('team_pack_items', ['team_pack_id', 'text', 'sort_order'], itemRows);
  out.push(`SELECT setval(pg_get_serial_sequence('team_packs','id'), ${data.TEAM.length});`);
  out.push('');
}

// ---------- hero_slides ----------

insert('hero_slides', ['src', 'sort_order'],
  data.HERO.map((src, i) => [q(src), num(i)])
);

// ---------- settings ----------

insert('settings', ['key', 'value'], [
  [q('entry_adult'), q(String(data.ENTRY_A))],
  [q('entry_child'), q(String(data.ENTRY_C))],
  [q('park_name'), q('VALLÉ Advenature™ Park')],
  [q('whatsapp'), q('+23052928841')],
  [q('email'), q('sales@vallepark.com')],
  [q('phone'), q('+230 660 44 77')],
  [q('hours'), q('Open daily 09:00 – 17:30')],
]);

// ---------- staff_users (back office) ----------
// bcrypt(12) hashes of the documented starter passwords; see database/README.md.
// CHANGE THESE BEFORE ANY PUBLIC DEPLOYMENT.

insert('staff_users', ['email', 'name', 'role', 'password_hash'], [
  [q('sales@vallepark.com'), q('Sales & Reservations'), q('manager'),
    q('$2b$12$CCuxe/PRFDZ/K5m41WfXluFyMLr4L/kbXv7/Pf9.vd3/QsdFpmlsq')],
  [q('agent@vallepark.com'), q('Reservations Agent'), q('agent'),
    q('$2b$12$XA.wxs20zFYndzTe9c4I.uBgxKNWnhP8vgXAP/kaH8lHzdwfdVfuG')],
  [q('hr@vallepark.com'), q('People & Careers'), q('hr'),
    q('$2b$12$y8YCBiUnEI0PHudo/8zrFuMYB66jWgQC449RSj4oyirc3dnh56GCS')],
]);

// ---------- job_vacancies (starter roles so the careers page is not empty) ----------

const VACANCIES = [
  {
    slug: 'zipline-guide', title: 'Zipline Guide', department: 'Adventure',
    employment: 'full-time',
    summary: 'Run the lines, brief the flyers and keep every launch safe.',
    description:
      'You will run guests through the safety briefing, fit and check harnesses, and dispatch flights across our eight zipline routes, from the 300 m waterfall hop to the 5.5 km Advenature Flight. Most of your day is outdoors on the platforms with a small team.',
    requirements: [
      'Comfortable working at height, all day, in all weather',
      'Confident spoken English and French; Creole is a plus',
      'Calm and clear with nervous first-time flyers',
      'Physically fit: the platforms are reached on foot',
      'Rope-access or outdoor-instruction certification is an advantage, training is provided',
    ].join('\n'),
    benefits: 'Full safety training, uniform, staff meal, park access for family on days off.',
    salary_range: 'Negotiable, based on experience',
  },
  {
    slug: 'reservations-agent', title: 'Reservations Agent', department: 'Sales & Reservations',
    employment: 'full-time',
    summary: 'First voice of the park: take bookings, answer questions, build the day.',
    description:
      'You will handle incoming bookings by phone, email and live chat, build packages for families and groups, and hand a clean arrivals list to the gate team each morning.',
    requirements: [
      'Excellent written and spoken English and French',
      'Comfortable working across a booking system, email and live chat at once',
      'Accurate with numbers: our rates differ for residents and visitors',
      'Previous hospitality or contact-centre experience preferred',
    ].join('\n'),
    benefits: 'Weekday hours, staff meal, park access for family on days off.',
    salary_range: 'Rs 22,000 to Rs 28,000 per month',
  },
  {
    slug: 'chef-de-partie-chamouze', title: 'Chef de Partie, Le Chamouzé', department: 'Food & Beverage',
    employment: 'full-time',
    summary: 'Cook Mauritian and European plates beside a waterfall.',
    description:
      'Run your section of the Chamouzé kitchen for a 60-cover lunch service, working with the head chef on menus that pair Mauritian classics with European technique.',
    requirements: [
      'At least two years in a professional kitchen',
      'Confident on your own section during a busy service',
      'Food-hygiene certification or willingness to obtain one',
    ].join('\n'),
    benefits: 'Split shifts finish early, staff meal, uniform and laundry.',
    salary_range: 'Rs 25,000 to Rs 32,000 per month',
  },
  {
    slug: 'seasonal-kids-park-host', title: 'Kids Park Host (Seasonal)', department: 'Kids Park',
    employment: 'seasonal',
    summary: 'Keep the Kids Park zone running, safe and full of laughing.',
    description:
      'Supervise the pirate ship, mini quads, roller coasters and the Kaz Bon Bon kiosk through the peak season, keeping ride queues moving and parents informed.',
    requirements: [
      'Genuinely enjoys working with children aged 3 to 12',
      'Patient, watchful and safety-first',
      'Available weekends and school holidays',
    ].join('\n'),
    benefits: 'Seasonal contract with a route into a permanent role.',
    salary_range: 'Rs 16,000 per month',
  },
];

insert(
  'job_vacancies',
  ['slug', 'title', 'department', 'employment', 'summary', 'description', 'requirements', 'benefits', 'salary_range', 'status'],
  VACANCIES.map((v) => [
    q(v.slug), q(v.title), q(v.department), q(v.employment), q(v.summary),
    q(v.description), q(v.requirements), q(v.benefits), q(v.salary_range), q('published'),
  ]),
);

// ---------- footer ----------

out.push('COMMIT;');
out.push('');

fs.writeFileSync(OUT_PATH, out.join('\n'), 'utf8');

// ---------- report ----------

console.log('Wrote ' + OUT_PATH);
console.log('Row counts:');
let total = 0;
for (const [table, count] of Object.entries(counts)) {
  console.log('  ' + table.padEnd(22) + count);
  total += count;
}
console.log('  ' + 'TOTAL'.padEnd(22) + total);
