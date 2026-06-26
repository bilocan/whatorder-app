const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '../backend/.env.local') });

const SECRET_FILE = path.join(__dirname, '../backend/.stripe-listen-secret');
const FORWARD_URL = process.env.STRIPE_LISTEN_FORWARD_URL || 'localhost:3000/webhooks/stripe';

function findStripe() {
  if (process.env.STRIPE_BIN && fs.existsSync(process.env.STRIPE_BIN)) {
    return process.env.STRIPE_BIN;
  }

  const isWin = process.platform === 'win32';
  const lookupCmd = isWin ? 'where stripe' : 'command -v stripe';
  try {
    const found = execSync(lookupCmd, { encoding: 'utf8', shell: true })
      .trim()
      .split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return found;
  } catch (_) {}

  const candidates = isWin
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Stripe', 'stripe.exe'),
        path.join(os.homedir(), 'scoop', 'shims', 'stripe.exe'),
      ]
    : [
        path.join(os.homedir(), '.local', 'bin', 'stripe'),
        '/usr/local/bin/stripe',
        '/usr/bin/stripe',
      ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  return 'stripe';
}

function skip(message) {
  console.log(`[stripe] ${message}`);
  process.exit(0);
}

function writeListenSecret(secret) {
  fs.writeFileSync(SECRET_FILE, `${secret}\n`, 'utf8');
  console.log('[stripe] Webhook signing secret saved for local backend (.stripe-listen-secret)');
}

function parseSecret(line) {
  const match = String(line).match(/whsec_[a-zA-Z0-9]+/);
  return match ? match[0] : null;
}

if (process.env.STRIPE_DEV_LISTEN === 'false') {
  skip('STRIPE_DEV_LISTEN=false — skipping stripe listen');
}

if (!process.env.STRIPE_SECRET_KEY) {
  skip('STRIPE_SECRET_KEY not set in backend/.env.local — skipping stripe listen');
}

try {
  if (fs.existsSync(SECRET_FILE)) fs.unlinkSync(SECRET_FILE);
} catch (_) {}

const stripe = findStripe();
const child = spawn(
  stripe,
  ['listen', '--forward-to', FORWARD_URL],
  { stdio: ['inherit', 'pipe', 'pipe'] },
);

let secretWritten = false;

function onOutput(chunk) {
  process.stdout.write(chunk);
  if (secretWritten) return;
  const secret = parseSecret(chunk.toString());
  if (secret) {
    writeListenSecret(secret);
    secretWritten = true;
  }
}

child.stdout.on('data', onOutput);
child.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  if (secretWritten) return;
  const secret = parseSecret(chunk.toString());
  if (secret) {
    writeListenSecret(secret);
    secretWritten = true;
  }
});

child.on('error', (err) => {
  if (err.code === 'ENOENT') {
    skip('Stripe CLI not found. Install: https://stripe.com/docs/stripe-cli — or set STRIPE_DEV_LISTEN=false');
  }
  console.error(`[stripe] Failed to start: ${err.message}`);
  process.exit(1);
});

child.on('exit', (code) => {
  try {
    if (fs.existsSync(SECRET_FILE)) fs.unlinkSync(SECRET_FILE);
  } catch (_) {}
  if (code && code !== 0) process.exit(code);
});
