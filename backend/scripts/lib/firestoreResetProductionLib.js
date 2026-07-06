const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Golden infra-only GCS folder under gs://<project>-backups/manual/ */
const DEFAULT_GOLDEN_INFRA_BACKUP = '2026-07-06-infra';

/**
 * The 2026-06-27 exports were empty (316 bytes of metadata, zero documents) —
 * the Windows comma-mangling bug hit the export side. A real infra export
 * (209 docs) is well above this; anything smaller is metadata-only.
 */
const MIN_INFRA_BACKUP_BYTES = 10 * 1024;

const DEFAULT_FIRESTORE_PROJECT = 'whatorder-fire';
const FIRESTORE_DATABASE = '(default)';

/** Test and prod mirror the same layout: <project>-backups in the DB's region. */
function backupsBucketFor(project) {
  return `${project}-backups`;
}

function resolveFirestoreProject() {
  return process.env.FIREBASE_PROJECT_ID || DEFAULT_FIRESTORE_PROJECT;
}

const INFRA_COLLECTION_IDS = [
  'businesses',
  'menu',
  'intentLearnings',
  'phoneRouting',
  'owners',
  'admins',
  'config',
];

const MANUAL_CHECKLIST = [
  'Dashboard — owner login, empty orders for biz_enes_kebap_9450w',
  'WhatsApp — order from Enes kebap (picker or whatorder.at/chat?bid=biz_enes_kebap_9450w); confirm Card/Cash step',
  'Dashboard — order appears; approve flow works',
  'Admin → Earnings — config/whatorder fee loads',
  'Optional — remove test businesses from phoneRouting if production-only',
];

/**
 * @param {string[]} argv
 */
function parseResetProductionArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const confirm = argv.includes('--confirm');
  const skipImport = argv.includes('--skip-import');
  const skipCleanup = argv.includes('--skip-cleanup');
  const skipSmoke = argv.includes('--skip-smoke');

  const backupIdx = argv.indexOf('--infra-backup');
  const infraBackup = backupIdx >= 0 ? argv[backupIdx + 1] : process.env.GOLDEN_INFRA_BACKUP ?? DEFAULT_GOLDEN_INFRA_BACKUP;
  if (backupIdx >= 0 && !infraBackup) {
    throw new Error('Missing value for --infra-backup');
  }

  const project = resolveFirestoreProject();
  const bucket = backupsBucketFor(project);

  return {
    dryRun,
    confirm,
    skipImport,
    skipCleanup,
    skipSmoke,
    infraBackup,
    project,
    gcsImportUri: `gs://${bucket}/manual/${infraBackup}`,
    metadataPath: `gs://${bucket}/manual/${infraBackup}/${infraBackup}.overall_export_metadata`,
    collectionIds: INFRA_COLLECTION_IDS.join(','),
  };
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
  throw new Error('gcloud.ps1 not found. Install Google Cloud SDK or set CLOUDSDK_ROOT_DIR.');
}

function spawnGcloud(args, stdio = 'pipe') {
  const spawnOpts = { encoding: 'utf8', stdio, shell: false };
  if (process.platform === 'win32') {
    return spawnSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolveGcloudPs1(), ...args],
      spawnOpts,
    );
  }
  return spawnSync('gcloud', args, spawnOpts);
}

/**
 * @param {string} metadataPath
 * @param {string} project
 */
function verifyInfraBackupExists(metadataPath, project = resolveFirestoreProject()) {
  const result = spawnGcloud(['storage', 'ls', metadataPath, `--project=${project}`]);
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim();
    throw new Error(
      `Infra backup not found: ${metadataPath}\n${err}\nExport first — see vault firestore-backup-restore.`,
    );
  }
}

/**
 * @param {string} duOutput stdout of `gcloud storage du -s <uri>`
 * @returns {number} total bytes
 */
function parseDuTotalBytes(duOutput) {
  const match = /^\s*(\d+)/.exec(duOutput || '');
  if (!match) {
    throw new Error(`Could not parse total size from gcloud storage du output: ${JSON.stringify(duOutput)}`);
  }
  return Number(match[1]);
}

/**
 * Guards against importing a metadata-only export like the empty 2026-06-27
 * folders — restoring one wipes the DB and brings back zero documents.
 *
 * @param {string} gcsImportUri
 * @param {string} project
 */
function verifyInfraBackupNotEmpty(gcsImportUri, project = resolveFirestoreProject()) {
  const result = spawnGcloud(['storage', 'du', '-s', gcsImportUri, `--project=${project}`]);
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim();
    throw new Error(`Could not measure infra backup size: ${gcsImportUri}\n${err}`);
  }
  const totalBytes = parseDuTotalBytes(result.stdout);
  if (totalBytes < MIN_INFRA_BACKUP_BYTES) {
    throw new Error(
      `Infra backup looks empty: ${gcsImportUri} is ${totalBytes} bytes ` +
      `(minimum ${MIN_INFRA_BACKUP_BYTES}). Metadata-only exports import zero documents — ` +
      `re-export and verify doc counts before using it as golden.`,
    );
  }
  return totalBytes;
}

/**
 * @param {string} scriptName e.g. firestore-cleanup.js
 * @param {string[]} args
 */
function runNodeScript(scriptName, args) {
  const scriptsDir = path.join(__dirname, '..');
  const scriptPath = path.join(scriptsDir, scriptName);
  const backendRoot = path.join(scriptsDir, '..');
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: backendRoot,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${scriptName} failed with exit code ${result.status}`);
  }
}

/**
 * Infra-only GCS exports contain only INFRA_COLLECTION_IDS. Omit --collection-ids on
 * import: Node spawn with shell:true on Windows mangles comma-separated flags and
 * Firestore returns "kinds/namespaces are not available".
 *
 * @param {ReturnType<typeof parseResetProductionArgs>} opts
 * @returns {string[]}
 */
function buildFirestoreImportArgs(opts) {
  return [
    'firestore', 'import', opts.gcsImportUri,
    `--project=${opts.project}`,
    '--database', FIRESTORE_DATABASE,
  ];
}

/**
 * @param {ReturnType<typeof parseResetProductionArgs>} opts
 */
function runInfraImport(opts) {
  const result = spawnGcloud(buildFirestoreImportArgs(opts), 'inherit');
  if (result.status !== 0) {
    throw new Error(`gcloud firestore import failed with exit code ${result.status}`);
  }
}

/** @param {ReturnType<typeof parseResetProductionArgs>} opts */
function printResetPlan(opts) {
  console.log('Firestore reset plan\n');
  console.log(`Project: ${opts.project}`);
  console.log(`Golden infra backup: ${opts.infraBackup}`);
  console.log(`GCS: ${opts.gcsImportUri}`);
  console.log(`Collection groups: ${opts.collectionIds}\n`);

  console.log('Steps:');
  if (!opts.skipCleanup) console.log('  1. firestore:cleanup --mode=reset --confirm');
  else console.log('  1. (skip cleanup)');
  if (!opts.skipImport) console.log('  2. gcloud firestore import (infra-only)');
  else console.log('  2. (skip import)');
  if (!opts.skipSmoke) console.log('  3. firestore:smoke');
  else console.log('  3. (skip smoke)');
  console.log('  4. Manual checklist\n');

  console.log('Keeps: businesses, menu, intentLearnings, routing, owners, admins, config');
  console.log('Removes: orders, customers, sessions, processedMessages, stripeEvents');
  console.log('\nRe-run with --confirm to apply (not --dry-run).');
}

function printManualChecklist() {
  console.log('\nManual verification:');
  for (const line of MANUAL_CHECKLIST) {
    console.log(`  - ${line}`);
  }
}

module.exports = {
  DEFAULT_GOLDEN_INFRA_BACKUP,
  MIN_INFRA_BACKUP_BYTES,
  DEFAULT_FIRESTORE_PROJECT,
  FIRESTORE_DATABASE,
  backupsBucketFor,
  resolveFirestoreProject,
  INFRA_COLLECTION_IDS,
  MANUAL_CHECKLIST,
  parseResetProductionArgs,
  buildFirestoreImportArgs,
  parseDuTotalBytes,
  verifyInfraBackupExists,
  verifyInfraBackupNotEmpty,
  runNodeScript,
  runInfraImport,
  printResetPlan,
  printManualChecklist,
};
