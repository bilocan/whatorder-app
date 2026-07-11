#!/usr/bin/env node
/**
 * Production release: branch sync PRs, vault changelog rotation, GitHub Release.
 *
 * Usage:
 *   npm run release
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
  RELEASE_WORKFLOW_NAME,
  appRoot,
  vaultRoot,
  parseReleaseArgs,
  suggestNextTag,
  normalizeTag,
  branchSyncState,
  rotateVaultRelease,
  printHelp,
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
  const counts = branchCounts(appRootDir);
  const sync = branchSyncState(counts.devAhead, counts.masterAhead);

  logStep('Branch sync check');
  console.log(`  origin/dev vs origin/master: dev +${counts.devAhead}, master +${counts.masterAhead} (${sync})`);

  if (sync === 'diverged') {
    throw new Error(
      'dev and master have diverged. Resolve manually (merge/rebase), then re-run release.',
    );
  }

  if (counts.masterAhead > 0 && !flags.skipSync) {
    logStep('Master is ahead of dev — sync PR required before release');
    createSyncPr(appRootDir, '(pre-release)', flags);
    if (!flags.dryRun) {
      throw new Error(
        'Merge the master → dev sync PR first so dev is not behind master, then re-run release.',
      );
    }
    return false;
  }

  if (counts.devAhead > 0 && !flags.skipPromote) {
    logStep('Dev is ahead of master — promote required before release');
    createPromotePr(appRootDir, flags);
    if (!flags.dryRun) {
      throw new Error(
        'Merge the dev → master promote PR first, then re-run release.',
      );
    }
    return false;
  }

  if (sync !== 'in-sync' && (flags.skipPromote || flags.skipSync)) {
    console.log('  Warning: branch skew ignored via --skip-promote / --skip-sync');
  }

  return true;
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

async function commitAndPushVault(vaultRootDir, tag, { dryRun, skipVaultPush, yes }) {
  logStep('Vault git commit');
  const dirty = vaultGitStatus(vaultRootDir);
  if (!dirty) {
    console.log('  No vault changes to commit.');
    return;
  }

  console.log(dirty);

  if (skipVaultPush) {
    console.log('  Skipping vault commit/push (--skip-vault-push). Commit manually on vault master.');
    return;
  }

  if (!dryRun && !yes) {
    const ok = awaitConfirm(`Commit and push vault release log for ${tag}?`);
    if (!ok) throw new Error('Vault commit cancelled.');
  }

  if (dryRun) {
    console.log(`  Would commit vault: chore(release): rotate changelog for ${tag}`);
    console.log('  Would push vault: origin master');
    return;
  }

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

  if (tagExists(appRootDir, tag)) {
    throw new Error(`Tag ${tag} already exists locally. Pick another tag or delete the old release.`);
  }

  const notesFile = path.join(os.tmpdir(), `whatorder-release-${tag}.md`);
  fs.writeFileSync(notesFile, notes, 'utf8');

  if (dryRun) {
    console.log(`  Would run: gh release create ${tag} --target master --notes-file ${notesFile}`);
    console.log('  Notes preview:\n');
    console.log(notes.split('\n').slice(0, 20).join('\n'));
    if (notes.split('\n').length > 20) console.log('  ...');
    return;
  }

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
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      console.log(`  OK: ${PROD_HEALTH_URL}`);
    })
    .catch((err) => {
      console.error(`  FAIL: ${PROD_HEALTH_URL} (${err.message})`);
      console.error('  Deploy may still be running — check GitHub Actions.');
    });
}

function firestoreRulesReminder(appRootDir) {
  const rulesPath = path.join(appRootDir, 'firestore.rules');
  if (!fs.existsSync(rulesPath)) return;

  const result = runInDir(
    appRootDir,
    'git',
    ['log', '-1', '--format=%H', 'origin/master', '--', 'firestore.rules', 'firestore.indexes.json'],
    { allowFailure: true },
  );
  if (result.stdout.trim()) {
    console.log('\nReminder: if firestore.rules or firestore.indexes.json changed, deploy manually:');
    console.log('  npx firebase-tools deploy --only firestore -P prod');
  }
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

  const branchesReady = await ensureBranchesReady(root, flags);
  if (!branchesReady && flags.dryRun) {
    console.log('\nDry run stops here — merge branch PRs, then re-run without --dry-run.');
    return;
  }

  const tags = listReleaseTags(root);
  const tag = normalizeTag(flags.tag) || suggestNextTag(tags);
  logStep(`Release tag: ${tag}`);

  const rotation = rotateVaultRelease(vault, tag, { dryRun: flags.dryRun });
  console.log(`  Vault: ${rotation.releasedFile}`);
  console.log(`  Fresh: ${rotation.unreleasedFile}`);

  await commitAndPushVault(vault, tag, flags);

  await createGithubRelease(root, tag, rotation.releaseNotes, flags);
  watchReleaseWorkflow(root, flags);
  await verifyProdHealth(flags);
  firestoreRulesReminder(root);

  if (!flags.skipSync && !flags.dryRun) {
    gitFetch(root);
    const counts = branchCounts(root);
    if (counts.masterAhead > 0) {
      logStep('Post-release branch sync');
      createSyncPr(root, tag, flags);
    } else {
      console.log('\nDev and master are in sync — no post-release sync PR needed.');
    }
  }

  console.log('\nRelease flow complete.');
  if (flags.dryRun) {
    console.log('\nDry run only — no vault writes, PRs, or release published.');
  }
}

main().catch((err) => {
  console.error(`\n[release] ${err.message}`);
  process.exit(1);
});
