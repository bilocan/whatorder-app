const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  suggestNextTag,
  extractUserVisibleNotes,
  extractProductionTasks,
  buildReleasedMarkdown,
  buildFreshUnreleasedTemplate,
  buildFreshProductionTasksTemplate,
  branchSyncState,
  assessReleaseBranches,
  normalizeTag,
  rotateVaultRelease,
  vaultReleasesDir,
} = require('../releaseLib');

test('suggestNextTag increments patch within month', () => {
  const date = new Date('2026-07-11T12:00:00Z');
  assert.equal(
    suggestNextTag(['v2026.07.0', 'v2026.06.9'], date),
    'v2026.07.1',
  );
  assert.equal(suggestNextTag([], date), 'v2026.07.0');
});

test('normalizeTag adds v prefix', () => {
  assert.equal(normalizeTag('2026.07.0'), 'v2026.07.0');
  assert.equal(normalizeTag('v2026.07.0'), 'v2026.07.0');
});

test('extractUserVisibleNotes collects all user-visible sections', () => {
  const md = `# Unreleased

## User-visible

- **Bot:** first item

## Internal

- hidden

## Production tasks

- **Before Preprod:** apply CORS

## User-visible

- **Dashboard:** second item
`;
  const notes = extractUserVisibleNotes(md);
  assert.match(notes, /first item/);
  assert.match(notes, /second item/);
  assert.doesNotMatch(notes, /hidden/);
  assert.doesNotMatch(notes, /apply CORS/);
});

test('extractProductionTasks reads dedicated file bullets', () => {
  const md = `---
type: release-ops
status: unreleased
---
# Production tasks

> [!info] When to log
> Human env steps.

- **Before Preprod/Prod import:** apply GCS CORS on gs://whatorder-fire-prod-backups.
`;
  const tasks = extractProductionTasks(md);
  assert.match(tasks, /apply GCS CORS/);
  assert.doesNotMatch(tasks, /When to log/);
});

test('extractProductionTasks ignores changelog sections', () => {
  const md = `# Unreleased

## User-visible

- **Bot:** first item

## Internal

- hidden

## Production tasks

- **Before Preprod/Prod import:** apply GCS CORS on gs://whatorder-fire-prod-backups.
`;
  const tasks = extractProductionTasks(md);
  assert.match(tasks, /apply GCS CORS/);
  assert.doesNotMatch(tasks, /first item/);
  assert.doesNotMatch(tasks, /hidden/);
});

test('buildReleasedMarkdown updates frontmatter', () => {
  const source = `---
type: release-log
project: WhatOrder
status: unreleased
tags: [whatorder, releases]
---

# Unreleased

## User-visible

- shipped thing
`;
  const out = buildReleasedMarkdown(source, 'v2026.07.0', '2026-07-11');
  assert.match(out, /status: released/);
  assert.match(out, /release: v2026.07.0/);
  assert.match(out, /date: 2026-07-11/);
  assert.match(out, /# v2026.07.0/);
  assert.match(out, /## Production tasks/);
  assert.match(out, /shipped thing/);
});

test('buildReleasedMarkdown archives production-tasks.md and strips leftover section', () => {
  const source = `---
type: release-log
status: unreleased
---
# Unreleased

## User-visible

- shipped thing

## Production tasks

- leftover from old unreleased section
`;
  const tasksFile = `# Production tasks

- **Before Prod:** apply CORS
`;
  const out = buildReleasedMarkdown(source, 'v2026.07.0', '2026-07-11', tasksFile);
  assert.match(out, /\*\*Before Prod:\*\* apply CORS/);
  assert.match(out, /leftover from old unreleased section/);
  const tasksIdx = out.indexOf('## Production tasks');
  const userIdx = out.indexOf('## User-visible');
  assert.ok(tasksIdx >= 0 && tasksIdx < userIdx);
  const afterUser = out.slice(userIdx);
  assert.doesNotMatch(afterUser, /## Production tasks/);
});

test('buildFreshUnreleasedTemplate seeds empty sections', () => {
  const fresh = buildFreshUnreleasedTemplate();
  assert.match(fresh, /status: unreleased/);
  assert.match(fresh, /## User-visible/);
  assert.match(fresh, /## Internal/);
  assert.doesNotMatch(fresh, /## Production tasks/);
});

test('buildFreshProductionTasksTemplate seeds empty ops file', () => {
  const fresh = buildFreshProductionTasksTemplate();
  assert.match(fresh, /type: release-ops/);
  assert.match(fresh, /# Production tasks/);
  assert.doesNotMatch(fresh, /apply CORS/);
});

test('branchSyncState', () => {
  assert.equal(branchSyncState(0, 0), 'in-sync');
  assert.equal(branchSyncState(3, 0), 'dev-ahead');
  assert.equal(branchSyncState(0, 2), 'master-ahead');
  assert.equal(branchSyncState(1, 1), 'diverged');
});

test('assessReleaseBranches allows promoted master even when master is commit-ahead', () => {
  const result = assessReleaseBranches({
    devInMaster: true,
    masterInDev: false,
    contentSynced: false,
  });
  assert.equal(result.ready, true);
  assert.equal(result.reason, 'promoted');
  assert.equal(result.needsPostReleaseSync, true);
});

test('assessReleaseBranches allows content-synced dev after back-merge', () => {
  const result = assessReleaseBranches({
    devInMaster: false,
    masterInDev: true,
    contentSynced: true,
  });
  assert.equal(result.ready, true);
  assert.equal(result.reason, 'content-synced');
  assert.equal(result.needsPostReleaseSync, false);
});

test('assessReleaseBranches blocks unpromoted dev work', () => {
  const result = assessReleaseBranches({
    devInMaster: false,
    masterInDev: true,
    contentSynced: false,
  });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'needs-promote');
});

test('rotateVaultRelease writes release file and resets unreleased plus production-tasks', () => {
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-vault-'));
  const releasesDir = vaultReleasesDir(tmpVault);
  fs.mkdirSync(releasesDir, { recursive: true });
  fs.writeFileSync(
    path.join(releasesDir, 'unreleased.md'),
    `${buildFreshUnreleasedTemplate()}## User-visible\n\n- **Test:** item one\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(releasesDir, 'production-tasks.md'),
    `${buildFreshProductionTasksTemplate()}- **Before Prod:** apply CORS\n`,
    'utf8',
  );

  const result = rotateVaultRelease(tmpVault, 'v2026.07.0');
  assert.match(result.releaseNotes, /item one/);
  assert.match(result.productionTasks, /apply CORS/);
  const archived = fs.readFileSync(path.join(releasesDir, 'v2026.07.0.md'), 'utf8');
  assert.match(archived, /## Production tasks/);
  assert.match(archived, /apply CORS/);
  assert.match(archived, /item one/);
  const unreleased = fs.readFileSync(path.join(releasesDir, 'unreleased.md'), 'utf8');
  assert.match(unreleased, /status: unreleased/);
  assert.doesNotMatch(unreleased, /item one/);
  const tasks = fs.readFileSync(path.join(releasesDir, 'production-tasks.md'), 'utf8');
  assert.match(tasks, /status: unreleased/);
  assert.doesNotMatch(tasks, /apply CORS/);
});
