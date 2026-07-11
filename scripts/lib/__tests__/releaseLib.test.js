const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  suggestNextTag,
  extractUserVisibleNotes,
  buildReleasedMarkdown,
  buildFreshUnreleasedTemplate,
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

## User-visible

- **Dashboard:** second item
`;
  const notes = extractUserVisibleNotes(md);
  assert.match(notes, /first item/);
  assert.match(notes, /second item/);
  assert.doesNotMatch(notes, /hidden/);
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
  assert.match(out, /shipped thing/);
});

test('buildFreshUnreleasedTemplate seeds empty sections', () => {
  const fresh = buildFreshUnreleasedTemplate();
  assert.match(fresh, /status: unreleased/);
  assert.match(fresh, /## User-visible/);
  assert.match(fresh, /## Internal/);
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

test('rotateVaultRelease writes release file and resets unreleased', () => {
  const tmpVault = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-vault-'));
  const releasesDir = vaultReleasesDir(tmpVault);
  fs.mkdirSync(releasesDir, { recursive: true });
  fs.writeFileSync(
    path.join(releasesDir, 'unreleased.md'),
    `${buildFreshUnreleasedTemplate()}## User-visible\n\n- **Test:** item one\n`,
    'utf8',
  );

  const result = rotateVaultRelease(tmpVault, 'v2026.07.0');
  assert.match(result.releaseNotes, /item one/);
  assert.ok(fs.existsSync(path.join(releasesDir, 'v2026.07.0.md')));
  const unreleased = fs.readFileSync(path.join(releasesDir, 'unreleased.md'), 'utf8');
  assert.match(unreleased, /status: unreleased/);
  assert.doesNotMatch(unreleased, /item one/);
});
