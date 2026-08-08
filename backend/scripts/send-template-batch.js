/**
 * Batch-send approved WhatsApp templates from a CSV.
 *
 * Prerequisites: templates Approved in WhatsApp Manager (see vault note
 * whatsapp-messaging-limit-templates-2026-08-07).
 *
 * Usage:
 *   # Preview only (default)
 *   node scripts/send-template-batch.js --csv scripts/data/template-batch.csv --template whatorder_intro_de
 *
 *   # Actually send (max 250 unique / run; Meta daily tier is also 250 until upgrade)
 *   node scripts/send-template-batch.js --csv scripts/data/template-batch.csv --template whatorder_intro_de --send
 *
 * Env: loads .env.production by default (override with --env path).
 * Needs WHATSAPP_ACCESS_TOKEN + WHATSAPP_PHONE_NUMBER_ID.
 *
 * CSV columns (header required):
 *   phone,name[,restaurant,order_id,status]
 * phone: +43660... or 43660... (digits; + stripped)
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const BASE_URL = 'https://graph.facebook.com/v21.0';
const DEFAULT_MAX = 250;
const DEFAULT_DELAY_MS = 800;

// Language codes must match WhatsApp Manager exactly (these were submitted as de_AT).
const TEMPLATES = {
  whatorder_intro_de: {
    language: 'de_AT',
    required: ['name'],
    bodyParams: (row) => [row.name],
  },
  whatorder_order_link_de: {
    language: 'de_AT',
    required: ['name', 'restaurant'],
    bodyParams: (row) => [row.name, row.restaurant],
  },
  order_status_update_de: {
    language: 'de_AT',
    required: ['name', 'order_id', 'restaurant', 'status'],
    bodyParams: (row) => [row.name, row.order_id, row.restaurant, row.status],
  },
};

function usage() {
  console.log(`Usage:
  node scripts/send-template-batch.js --csv <file.csv> --template <name> [--send] [--max N] [--delay-ms N] [--env path]

Templates: ${Object.keys(TEMPLATES).join(', ')}
Without --send, dry-run only (no API calls).`);
}

function parseArgs(argv) {
  const out = {
    csv: null,
    template: null,
    send: false,
    max: DEFAULT_MAX,
    delayMs: DEFAULT_DELAY_MS,
    env: path.join(__dirname, '../.env.production'),
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--send') out.send = true;
    else if (a === '--csv') out.csv = argv[++i];
    else if (a === '--template') out.template = argv[++i];
    else if (a === '--max') out.max = Number(argv[++i]);
    else if (a === '--delay-ms') out.delayMs = Number(argv[++i]);
    else if (a === '--env') out.env = argv[++i];
    else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown arg: ${a}`);
      usage();
      process.exit(1);
    }
  }
  return out;
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Env file not found: ${filePath}`);
  }
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r/g, '');
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const i = line.indexOf('=');
    const key = line.slice(0, i).trim();
    let val = line.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] == null) process.env[key] = val;
  }
}

function maskPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length <= 4) return '****';
  return `***${digits.slice(-4)}`;
}

function normalizePhone(phone) {
  let digits = String(phone ?? '').replace(/\D/g, '');
  // Excel / international dialing often stores 00CC…; Meta wants CC… without the 00 prefix.
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 8) {
    throw new Error(`Invalid phone: ${maskPhone(phone)}`);
  }
  return digits;
}

/** Minimal CSV parser: header row, comma-separated, supports "quoted, fields". */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === '' && rows.length === 0) {
      row = [];
      return;
    }
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      pushField();
      continue;
    }
    if (c === '\n') {
      pushField();
      pushRow();
      continue;
    }
    if (c === '\r') continue;
    field += c;
  }
  if (field.length || row.length) {
    pushField();
    pushRow();
  }

  if (rows.length < 2) return [];
  // Strip UTF-8 BOM so Excel exports map to `phone` instead of `\ufeffphone`.
  const headers = rows[0].map((h, idx) => {
    let key = h.trim().toLowerCase();
    if (idx === 0) key = key.replace(/^\ufeff/, '');
    return key;
  });
  return rows.slice(1)
    .filter((r) => r.some((cell) => String(cell).trim() !== ''))
    .map((r) => {
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? '').trim();
      });
      return obj;
    })
    // Ignore accidental re-pasted header rows mid-file.
    .filter((obj) => obj.phone && obj.phone.toLowerCase() !== 'phone');
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendTemplate({ token, phoneNumberId, to, templateName, language, bodyTexts }) {
  const url = `${BASE_URL}/${phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
      components: [
        {
          type: 'body',
          parameters: bodyTexts.map((text) => ({ type: 'text', text: String(text) })),
        },
      ],
    },
  };
  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
  return res.data?.messages?.[0]?.id ?? null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.csv || !args.template) {
    usage();
    process.exit(1);
  }
  if (!TEMPLATES[args.template]) {
    console.error(`Unknown template: ${args.template}`);
    usage();
    process.exit(1);
  }
  if (!Number.isFinite(args.max) || args.max < 1 || args.max > DEFAULT_MAX) {
    console.error(`--max must be 1..${DEFAULT_MAX} (Meta TIER_250 daily unique cap)`);
    process.exit(1);
  }

  loadEnvFile(args.env);
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (!token || !phoneNumberId) {
    console.error('Missing WHATSAPP_ACCESS_TOKEN or WHATSAPP_PHONE_NUMBER_ID in env file');
    process.exit(1);
  }

  const csvPath = path.isAbsolute(args.csv) ? args.csv : path.join(process.cwd(), args.csv);
  if (!fs.existsSync(csvPath)) {
    console.error(`CSV not found: ${csvPath}`);
    process.exit(1);
  }

  const def = TEMPLATES[args.template];
  const rawRows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  const seen = new Set();
  const rows = [];
  const skipped = [];

  for (const row of rawRows) {
    let phone;
    try {
      phone = normalizePhone(row.phone);
    } catch (err) {
      skipped.push({ reason: err.message, row });
      continue;
    }
    if (seen.has(phone)) {
      skipped.push({ reason: `duplicate ${maskPhone(phone)}`, row });
      continue;
    }
    const missing = def.required.filter((k) => !row[k]);
    if (missing.length) {
      skipped.push({ reason: `missing ${missing.join(',')}`, row });
      continue;
    }
    seen.add(phone);
    rows.push({ ...row, phone });
  }

  const batch = rows.slice(0, args.max);
  console.log(`Template: ${args.template}`);
  console.log(`Mode: ${args.send ? 'SEND' : 'DRY-RUN'}`);
  console.log(`Phone number id: ${phoneNumberId}`);
  console.log(`Rows ready: ${batch.length} (capped at --max ${args.max}; csv unique ok=${rows.length}, skipped=${skipped.length})`);
  if (skipped.length) {
    for (const s of skipped.slice(0, 10)) {
      console.log(`  skip: ${s.reason}`);
    }
    if (skipped.length > 10) console.log(`  … +${skipped.length - 10} more skips`);
  }

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < batch.length; i++) {
    const row = batch[i];
    const label = `${i + 1}/${batch.length} ${maskPhone(row.phone)}`;
    const bodyTexts = def.bodyParams(row);
    if (!args.send) {
      console.log(`  dry-run ${label} params=${JSON.stringify(bodyTexts)}`);
      ok++;
      continue;
    }
    try {
      const mid = await sendTemplate({
        token,
        phoneNumberId,
        to: row.phone,
        templateName: args.template,
        language: def.language,
        bodyTexts,
      });
      console.log(`  sent ${label} wamid=${mid || 'ok'}`);
      ok++;
    } catch (err) {
      const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      console.error(`  FAIL ${label} — ${detail}`);
      fail++;
    }
    if (i < batch.length - 1) await sleep(args.delayMs);
  }

  console.log(`Done. ok=${ok} fail=${fail}`);
  if (!args.send) {
    console.log('Re-run with --send to deliver. Templates must be Approved first.');
  }
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
