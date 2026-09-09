#!/usr/bin/env node
'use strict';
/**
 * Rotate a back-office login's password.
 *
 *   node scripts/staff-password.js <email> [new password]
 *
 * With no password given, a random 20-character one is generated and printed
 * ONCE. The hash is bcrypt cost 12, the same as the seed, and the row is
 * updated in place, so the change survives redeploys: only `db-init.js
 * --reseed` or `--reset` put the published starter passwords back.
 *
 * Run it wherever the database is reachable. On Railway that is inside the
 * api container:
 *   railway ssh --service api -- node scripts/staff-password.js sales@vallepark.com
 */
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { connect } = require('./lib/db');

const [email, given] = process.argv.slice(2);
if (!email || !email.includes('@')) {
  console.error('Usage: node scripts/staff-password.js <email> [new password]');
  process.exit(2);
}
if (given !== undefined && given.length < 12) {
  console.error('staff-password: a password must be at least 12 characters.');
  process.exit(2);
}

/** 20 chars from an unambiguous alphabet (no 0/O, 1/l/I), so it types correctly off a screen. */
function generate() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 20; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

async function main() {
  const password = given === undefined ? generate() : given;
  const hash = bcrypt.hashSync(password, 12);
  const client = await connect({ attempts: 3, delayMs: 1000 });
  try {
    const res = await client.query(
      'UPDATE staff_users SET password_hash = $1 WHERE lower(email) = lower($2) RETURNING email, role',
      [hash, email],
    );
    if (res.rowCount === 0) throw new Error(`no staff user with email ${email}`);
    console.log(`Password updated for ${res.rows[0].email} (${res.rows[0].role}).`);
    if (given === undefined) console.log(`New password: ${password}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`staff-password: ${err.message}`);
  process.exit(1);
});
