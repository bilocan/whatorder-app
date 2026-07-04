#!/usr/bin/env node
/**
 * Upload local dev env files to GCP Secret Manager (maintainers only).
 *
 * Usage:
 *   npm run env:push
 *   npm run env:push -- --create   # create secrets if missing
 */
const fs = require('fs');
const path = require('path');
const { targets } = require('./env-secrets.config');
const {
  repoRoot,
  resolveProject,
  ensureGcloud,
  secretExists,
  createSecret,
  addSecretVersion,
  parseArgs,
  confirm,
} = require('./lib/gcloudSecrets');

function printHelp() {
  console.log(`Usage: npm run env:push [-- --create] [-- --project PROJECT]

Uploads:
${targets.map((t) => `  ${t.dest} → ${t.secret}`).join('\n')}

Requires roles/secretmanager.admin (or secret create + version add on these IDs).
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

  console.log(`[env:push] project=${project}`);
  ensureGcloud();

  const missingLocal = targets.filter(({ dest }) => !fs.existsSync(path.join(root, dest)));
  if (missingLocal.length) {
    console.error('[env:push] missing local files:');
    for (const { dest } of missingLocal) console.error(`  ${dest}`);
    process.exit(1);
  }

  const ok = await confirm('Upload local env files to Secret Manager? This adds new secret versions.');
  if (!ok) {
    console.log('[env:push] cancelled');
    return;
  }

  for (const { secret, dest } of targets) {
    const filePath = path.join(root, dest);
    if (!secretExists(project, secret)) {
      if (!flags.create) {
        console.error(`[env:push] secret ${secret} does not exist. Re-run with --create.`);
        process.exit(1);
      }
      console.log(`[env:push] creating ${secret}`);
      createSecret(project, secret);
    }

    console.log(`[env:push] ${dest} → ${secret}`);
    addSecretVersion(project, secret, filePath);
  }

  console.log('[env:push] done');
}

main().catch((err) => {
  console.error('[env:push] failed:', err.message);
  process.exit(1);
});
