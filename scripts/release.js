#!/usr/bin/env node
/**
 * Production release: branch sync PRs, vault changelog rotation, GitHub Release.
 *
 * Usage:
 *   npm run release
 *   npm run release:promote
 *   npm run release:dry-run
 *   npm run release -- --dry-run
 *   npm run release -- --tag v2026.07.0 --yes
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const readline = require('readline');

const {
  PROD_HEALTH_URL,
  PREPROD_VERSION_URL,
  PREPROD_WORKFLOW_NAME,
  RELEASE_WORKFLOW_NAME,
  appRoot,
  vaultRoot,
  parseReleaseArgs,
  suggestNextTag,
  normalizeTag,
  assessReleaseBranches,
  branchSyncState,
  planVaultRelease,
  applyVaultRelease,
  printHelp,
  printReleaseOverview,
  printNextSteps,
  nextStepsForPromoteRequired,
  nextStepsForReleaseComplete,
  nextStepsForDiverged,
  nextStepsForPromoteOnlyAlreadyDone,
  nextStepsForDryRunComplete,
} = require('./lib/releaseLib');
const { confirm } = require('./lib/gcloudSecrets');

function logStep(label) {
  console.log(`\n==> ${label}`);
}

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    encoding: 'utf8',
    stdio: options.inherit ? 'inherit' : 'pipe',
    shell: false,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    const detail = (result.stderr || result.stdout || '').trim();
    throw new Error(detail || `${cmd} ${args.join(' ')} exited with code ${result.status}`);
  }
  return result;
}

function runInDir(cwd, cmd, args, options = {}) {
  return run(cmd, args, { ...options, cwd });
}

function ensureGh() {
  const result = spawnSync('gh', ['--version'], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT' || result.status !== 0) {
    console.error('[release] GitHub CLI (gh) not found or not authenticated.');
    console.error('Install: https://cli.github.com/');
    console.error('Then: gh auth login');
    process.exit(1);
  }
}

function gitFetch(appRootDir) {
  runInDir(appRootDir, 'git', ['fetch', 'origin', 'dev', 'master', '--tags']);
}

function branchCounts(appRootDir) {
  const result = runInDir(
    appRootDir,
    'git',
    ['rev-list', '--left-right', '--count', 'origin/master...origin/dev'],
  );
  const [masterAheadRaw, devAheadRaw] = result.stdout.trim().split(/\s+/);
  return {
    masterAhead: Number.parseInt(masterAheadRaw, 10) || 0,
    devAhead: Number.parseInt(devAheadRaw, 10) || 0,
  };
}

function isAncestor(appRootDir, ancestor, descendant) {
  const result = runInDir(
    appRootDir,
    'git',
    ['merge-base', '--is-ancestor', ancestor, descendant],
    { allowFailure: true },
  );
  return result.status === 0;
}

function isContentSynced(appRootDir) {
  const masterTree = runInDir(appRootDir, 'git', ['rev-parse', 'origin/master^{tree}']).stdout.trim();
  const devTree = runInDir(appRootDir, 'git', ['rev-parse', 'origin/dev^{tree}']).stdout.trim();
  return masterTree === devTree;
}

function inspectBranches(appRootDir) {
  const counts = branchCounts(appRootDir);
  const devInMaster = isAncestor(appRootDir, 'origin/dev', 'origin/master');
  const masterInDev = isAncestor(appRootDir, 'origin/master', 'origin/dev');
  const contentSynced = isContentSynced(appRootDir);
  const assessment = assessReleaseBranches({ devInMaster, masterInDev, contentSynced });

  return {
    counts,
    devInMaster,
    masterInDev,
    contentSynced,
    assessment,
    syncLabel: branchSyncState(counts.devAhead, counts.masterAhead),
  };
}

function listReleaseTags(appRootDir) {
  const result = runInDir(appRootDir, 'git', ['tag', '-l', 'v*']);
  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function findOpenPr(appRootDir, base, head) {
  const result = runInDir(
    appRootDir,
    'gh',
    ['pr', 'list', '--base', base, '--head', head, '--state', 'open', '--json', 'number,url,title'],
    { allowFailure: true },
  );
  if (result.status !== 0) return [];
  try {
    return JSON.parse(result.stdout || '[]');
  } catch {
    return [];
  }
}

function createPromotePr(appRootDir, { dryRun }) {
  const existing = findOpenPr(appRootDir, 'master', 'dev');
  if (existing.length > 0) {
    console.log(`  Promote PR already open: ${existing[0].url}`);
    return existing[0];
  }

  const title = 'release: promote dev to master';
  const body = [
    'Automated promote PR from `npm run release`.',
    '',
    'Merge when CI is green. Then re-run `npm run release` to ship prod.',
  ].join('\n');

  if (dryRun) {
    console.log(`  Would create PR: dev → master (${title})`);
    return null;
  }

  const result = runInDir(appRootDir, 'gh', [
    'pr', 'create',
    '--base', 'master',
    '--head', 'dev',
    '--title', title,
    '--body', body,
  ]);
  const url = result.stdout.trim();
  console.log(`  Created promote PR: ${url}`);
  return { url };
}

function createSyncPr(appRootDir, tag, { dryRun }) {
  const existing = findOpenPr(appRootDir, 'dev', 'master');
  if (existing.length > 0) {
    console.log(`  Sync PR already open: ${existing[0].url}`);
    return existing[0];
  }

  const title = `chore: sync dev with master after ${tag}`;
  const body = [
    `Back-merge \`master\` into \`dev\` after production release **${tag}**.`,
    '',
    'Merge when CI is green so feature branches start from an up-to-date dev.',
  ].join('\n');

  if (dryRun) {
    console.log(`  Would create PR: master → dev (${title})`);
    return null;
  }

  const result = runInDir(appRootDir, 'gh', [
    'pr', 'create',
    '--base', 'dev',
    '--head', 'master',
    '--title', title,
    '--body', body,
  ]);
  const url = result.stdout.trim();
  console.log(`  Created sync PR: ${url}`);
  return { url };
}

async function ensureBranchesReady(appRootDir, flags) {
  gitFetch(appRootDir);
  const branch = inspectBranches(appRootDir);
  const { counts, assessment } = branch;

  logStep('Branch sync check');
  console.log(
    `  origin/dev vs origin/master: dev +${counts.devAhead}, master +${counts.masterAhead} (${branch.syncLabel})`,
  );
  console.log(`  content synced: ${branch.contentSynced ? 'yes' : 'no'} | release gate: ${assessment.reason}`);

  if (counts.masterAhead > 0 && assessment.ready) {
    console.log('  Note: master ahead of dev is normal after a promote merge — not blocking release.');
  }

  if (assessment.ready) {
    if (flags.promoteOnly) {
      logStep('Promote check');
      console.log('  Nothing to promote — origin/master already has dev\'s work.');
      nextStepsForPromoteOnlyAlreadyDone();
      return { ready: false, assessment, promotePrUrl: null, alreadyPromoted: true };
    }
    if (flags.skipPromote || flags.skipSync) {
      console.log('  Warning: branch checks relaxed via --skip-promote / --skip-sync');
    }
    if (!flags.dryRun) {
      printNextSteps('Pass 2 — ship to production (this run will)', [
        'Check preprod /version SHA matches master (unless --skip-preprod-check)',
        'Rotate vault `releases/unreleased.md` → `releases/<tag>.md` and push vault `master`',
        'Publish GitHub Release on `master` (promotes preprod image to live prod)',
        'Watch **Release to Production** + check prod `/health`',
        'Open a **master → dev** sync PR afterward if needed',
      ]);
    }
    return { ready: true, assessment, promotePrUrl: null, shippingPass: true };
  }

  if (assessment.reason === 'diverged') {
    nextStepsForDiverged();
    throw new Error('dev and master have diverged — resolve manually, then re-run release.');
  }

  if (assessment.needsPromote && !flags.skipPromote) {
    logStep('Dev has unpromoted work — promote required before release');
    const pr = createPromotePr(appRootDir, flags);
    const prUrl = pr?.url || null;
    nextStepsForPromoteRequired({ prUrl, dryRun: flags.dryRun });
    if (!flags.dryRun) {
      throw new Error('Stopped — complete the steps above, then re-run npm run release.');
    }
    return { ready: false, assessment, promotePrUrl: prUrl, needsPromote: true };
  }

  if (flags.skipPromote) {
    console.log('  Warning: releasing with unpromoted dev work (--skip-promote)');
    return { ready: true, assessment, promotePrUrl: null };
  }

  return { ready: false, assessment, promotePrUrl: null };
}

function ensureVaultRepo(vaultRootDir) {
  if (!fs.existsSync(vaultRootDir)) {
    throw new Error(`Vault repo not found at ${vaultRootDir}`);
  }
  const gitDir = path.join(vaultRootDir, '.git');
  if (!fs.existsSync(gitDir)) {
    throw new Error(`Vault path is not a git repo: ${vaultRootDir}`);
  }
}

function vaultGitStatus(vaultRootDir) {
  const result = runInDir(vaultRootDir, 'git', ['status', '--porcelain']);
  return result.stdout.trim();
}

async function commitAndPushVault(vaultRootDir, rotation, tag, { dryRun, skipVaultPush, yes }) {
  logStep('Vault changelog');
  console.log(`  Release file: ${rotation.releasedFile}`);
  console.log(`  Reset: ${rotation.unreleasedFile}`);

  if (dryRun) {
    console.log(`  Would write ${path.basename(rotation.releasedFile)} and reset unreleased.md`);
    console.log(`  Would commit vault: chore(release): rotate changelog for ${tag}`);
    console.log('  Would push vault: origin master');
    return;
  }

  if (skipVaultPush) {
    console.log('  Applying vault rotation locally only (--skip-vault-push). Commit manually on vault master.');
    applyVaultRelease(rotation);
    return;
  }

  if (!yes) {
    const ok = awaitConfirm(`Rotate vault changelog and push for ${tag}?`);
    if (!ok) throw new Error('Vault commit cancelled.');
  }

  applyVaultRelease(rotation);

  logStep('Vault git commit');
  const dirty = vaultGitStatus(vaultRootDir);
  if (!dirty) {
    console.log('  No vault changes to commit.');
    return;
  }

  console.log(dirty);

  runInDir(vaultRootDir, 'git', ['checkout', 'master']);
  runInDir(vaultRootDir, 'git', ['pull', 'origin', 'master']);
  runInDir(vaultRootDir, 'git', ['add', 'Projects/WhatOrder/releases/']);
  runInDir(vaultRootDir, 'git', ['commit', '-m', `chore(release): rotate changelog for ${tag}`]);
  runInDir(vaultRootDir, 'git', ['push', 'origin', 'master']);
  console.log('  Vault pushed to origin/master.');
}

async function awaitConfirm(message) {
  return confirm(message);
}

function tagExists(appRootDir, tag) {
  const result = runInDir(appRootDir, 'git', ['tag', '-l', tag]);
  return result.stdout.trim() === tag;
}

async function createGithubRelease(appRootDir, tag, notes, { dryRun, yes }) {
  logStep(`GitHub Release ${tag}`);

  if (dryRun) {
    const notesFile = path.join(os.tmpdir(), `whatorder-release-${tag}.md`);
    console.log(`  Would run: gh release create ${tag} --target master --notes-file ${notesFile}`);
    console.log('  Notes preview:\n');
    console.log(notes.split('\n').slice(0, 20).join('\n'));
    if (notes.split('\n').length > 20) console.log('  ...');
    return;
  }

  if (tagExists(appRootDir, tag)) {
    throw new Error(`Tag ${tag} already exists locally. Pick another tag or delete the old release.`);
  }

  const notesFile = path.join(os.tmpdir(), `whatorder-release-${tag}.md`);
  fs.writeFileSync(notesFile, notes, 'utf8');

  if (!yes) {
    const ok = awaitConfirm(`Publish GitHub Release ${tag} to production?`);
    if (!ok) throw new Error('Release cancelled.');
  }

  runInDir(appRootDir, 'gh', [
    'release', 'create', tag,
    '--target', 'master',
    '--notes-file', notesFile,
  ], { inherit: true });

  console.log(`  Release published: https://github.com/bilocan/whatorder-app/releases/tag/${tag}`);
}

function watchReleaseWorkflow(appRootDir, flags) {
  if (flags.dryRun || flags.skipWatch) return;

  logStep('Watching Release to Production workflow');
  const list = runInDir(
    appRootDir,
    'gh',
    ['run', 'list', '--workflow', RELEASE_WORKFLOW_NAME, '--limit', '1', '--json', 'databaseId,status,url'],
  );
  let runs;
  try {
    runs = JSON.parse(list.stdout || '[]');
  } catch {
    runs = [];
  }

  if (!runs.length) {
    console.log('  No workflow run found yet — check GitHub Actions manually.');
    return;
  }

  console.log(`  ${runs[0].url}`);
  runInDir(appRootDir, 'gh', ['run', 'watch', String(runs[0].databaseId)], { inherit: true });
}

async function verifyPreprodSha(appRootDir, flags) {
  if (flags.skipPreprodCheck) {
    console.log('  Skipping preprod check (--skip-preprod-check)');
    return;
  }

  logStep('Preprod SHA check');
  const masterResult = runInDir(appRootDir, 'git', ['rev-parse', 'origin/master']);
  const expected = masterResult.stdout.trim().slice(0, 7);
  console.log(`  Expected master HEAD: ${expected}`);

  if (flags.dryRun) {
    console.log(`  Would GET ${PREPROD_VERSION_URL}`);
    return;
  }

  if (typeof fetch !== 'function') {
    console.log(`  Manual check: ${PREPROD_VERSION_URL} → gitSha should be ${expected}`);
    return;
  }

  const res = await fetch(PREPROD_VERSION_URL);
  if (!res.ok) throw new Error(`Preprod /version HTTP ${res.status}`);
  const body = await res.json().catch(() => ({}));
  const actual = body.gitSha || '';
  if (actual !== expected) {
    throw new Error(
      `Preprod serves ${actual || '(none)'} but master is ${expected}. `
      + `Wait for **${PREPROD_WORKFLOW_NAME}** on master, or re-run it.`,
    );
  }
  console.log(`  OK: preprod serves ${actual}`);
}

function verifyProdHealth({ dryRun }) {
  logStep('Prod health check');
  if (dryRun) {
    console.log(`  Would GET ${PROD_HEALTH_URL}`);
    return;
  }

  if (typeof fetch !== 'function') {
    console.log(`  Manual check: ${PROD_HEALTH_URL}`);
    return;
  }

  return fetch(PROD_HEALTH_URL)
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json().catch(() => ({}));
      const versionLine = body.version
        ? ` (${body.environment ?? '?'} · ${body.version}${body.gitSha ? ` · ${body.gitSha}` : ''})`
        : '';
      console.log(`  OK: ${PROD_HEALTH_URL}${versionLine}`);
    })
    .catch((err) => {
      console.error(`  FAIL: ${PROD_HEALTH_URL} (${err.message})`);
      console.error('  Deploy may still be running — check GitHub Actions.');
    });
}

// Most recent release tag reachable from origin/master. Must be read BEFORE
// the new release tag is created, or it returns the tag being shipped.
function latestReleaseTag(appRootDir) {
  const result = runInDir(
    appRootDir,
    'git',
    ['describe', '--tags', '--abbrev=0', 'origin/master'],
    { allowFailure: true },
  );
  return result.status === 0 ? result.stdout.trim() : null;
}

const SEED_MAX_AGE_DAYS = 14;

// The Docker image bakes backend/src/data/intentLearnings.seed.json at the
// preprod build, so a refresh only helps BEFORE the promote merge — surface
// the state on every pass and nag when the snapshot is empty or stale.
function intentSeedReminder(appRootDir) {
  const seedPath = path.join(appRootDir, 'backend', 'src', 'data', 'intentLearnings.seed.json');
  logStep('Intent seed (baked learnings)');

  if (!fs.existsSync(seedPath)) {
    console.log('  Seed file missing — the image will ship without baked learnings.');
    return;
  }

  let seed;
  try {
    seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
  } catch {
    console.log(`  Seed file unreadable (${seedPath}) — fix or regenerate before promoting.`);
    return;
  }

  const count = Object.values(seed.businesses ?? {})
    .reduce((n, entries) => n + Object.keys(entries ?? {}).length, 0);
  const ageDays = seed.generatedAt
    ? Math.floor((Date.now() - Date.parse(seed.generatedAt)) / 86400000)
    : null;
  console.log(
    `  ${count} entr(ies) · release ${seed.release ?? '(none)'} · generated ${
      ageDays === null ? 'never' : `${ageDays}d ago`}`,
  );

  if (!count || ageDays === null || ageDays > SEED_MAX_AGE_DAYS) {
    console.log('  Snapshot is empty or stale — refresh before the promote merge:');
    console.log('    cd backend && npm run intent:seed-export -- --release=<tag> --write');
    console.log('    npm run intent:seed-verify   # gate: every entry must replay');
    console.log('  Commit the seed diff so the preprod image build picks it up.');
  }
}

function firestoreRulesReminder(appRootDir, previousTag) {
  const rulesPath = path.join(appRootDir, 'firestore.rules');
  if (!fs.existsSync(rulesPath)) return;

  // Only remind when rules/indexes actually changed since the previous
  // release — an unconditional reminder gets tuned out and ignored.
  const range = previousTag ? `${previousTag}..origin/master` : 'origin/master';
  const result = runInDir(
    appRootDir,
    'git',
    ['log', '-1', '--format=%H', range, '--', 'firestore.rules', 'firestore.indexes.json'],
    { allowFailure: true },
  );
  if (result.stdout.trim()) {
    const since = previousTag ? `since ${previousTag}` : 'in history (no previous release tag found)';
    console.log(`\nfirestore.rules or firestore.indexes.json changed ${since} — deploy manually:`);
    console.log('  npx firebase-tools deploy --only firestore -P prod   # (default) DB');
    console.log('  npm run firestore:deploy-preprod                     # preprod DB');
  }
}

async function main() {
  const flags = parseReleaseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  ensureGh();
  printReleaseOverview();

  if (flags.dryRun) {
    console.log('\n*** DRY RUN — no vault writes, PRs, tags, or GitHub Release ***\n');
  }

  const root = appRoot();
  const vault = vaultRoot(root);
  ensureVaultRepo(vault);

  intentSeedReminder(root);

  const branchGate = await ensureBranchesReady(root, flags);
  if (branchGate.alreadyPromoted) {
    return;
  }
  if (!branchGate.ready && flags.dryRun) {
    if (!branchGate.needsPromote) {
      nextStepsForPromoteRequired({ dryRun: true });
    }
    return;
  }
  if (!branchGate.ready) {
    return;
  }

  if (!flags.dryRun && !flags.yes && branchGate.shippingPass) {
    logStep('Preprod smoke required');
    console.log('  master already contains dev\'s work — this is pass 2 (ship to prod).');
    const ok = awaitConfirm('Preprod smoke done for this commit? Continue with production release?');
    if (!ok) {
      throw new Error('Release cancelled — complete Phase 3 preprod smoke, then re-run npm run release.');
    }
  }

  const tags = listReleaseTags(root);
  const tag = normalizeTag(flags.tag) || suggestNextTag(tags);
  const previousTag = latestReleaseTag(root);
  logStep(`Release tag: ${tag}`);

  if (!flags.dryRun && tagExists(root, tag)) {
    throw new Error(`Tag ${tag} already exists locally. Pick another tag or delete the old release.`);
  }

  await verifyPreprodSha(root, flags);

  const rotation = planVaultRelease(vault, tag);

  await commitAndPushVault(vault, rotation, tag, flags);

  await createGithubRelease(root, tag, rotation.releaseNotes, flags);
  watchReleaseWorkflow(root, flags);
  await verifyProdHealth(flags);
  firestoreRulesReminder(root, previousTag);

  let syncPrUrl = null;
  let needsPostReleaseSync = false;
  if (!flags.skipSync && !flags.dryRun) {
    gitFetch(root);
    const post = inspectBranches(root);
    needsPostReleaseSync = post.assessment.needsPostReleaseSync;
    if (needsPostReleaseSync) {
      logStep('Post-release branch sync');
      const pr = createSyncPr(root, tag, flags);
      syncPrUrl = pr?.url || null;
    }
  }

  if (flags.dryRun) {
    nextStepsForDryRunComplete({ wouldPromote: false, tag });
    console.log('\nDry run only — no vault writes, PRs, or release published.');
    return;
  }

  nextStepsForReleaseComplete({ tag, syncPrUrl, needsPostReleaseSync });
}

main().catch((err) => {
  console.error(`\n[release] ${err.message}`);
  if (!/complete the steps above/i.test(err.message)) {
    printNextSteps('Tip', [
      'Run `npm run release -- --help` for the full numbered workflow',
      'Preview without changes: `npm run release:dry-run`',
    ]);
  }
  process.exit(1);
});
