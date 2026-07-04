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

function ensureGcloud() {
  const result = spawnSync(gcloudBin(), ['--version'], { encoding: 'utf8' });
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
    const result = spawnSync(
      gcloudBin(),
      ['secrets', 'describe', secret, `--project=${project}`, '--format=value(name)'],
      { encoding: 'utf8' },
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
  return execFileSync(
    gcloudBin(),
    ['secrets', 'versions', 'access', 'latest', `--secret=${secret}`, `--project=${project}`],
    { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
  );
}

function createSecret(project, secret) {
  execFileSync(
    gcloudBin(),
    ['secrets', 'create', secret, `--project=${project}`, '--replication-policy=automatic'],
    { stdio: 'inherit' },
  );
}

function addSecretVersion(project, secret, filePath) {
  execFileSync(
    gcloudBin(),
    ['secrets', 'versions', 'add', secret, `--project=${project}`, `--data-file=${filePath}`],
    { stdio: 'inherit' },
  );
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
