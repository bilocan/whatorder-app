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
  extractMarkdownSections,
  extractUserVisibleNotes,
  extractProductionTasks,
  parseFirstParentLog,
  classifyReleasePhase,
  shortGitSha,
  countMarkdownBullets,
  collectShipBlockers,
  formatReleaseStatus,
  unreleasedPath,
  productionTasksPath,
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
    'Automated promote PR from `npm run release:promote`.',
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
  console.log(`  Reset: ${rotation.productionTasksFile}`);

  if (dryRun) {
    console.log(`  Would write ${path.basename(rotation.releasedFile)} and reset unreleased.md + production-tasks.md`);
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

  // Write first, then commit, then pull --rebase. Never pull while dirty:
  // vault uses pull.rebase=true, which refuses unstaged rotation files.
  runInDir(vaultRootDir, 'git', ['checkout', 'master']);

  if (fs.existsSync(rotation.releasedFile)) {
    console.log(`  ${path.basename(rotation.releasedFile)} already exists — skipping write.`);
    const unreleasedNow = fs.readFileSync(rotation.unreleasedFile, 'utf8');
    if (extractUserVisibleNotes(unreleasedNow)) {
      fs.writeFileSync(rotation.unreleasedFile, rotation.freshMarkdown, 'utf8');
    }
    const tasksNow = fs.existsSync(rotation.productionTasksFile)
      ? fs.readFileSync(rotation.productionTasksFile, 'utf8')
      : '';
    if (extractProductionTasks(tasksNow)) {
      fs.writeFileSync(rotation.productionTasksFile, rotation.freshProductionTasks, 'utf8');
    }
  } else {
    applyVaultRelease(rotation);
  }

  logStep('Vault git commit');
  const dirty = vaultGitStatus(vaultRootDir);
  if (!dirty) {
    console.log('  No vault changes to commit.');
    return;
  }

  console.log(dirty);

  runInDir(vaultRootDir, 'git', ['add', 'Projects/WhatOrder/releases/']);
  runInDir(vaultRootDir, 'git', ['commit', '-m', `chore(release): rotate changelog for ${tag}`]);
  runInDir(vaultRootDir, 'git', ['pull', 'origin', 'master']);
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
  console.log('  Waiting on `gh run watch` until **Release to Production** finishes (~1–2 min).');
  console.log('  Stop waiting: Ctrl+C — release is already published; check the URL above in GitHub Actions.');
  console.log('  Skip watch next time: npm run release -- --skip-watch');
  runInDir(appRootDir, 'gh', ['run', 'watch', String(runs[0].databaseId)], { inherit: true });
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

function productionTasksReminder(vaultRootDir) {
  logStep('Production tasks (this tag, not CI)');
  const filePath = productionTasksPath(vaultRootDir);
  const fromFile = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
  const fromUnreleased = fs.existsSync(unreleasedPath(vaultRootDir))
    ? fs.readFileSync(unreleasedPath(vaultRootDir), 'utf8')
    : '';
  const tasks = extractProductionTasks(fromFile) || extractProductionTasks(fromUnreleased);
  if (!tasks) {
    console.log('  None listed. Add at task done in vault releases/production-tasks.md if this tag needs a human env step.');
    return;
  }
  for (const line of tasks.split('\n')) {
    console.log(`  ${line}`);
  }
  console.log('  Complete these before the named gate. Pass 2 archives them into releases/<tag>.md and clears production-tasks.md.');
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

function inspectIntentSeed(appRootDir) {
  const seedPath = path.join(appRootDir, 'backend', 'src', 'data', 'intentLearnings.seed.json');
  if (!fs.existsSync(seedPath)) return { stale: true };
  try {
    const seed = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    const count = Object.values(seed.businesses ?? {})
      .reduce((n, entries) => n + Object.keys(entries ?? {}).length, 0);
    const generatedAt = Date.parse(seed.generatedAt);
    const ageDays = Number.isNaN(generatedAt)
      ? null
      : Math.floor((Date.now() - generatedAt) / 86400000);
    return { stale: !count || ageDays === null || ageDays > SEED_MAX_AGE_DAYS };
  } catch {
    return { stale: true };
  }
}

function firestoreRulesChanged(appRootDir, previousTag) {
  const range = previousTag ? `${previousTag}..origin/master` : 'origin/master';
  const result = runInDir(
    appRootDir,
    'git',
    ['log', '-1', '--format=%H', range, '--', 'firestore.rules', 'firestore.indexes.json'],
    { allowFailure: true },
  );
  return Boolean(result.stdout.trim());
}

function firstParentLog(appRootDir, range) {
  const args = ['log', '--first-parent', '--format=%h%x09%s', '--max-count=50'];
  if (range) args.push(range);
  return parseFirstParentLog(runInDir(appRootDir, 'git', args).stdout);
}

async function inspectPreprod(masterSha, flags) {
  const expected = shortGitSha(masterSha);
  if (flags.skipPreprodCheck) {
    return { expected, actual: null, match: null };
  }
  if (typeof fetch !== 'function') {
    return { expected, actual: null, match: null };
  }
  try {
    const res = await fetch(PREPROD_VERSION_URL);
    if (!res.ok) {
      return { expected, actual: `HTTP ${res.status}`, match: false };
    }
    const body = await res.json().catch(() => null);
    if (body === null) {
      return { expected, actual: 'invalid JSON response', match: false };
    }
    const actual = body.gitSha || '';
    return { expected, actual, match: expected === actual };
  } catch (err) {
    return {
      expected,
      actual: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      match: false,
    };
  }
}

async function buildReleaseReport(appRootDir, vaultRootDir, flags) {
  gitFetch(appRootDir);
  runInDir(vaultRootDir, 'git', ['fetch', 'origin', 'master'], { allowFailure: true });

  const branch = inspectBranches(appRootDir);
  const { assessment } = branch;
  const masterSha = runInDir(
    appRootDir,
    'git',
    ['rev-parse', 'origin/master'],
  ).stdout.trim();
  const lastTag = latestReleaseTag(appRootDir);
  const lastTagSha = lastTag
    ? runInDir(appRootDir, 'git', ['rev-list', '-n', '1', lastTag]).stdout.trim()
    : null;
  const phase = classifyReleasePhase({
    diverged: assessment.reason === 'diverged',
    needsPromote: assessment.needsPromote,
    masterSha,
    lastTagSha,
  });

  const waitingToPromote = firstParentLog(appRootDir, 'origin/master..origin/dev');
  const waitingToShip = firstParentLog(
    appRootDir,
    lastTag ? `${lastTag}..origin/master` : 'origin/master',
  );
  const openPromotePr = findOpenPr(appRootDir, 'master', 'dev')[0] || null;
  const openSyncPr = findOpenPr(appRootDir, 'dev', 'master')[0] || null;

  const unreleasedFile = unreleasedPath(vaultRootDir);
  const tasksFile = productionTasksPath(vaultRootDir);
  const unreleased = fs.existsSync(unreleasedFile) ? fs.readFileSync(unreleasedFile, 'utf8') : '';
  const productionTasksSource = fs.existsSync(tasksFile) ? fs.readFileSync(tasksFile, 'utf8') : '';
  const userVisible = extractUserVisibleNotes(unreleased);
  const internal = extractMarkdownSections(unreleased, 'Internal');
  const productionTasks = extractProductionTasks(productionTasksSource)
    || extractMarkdownSections(unreleased, 'Production tasks');
  const vaultDirty = Boolean(vaultGitStatus(vaultRootDir));
  const vaultBranch = runInDir(
    vaultRootDir,
    'git',
    ['rev-parse', '--abbrev-ref', 'HEAD'],
  ).stdout.trim();
  const vaultCountsResult = runInDir(
    vaultRootDir,
    'git',
    ['rev-list', '--left-right', '--count', 'origin/master...HEAD'],
    { allowFailure: true },
  );
  const [behindRaw = '0', aheadRaw = '0'] = vaultCountsResult.stdout.trim().split(/\s+/);
  const tags = listReleaseTags(appRootDir);
  const nextTag = normalizeTag(flags.tag) || suggestNextTag(tags);
  const preprod = await inspectPreprod(masterSha, flags);
  const seed = inspectIntentSeed(appRootDir);
  const rulesChanged = firestoreRulesChanged(appRootDir, lastTag);
  const result = collectShipBlockers({
    phase,
    userVisible,
    internal,
    productionTasks,
    tagExists: tagExists(appRootDir, nextTag),
    vaultDirty,
    vaultBranch,
    preprodMatch: preprod.match,
    lastTagSha,
    skipPromote: flags.skipPromote,
    skipPreprodCheck: flags.skipPreprodCheck,
    skipVaultPush: flags.skipVaultPush,
    intentSeedStale: seed.stale,
    firestoreRulesChanged: rulesChanged,
  });
  if (waitingToPromote.length === 50) {
    result.warnings.push({
      code: 'promote-list-truncated',
      message: 'Waiting-to-promote list reached 50 entries; older merges are omitted.',
    });
  }
  if (waitingToShip.length === 50) {
    result.warnings.push({
      code: 'ship-list-truncated',
      message: 'Waiting-to-ship list reached 50 entries; older merges are omitted.',
    });
  }

  return {
    phase,
    assessment,
    lastTag,
    lastTagSha,
    masterSha,
    nextTag,
    waitingToPromote,
    waitingToShip,
    openPromotePr,
    openSyncPr,
    vault: {
      userVisibleCount: countMarkdownBullets(userVisible),
      internalCount: countMarkdownBullets(internal),
      productionTasksCount: countMarkdownBullets(productionTasks),
      branch: vaultBranch,
      dirty: vaultDirty,
      ahead: Number.parseInt(aheadRaw, 10) || 0,
      behind: Number.parseInt(behindRaw, 10) || 0,
    },
    preprod,
    blockers: result.blockers,
    warnings: result.warnings,
  };
}

async function main() {
  const flags = parseReleaseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  ensureGh();
  const root = appRoot();
  const vault = vaultRoot(root);
  ensureVaultRepo(vault);

  if (flags.status) {
    const report = await buildReleaseReport(root, vault, flags);
    console.log(formatReleaseStatus(report));
    return;
  }

  printReleaseOverview();

  if (flags.promoteOnly) {
    gitFetch(root);
    const branch = inspectBranches(root);
    if (branch.assessment.ready) {
      nextStepsForPromoteOnlyAlreadyDone();
      return;
    }
    if (branch.assessment.reason === 'diverged') {
      nextStepsForDiverged();
      throw new Error('dev and master have diverged. Resolve manually, then re-run release.');
    }
    intentSeedReminder(root);
    productionTasksReminder(vault);
    const pr = createPromotePr(root, flags);
    nextStepsForPromoteRequired({ prUrl: pr?.url || null, dryRun: flags.dryRun });
    return;
  }

  if (flags.dryRun) {
    console.log('\n*** DRY RUN: no vault writes, PRs, tags, or GitHub Release ***\n');
    const report = await buildReleaseReport(root, vault, flags);
    console.log(formatReleaseStatus(report));
    if (report.blockers.length === 0) {
      console.log(`\n  Would rotate vault changelog for ${report.nextTag}`);
      console.log(`  Would run: gh release create ${report.nextTag} --target master`);
      nextStepsForDryRunComplete({ wouldPromote: false, tag: report.nextTag });
      return;
    }
    console.log('\nnot ready to ship');
    process.exit(1);
  }

  const report = await buildReleaseReport(root, vault, flags);
  if (report.blockers.length > 0) {
    console.log(formatReleaseStatus(report));
    if (report.phase === 'needs-promote') {
      console.log('\nRun: npm run release:promote');
    }
    process.exit(1);
  }

  if (flags.skipPromote) {
    console.log('  Warning: releasing with unpromoted dev work (--skip-promote)');
  }

  if (!flags.yes) {
    logStep('Preprod smoke required');
    if (flags.skipPromote) {
      console.log('  --skip-promote: master may not contain origin/dev. Confirm preprod smoke for the commit you are tagging.');
    } else {
      console.log('  master already contains dev\'s work — this is pass 2 (ship to prod).');
    }
    const ok = awaitConfirm('Preprod smoke done for this commit? Continue with production release?');
    if (!ok) {
      throw new Error('Release cancelled — complete Phase 3 preprod smoke, then re-run npm run release.');
    }
  }

  const tag = report.nextTag;
  const previousTag = report.lastTag;
  logStep(`Release tag: ${tag}`);

  const rotation = planVaultRelease(vault, tag);

  if (rotation.productionTasks && !flags.yes) {
    logStep('Production tasks required for this tag');
    for (const line of rotation.productionTasks.split('\n')) {
      console.log(`  ${line}`);
    }
    const ok = awaitConfirm(
      'Production tasks for this tag done (or N/A)? They archive into the tag file and production-tasks.md clears.',
    );
    if (!ok) {
      throw new Error('Release cancelled — finish vault releases/production-tasks.md, then re-run npm run release.');
    }
  }

  await commitAndPushVault(vault, rotation, tag, flags);

  await createGithubRelease(root, tag, rotation.releaseNotes, flags);
  watchReleaseWorkflow(root, flags);
  await verifyProdHealth(flags);
  firestoreRulesReminder(root, previousTag);

  let syncPrUrl = null;
  let needsPostReleaseSync = false;
  if (!flags.skipSync) {
    gitFetch(root);
    const post = inspectBranches(root);
    needsPostReleaseSync = post.assessment.needsPostReleaseSync;
    if (needsPostReleaseSync) {
      logStep('Post-release branch sync');
      const pr = createSyncPr(root, tag, flags);
      syncPrUrl = pr?.url || null;
    }
  }

  nextStepsForReleaseComplete({ tag, syncPrUrl, needsPostReleaseSync, skipWatch: flags.skipWatch });
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
