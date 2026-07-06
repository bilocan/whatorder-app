/**
 * Reset a Firestore environment to a clean baseline. Target project comes from
 * FIREBASE_PROJECT_ID (default whatorder-fire = Test); the backups bucket is
 * derived as <project>-backups, so the same script serves test and prod.
 *   1. Delete transactional data (cleanup reset)
 *   2. Import golden infra-only GCS backup
 *   3. Run automated smoke tests
 *   4. Print manual checklist
 *
 * Usage:
 *   npm run firestore:reset-production -- --dry-run
 *   npm run firestore:reset-production -- --confirm
 *   npm run firestore:reset-production -- --confirm --infra-backup=2026-07-06-infra
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env.local') });

const {
  parseResetProductionArgs,
  verifyInfraBackupExists,
  verifyInfraBackupNotEmpty,
  runNodeScript,
  runInfraImport,
  printResetPlan,
  printManualChecklist,
} = require('./lib/firestoreResetProductionLib');

async function main() {
  const opts = parseResetProductionArgs(process.argv.slice(2));

  if (opts.dryRun) {
    printResetPlan(opts);
    try {
      verifyInfraBackupExists(opts.metadataPath, opts.project);
      const totalBytes = verifyInfraBackupNotEmpty(opts.gcsImportUri, opts.project);
      console.log(`Backup OK (${totalBytes} bytes): ${opts.metadataPath}`);
    } catch (err) {
      console.error(String(err.message));
      process.exitCode = 1;
    }
    printManualChecklist();
    return;
  }

  if (!opts.confirm) {
    console.error('Refusing to reset without --confirm. Preview with --dry-run first.');
    process.exit(1);
  }

  console.log(`Firestore reset — ${opts.project}\n`);
  printResetPlan(opts);

  if (!opts.skipImport) {
    console.log('\nVerifying infra backup…');
    verifyInfraBackupExists(opts.metadataPath, opts.project);
    const totalBytes = verifyInfraBackupNotEmpty(opts.gcsImportUri, opts.project);
    console.log(`Backup found (${totalBytes} bytes).`);
  }

  if (!opts.skipCleanup) {
    console.log('\n--- Step 1: cleanup (transactional data) ---');
    runNodeScript('firestore-cleanup.js', ['--mode=reset', '--confirm']);
  }

  if (!opts.skipImport) {
    console.log('\n--- Step 2: infra-only import ---');
    runInfraImport(opts);
  }

  if (!opts.skipSmoke) {
    console.log('\n--- Step 3: smoke tests ---');
    runNodeScript('firestore-smoke.js', []);
  }

  console.log('\n--- Step 4: manual checks ---');
  printManualChecklist();
  console.log(`\nFirestore reset complete (${opts.project}).`);
}

main().catch((err) => {
  console.error('Firestore reset failed:', err.message || err);
  process.exit(1);
});
