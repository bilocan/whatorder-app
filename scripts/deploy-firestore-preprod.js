#!/usr/bin/env node
/**
 * Deploy firestore.rules + composite indexes to the named `preprod` database
 * in whatorder-fire-prod. Run after any release that changes firestore.rules
 * or firestore.indexes.json (the default DB is covered by
 * `npx firebase-tools deploy --only firestore -P prod`; named DBs are not).
 *
 * Usage:
 *   npm run firestore:deploy-preprod
 *   npm run firestore:deploy-preprod -- --dry-run
 *
 * Requires gcloud authenticated with access to whatorder-fire-prod.
 */
const fs = require('fs');
const path = require('path');

const { spawnGcloud } = require('../backend/scripts/lib/firestoreResetProductionLib');
const {
  stripJsonComments,
  missingIndexes,
  buildIndexCreateArgs,
  buildRulesetBody,
  releaseName,
} = require('./lib/firestoreDeployLib');

const PROJECT = 'whatorder-fire-prod';
const DATABASE = 'preprod';
const RULES_API = 'https://firebaserules.googleapis.com/v1';

const appRoot = path.join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');

function gcloudJson(args) {
  const result = spawnGcloud([...args, '--format=json']);
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '').trim() || `gcloud ${args.join(' ')} failed`);
  }
  return JSON.parse(result.stdout.replace(/^﻿/, '') || '[]');
}

function accessToken() {
  const result = spawnGcloud(['auth', 'print-access-token']);
  if (result.status !== 0) {
    throw new Error('gcloud auth print-access-token failed — run `gcloud auth login` first.');
  }
  return result.stdout.trim();
}

async function rulesApi(method, urlPath, token, body) {
  const res = await fetch(`${RULES_API}/${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': PROJECT,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Rules API ${method} ${urlPath}: HTTP ${res.status} ${JSON.stringify(json.error || json)}`);
  }
  return json;
}

async function deployRules(token) {
  const rulesPath = path.join(appRoot, 'firestore.rules');
  const rulesContent = fs.readFileSync(rulesPath, 'utf8');
  const release = releaseName(PROJECT, DATABASE);

  // Skip when the deployed ruleset already matches the repo file byte-for-byte.
  try {
    const current = await rulesApi('GET', release, token);
    const ruleset = await rulesApi('GET', current.rulesetName, token);
    const deployedContent = ruleset?.source?.files?.[0]?.content;
    if (deployedContent === rulesContent) {
      console.log(`Rules: up to date on ${DATABASE} (ruleset ${current.rulesetName.split('/').pop()})`);
      return;
    }
  } catch {
    // No release yet or fetch failed — fall through and deploy.
  }

  if (dryRun) {
    console.log(`Rules: would create ruleset from firestore.rules and update ${release}`);
    return;
  }

  const created = await rulesApi('POST', `projects/${PROJECT}/rulesets`, token, buildRulesetBody(rulesContent));
  await rulesApi('PATCH', release, token, {
    release: { name: release, rulesetName: created.name },
  });
  console.log(`Rules: deployed to ${DATABASE} (ruleset ${created.name.split('/').pop()})`);
}

function deployIndexes() {
  const indexesPath = path.join(appRoot, 'firestore.indexes.json');
  const repo = JSON.parse(stripJsonComments(fs.readFileSync(indexesPath, 'utf8'))).indexes || [];
  const deployed = gcloudJson([
    'firestore', 'indexes', 'composite', 'list',
    `--project=${PROJECT}`, `--database=${DATABASE}`,
  ]);

  const missing = missingIndexes(repo, deployed);
  if (!missing.length) {
    console.log(`Indexes: all ${repo.length} repo indexes present on ${DATABASE}`);
    return;
  }

  for (const index of missing) {
    const args = buildIndexCreateArgs(index, { project: PROJECT, database: DATABASE });
    if (dryRun) {
      console.log(`Indexes: would run gcloud ${args.join(' ')}`);
      continue;
    }
    console.log(`Indexes: creating ${index.collectionGroup} (${index.queryScope})…`);
    const result = spawnGcloud(args, 'inherit');
    if (result.status !== 0) {
      throw new Error(`Index create failed for ${index.collectionGroup}`);
    }
  }
  if (!dryRun) {
    console.log('Indexes: creation issued — confirm READY with:');
    console.log(`  gcloud firestore indexes composite list --database=${DATABASE} --project=${PROJECT}`);
  }
}

async function main() {
  console.log(`Firestore ${DATABASE} deploy (${PROJECT})${dryRun ? ' — dry run' : ''}\n`);
  const token = accessToken();
  await deployRules(token);
  deployIndexes();
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(`[firestore:deploy-preprod] ${err.message}`);
  process.exit(1);
});
