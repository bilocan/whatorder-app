#!/usr/bin/env node
/**
 * Pull shared dev env files from GCP Secret Manager.
 *
 * Usage:
 *   npm run env:pull
 *   npm run env:pull -- --dry-run
 *   npm run env:pull -- --force --project whatorder-fire
 */
const fs = require('fs');
const path = require('path');
const { targets } = require('./env-secrets.config');
const {
  repoRoot,
  resolveProject,
  ensureGcloud,
  describeSecret,
  fetchSecret,
  parseArgs,
  confirm,
  ensureParentDir,
} = require('./lib/gcloudSecrets');

function printHelp() {
  console.log(`Usage: npm run env:pull [-- --dry-run] [-- --force] [-- --project PROJECT]

Fetches:
${targets.map((t) => `  ${t.secret} → ${t.dest}`).join('\n')}

Requires gcloud auth with roles/secretmanager.secretAccessor on dev secrets.
Docs: whatorder-vault/Projects/WhatOrder/notes/dev-secrets-gcp.md
`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  const project = resolveProject(flags.project);
  const root = repoRoot();

  console.log(`[env:pull] project=${project}`);

  if (flags.dryRun) {
    ensureGcloud();
    for (const { secret, dest } of targets) {
      const check = describeSecret(project, secret);
      const label = check.exists ? 'secret exists' : `MISSING in GCP (${check.reason})`;
      console.log(`  ${secret} → ${dest} (${label})`);
    }
    return;
  }

  ensureGcloud();

  const existing = targets.filter(({ dest }) => fs.existsSync(path.join(root, dest)));
  if (existing.length && !flags.force) {
    const ok = await confirm(
      `Overwrite ${existing.map((t) => t.dest).join(', ')}?`,
    );
    if (!ok) {
      console.log('[env:pull] cancelled');
      return;
    }
  }

  for (const { secret, dest } of targets) {
    const outPath = path.join(root, dest);
    const check = describeSecret(project, secret);
    if (!check.exists) {
      console.error(`[env:pull] cannot access secret: ${secret} (project ${project})`);
      if (check.reason === 'missing') {
        console.error('Secret does not exist. Ask a maintainer to run npm run env:push -- --create.');
      } else if (check.reason === 'permission-denied') {
        console.error('Permission denied. Confirm `gcloud auth list` shows your @whatorder.at account');
        console.error('and you are in the developers group (see dev-secrets-gcp.md).');
      } else if (check.reason === 'gcloud-not-found') {
        console.error('gcloud CLI not found. Install Google Cloud SDK.');
      } else {
        console.error(`gcloud error: ${check.detail}`);
        console.error('Retry in a few seconds. If push just finished, GCP may still be propagating.');
      }
      process.exit(1);
    }

    const payload = fetchSecret(project, secret);
    ensureParentDir(outPath);
    fs.writeFileSync(outPath, payload.endsWith('\n') ? payload : `${payload}\n`, { mode: 0o600 });
    console.log(`[env:pull] wrote ${dest}`);
  }

  console.log('[env:pull] done — run npm run dev from repo root');
}

main().catch((err) => {
  console.error('[env:pull] failed:', err.message);
  process.exit(1);
});
