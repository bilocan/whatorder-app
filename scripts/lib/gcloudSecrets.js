const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

function repoRoot() {
  return path.resolve(__dirname, '..', '..');
}

function resolveProject(explicit) {
  return (
    explicit ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    require('../env-secrets.config').projectDefault
  );
}

function gcloudBin() {
  return process.env.GCLOUD_BIN || 'gcloud';
}

function resolveGcloudPs1() {
  const root = process.env.CLOUDSDK_ROOT_DIR;
  if (root) {
    const ps1 = path.join(root, 'bin', 'gcloud.ps1');
    if (fs.existsSync(ps1)) return ps1;
  }
  const candidates = [
    'C:\\Program Files (x86)\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1',
    'C:\\Program Files\\Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.ps1',
  ];
  for (const ps1 of candidates) {
    if (fs.existsSync(ps1)) return ps1;
  }
  const where = spawnSync('where.exe', ['gcloud'], { encoding: 'utf8' });
  if (where.status === 0) {
    for (const line of where.stdout.trim().split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.toLowerCase().endsWith('gcloud.ps1') && fs.existsSync(trimmed)) return trimmed;
      const ps1 = path.join(path.dirname(trimmed), 'gcloud.ps1');
      if (fs.existsSync(ps1)) return ps1;
    }
  }
  return null;
}

function spawnGcloud(args, options = {}) {
  const { encoding = 'utf8', stdio = 'pipe', maxBuffer } = options;
  const spawnOpts = { encoding, stdio, shell: false };
  if (maxBuffer) spawnOpts.maxBuffer = maxBuffer;

  if (process.platform === 'win32') {
    const ps1 = resolveGcloudPs1();
    if (!ps1) {
      return { error: Object.assign(new Error('gcloud.ps1 not found'), { code: 'ENOENT' }) };
    }
    return spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...args],
      spawnOpts,
    );
  }

  return spawnSync(gcloudBin(), args, spawnOpts);
}

function execGcloud(args, options = {}) {
  const result = spawnGcloud(args, { ...options, stdio: 'pipe' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim();
    const err = new Error(detail || `gcloud exited with code ${result.status}`);
    err.status = result.status;
    throw err;
  }
  return result.stdout;
}

function ensureGcloud() {
  const result = spawnGcloud(['--version']);
  if (result.error?.code === 'ENOENT') {
    console.error('[env-secrets] gcloud CLI not found.');
    console.error('Install: https://cloud.google.com/sdk/docs/install');
    console.error('Then: gcloud auth login && gcloud auth application-default login');
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error('[env-secrets] gcloud --version failed:', result.stderr || result.stdout);
    process.exit(1);
  }
}

function sleepSync(ms) {
  try {
    execFileSync(process.platform === 'win32' ? 'powershell' : 'sleep', process.platform === 'win32'
      ? ['-Command', `Start-Sleep -Milliseconds ${ms}`]
      : [String(Math.max(1, Math.ceil(ms / 1000)))], { stdio: 'ignore' });
  } catch {
    const end = Date.now() + ms;
    while (Date.now() < end) { /* fallback busy wait */ }
  }
}

function describeSecret(project, secret, { retries = 3, retryDelayMs = 1500 } = {}) {
  let lastDetail = '';

  for (let attempt = 0; attempt < retries; attempt += 1) {
    const result = spawnGcloud(
      ['secrets', 'describe', secret, `--project=${project}`, '--format=value(name)'],
    );

    if (result.status === 0) {
      return { exists: true };
    }

    if (result.error?.code === 'ENOENT') {
      return { exists: false, reason: 'gcloud-not-found', detail: result.error.message };
    }

    lastDetail = (result.stderr || result.stdout || '').trim();
    const lower = lastDetail.toLowerCase();

    if (lower.includes('permission_denied') || lower.includes('permission denied')) {
      return { exists: false, reason: 'permission-denied', detail: lastDetail };
    }

    if (lower.includes('not found') || lower.includes('not_found')) {
      return { exists: false, reason: 'missing', detail: lastDetail };
    }

    if (attempt < retries - 1) {
      sleepSync(retryDelayMs);
    }
  }

  return {
    exists: false,
    reason: 'describe-failed',
    detail: lastDetail || 'gcloud secrets describe failed',
  };
}

function secretExists(project, secret) {
  return describeSecret(project, secret).exists;
}

function fetchSecret(project, secret) {
  return execGcloud(
    ['secrets', 'versions', 'access', 'latest', `--secret=${secret}`, `--project=${project}`],
    { maxBuffer: 10 * 1024 * 1024 },
  );
}

function createSecret(project, secret) {
  const result = spawnGcloud(
    ['secrets', 'create', secret, `--project=${project}`, '--replication-policy=automatic'],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function addSecretVersion(project, secret, filePath) {
  const result = spawnGcloud(
    ['secrets', 'versions', 'add', secret, `--project=${project}`, `--data-file=${filePath}`],
    { stdio: 'inherit' },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

function parseArgs(argv) {
  const flags = { force: false, dryRun: false, create: false, project: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') flags.force = true;
    else if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--create') flags.create = true;
    else if (arg === '--project' && argv[i + 1]) {
      flags.project = argv[++i];
    } else if (arg === '--help' || arg === '-h') {
      flags.help = true;
    }
  }
  return flags;
}

async function confirm(message) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`${message} [y/N] `, resolve);
  });
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

module.exports = {
  repoRoot,
  resolveProject,
  gcloudBin,
  ensureGcloud,
  describeSecret,
  secretExists,
  fetchSecret,
  createSecret,
  addSecretVersion,
  parseArgs,
  confirm,
  ensureParentDir,
};
