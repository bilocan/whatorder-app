const { spawnSync } = require('child_process');
const path = require('path');

/** Golden infra-only GCS folder under gs://whatorder-fire-backups/manual/ */
const DEFAULT_GOLDEN_INFRA_BACKUP = '2026-06-27-in8ra';

const GCS_BUCKET = 'whatorder-fire-backups';
const FIRESTORE_PROJECT = 'whatorder-fire';
const FIRESTORE_DATABASE = '(default)';

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

  return {
    dryRun,
    confirm,
    skipImport,
    skipCleanup,
    skipSmoke,
    infraBackup,
    gcsImportUri: `gs://${GCS_BUCKET}/manual/${infraBackup}`,
    metadataPath: `gs://${GCS_BUCKET}/manual/${infraBackup}/${infraBackup}.overall_export_metadata`,
    collectionIds: INFRA_COLLECTION_IDS.join(','),
  };
}

function spawnGcloud(args, stdio = 'pipe') {
  return spawnSync('gcloud', args, {
    encoding: 'utf8',
    stdio,
    shell: process.platform === 'win32',
  });
}

/**
 * @param {string} metadataPath
 * @param {string} project
 */
function verifyInfraBackupExists(metadataPath, project = FIRESTORE_PROJECT) {
  const result = spawnGcloud(['storage', 'ls', metadataPath, `--project=${project}`]);
  if (result.status !== 0) {
    const err = (result.stderr || result.stdout || '').trim();
    throw new Error(
      `Infra backup not found: ${metadataPath}\n${err}\nExport first — see vault firestore-backup-restore.`,
    );
  }
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
 * @param {ReturnType<typeof parseResetProductionArgs>} opts
 */
function runInfraImport(opts) {
  const result = spawnGcloud(
    [
      'firestore', 'import', opts.gcsImportUri,
      `--project=${FIRESTORE_PROJECT}`,
      `--database=${FIRESTORE_DATABASE}`,
      `--collection-ids=${opts.collectionIds}`,
    ],
    'inherit',
  );
  if (result.status !== 0) {
    throw new Error(`gcloud firestore import failed with exit code ${result.status}`);
  }
}

/** @param {ReturnType<typeof parseResetProductionArgs>} opts */
function printResetPlan(opts) {
  console.log('Production reset plan\n');
  console.log(`Project: ${FIRESTORE_PROJECT}`);
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
  GCS_BUCKET,
  FIRESTORE_PROJECT,
  INFRA_COLLECTION_IDS,
  MANUAL_CHECKLIST,
  parseResetProductionArgs,
  verifyInfraBackupExists,
  runNodeScript,
  runInfraImport,
  printResetPlan,
  printManualChecklist,
};
