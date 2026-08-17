#!/usr/bin/env node
// Upload + publish menu-flow.json to WHATSAPP_MENU_FLOW_ID.
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });
const { spawnSync } = require('child_process');
const path = require('path');

const id = process.env.WHATSAPP_MENU_FLOW_ID;
const token = process.env.WHATSAPP_ACCESS_TOKEN;
const file = path.join(__dirname, '../src/flows/menu-flow.json');

if (!id || !token) {
  console.error('Missing WHATSAPP_MENU_FLOW_ID or WHATSAPP_ACCESS_TOKEN');
  process.exit(1);
}

function curlJson(args) {
  const r = spawnSync('curl', ['-sS', ...args], { encoding: 'utf8' });
  if (r.error) throw r.error;
  const out = r.stdout || '';
  console.log(out);
  let parsed = {};
  try { parsed = JSON.parse(out); } catch { /* ignore */ }
  if (parsed.error) {
    console.error('API error');
    process.exit(1);
  }
  return parsed;
}

const upload = curlJson([
  '-X', 'POST', `https://graph.facebook.com/v21.0/${id}/assets`,
  '-H', `Authorization: Bearer ${token}`,
  '-F', 'name=flow.json',
  '-F', 'asset_type=FLOW_JSON',
  '-F', `file=@${file};type=application/json`,
]);
if (upload.validation_errors?.length) {
  console.error('validation_errors', upload.validation_errors);
  process.exit(1);
}

const pub = curlJson([
  '-X', 'POST', `https://graph.facebook.com/v21.0/${id}/publish`,
  '-H', `Authorization: Bearer ${token}`,
]);
if (!pub.success) process.exit(1);
console.log('Uploaded and published menu Flow', id);
