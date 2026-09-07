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
  parseReleaseArgs,
  parsePrNumberFromSubject,
  parseFirstParentLog,
  prUrl,
  classifyReleasePhase,
  shortGitSha,
  countMarkdownBullets,
  collectShipBlockers,
  formatReleaseStatus,
  SHIP_BLOCKER,
  SHIP_WARNING,
  printHelp,
} = require('../releaseLib');

test('printHelp mentions status and no auto-promote', () => {
  const logs = [];
  const orig = console.log;
  console.log = (msg) => { logs.push(String(msg)); };
  try {
    printHelp();
  } finally {
    console.log = orig;
  }
  const text = logs.join('\n');
  assert.match(text, /npm run release:status/);
  assert.match(text, /--status/);
  assert.match(text, /never opens a promote PR/);
  assert.match(text, /exit 1 if any ship blocker/);
});

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

test('parseReleaseArgs sets status', () => {
  assert.equal(parseReleaseArgs(['--status']).status, true);
  assert.equal(parseReleaseArgs(['--dry-run']).status, false);
  assert.equal(parseReleaseArgs([]).status, false);
});

test('parsePrNumberFromSubject', () => {
  assert.equal(parsePrNumberFromSubject('Restaurant ZIP (#412)'), 412);
  assert.equal(parsePrNumberFromSubject('Merge pull request #410 from bilocan/foo'), 410);
  assert.equal(parsePrNumberFromSubject('chore: no pr'), null);
});

test('parseFirstParentLog splits sha and subject', () => {
  const rows = parseFirstParentLog('abc1234\tRestaurant ZIP (#412)\ndef5678\tno pr\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].sha, 'abc1234');
  assert.equal(rows[0].subject, 'Restaurant ZIP (#412)');
  assert.equal(rows[0].prNumber, 412);
  assert.equal(rows[1].prNumber, null);
  assert.deepEqual(parseFirstParentLog(''), []);
});

test('prUrl', () => {
  assert.equal(prUrl(412), 'https://github.com/bilocan/whatorder-app/pull/412');
  assert.equal(prUrl(null), null);
});

test('classifyReleasePhase', () => {
  assert.equal(classifyReleasePhase({
    diverged: true, needsPromote: true, masterSha: 'a', lastTagSha: 'b',
  }), 'diverged');
  assert.equal(classifyReleasePhase({
    diverged: false, needsPromote: true, masterSha: 'a', lastTagSha: 'b',
  }), 'needs-promote');
  assert.equal(classifyReleasePhase({
    diverged: false, needsPromote: false, masterSha: 'abc', lastTagSha: 'abc',
  }), 'nothing-to-ship');
  assert.equal(classifyReleasePhase({
    diverged: false, needsPromote: false, masterSha: 'abc', lastTagSha: 'old',
  }), 'ready-to-ship');
  assert.equal(classifyReleasePhase({
    diverged: false, needsPromote: false, masterSha: 'abc', lastTagSha: null,
  }), 'ready-to-ship');
});

test('shortGitSha is 7 chars and must not be used as lastTagSha', () => {
  const full = '0123456789abcdef0123456789abcdef01234567';
  assert.equal(shortGitSha(full), '0123456');
  assert.notEqual(full, shortGitSha(full));
});

test('countMarkdownBullets', () => {
  assert.equal(countMarkdownBullets(''), 0);
  assert.equal(countMarkdownBullets('- **Bot:** one\n\n- two\n'), 2);
});

test('collectShipBlockers gathers all codes', () => {
  const { blockers, warnings } = collectShipBlockers({
    phase: 'needs-promote',
    userVisible: '',
    internal: '',
    productionTasks: '- **Before Prod:** CORS',
    tagExists: true,
    vaultDirty: true,
    vaultBranch: 'feature/x',
    preprodMatch: false,
    lastTagSha: 'old',
    skipPromote: false,
    skipPreprodCheck: false,
    skipVaultPush: false,
    intentSeedStale: true,
    firestoreRulesChanged: true,
  });
  const codes = blockers.map((b) => b.code);
  assert.ok(codes.includes(SHIP_BLOCKER.NEEDS_PROMOTE));
  assert.ok(codes.includes(SHIP_BLOCKER.USER_VISIBLE_EMPTY));
  assert.ok(codes.includes(SHIP_BLOCKER.TAG_EXISTS));
  assert.ok(codes.includes(SHIP_BLOCKER.VAULT_DIRTY));
  assert.ok(codes.includes(SHIP_BLOCKER.VAULT_NOT_MASTER));
  assert.ok(codes.includes(SHIP_BLOCKER.PREPROD_SHA_MISMATCH));
  assert.equal(codes.includes(SHIP_BLOCKER.DIVERGED), false);
  const wcodes = warnings.map((w) => w.code);
  assert.ok(wcodes.includes(SHIP_WARNING.INTENT_SEED_STALE));
  assert.ok(wcodes.includes(SHIP_WARNING.FIRESTORE_RULES_CHANGED));
  assert.ok(wcodes.includes(SHIP_WARNING.PRODUCTION_TASKS_PRESENT));
});

test('collectShipBlockers skip flags drop matching blockers', () => {
  const { blockers } = collectShipBlockers({
    phase: 'needs-promote',
    userVisible: '- **Release:** sentinel',
    internal: '- infra',
    productionTasks: '',
    tagExists: false,
    vaultDirty: true,
    vaultBranch: 'master',
    preprodMatch: false,
    lastTagSha: 'old',
    skipPromote: true,
    skipPreprodCheck: true,
    skipVaultPush: true,
    intentSeedStale: false,
    firestoreRulesChanged: false,
  });
  const codes = blockers.map((b) => b.code);
  assert.equal(codes.includes(SHIP_BLOCKER.NEEDS_PROMOTE), false);
  assert.equal(codes.includes(SHIP_BLOCKER.PREPROD_SHA_MISMATCH), false);
  assert.equal(codes.includes(SHIP_BLOCKER.VAULT_DIRTY), false);
  assert.equal(blockers.length, 0);
});

test('collectShipBlockers ready-to-ship with notes is clean', () => {
  const { blockers, warnings } = collectShipBlockers({
    phase: 'ready-to-ship',
    userVisible: '- **Bot:** shipped',
    internal: '- files',
    productionTasks: '',
    tagExists: false,
    vaultDirty: false,
    vaultBranch: 'master',
    preprodMatch: true,
    lastTagSha: 'old',
    skipPromote: false,
    skipPreprodCheck: false,
    skipVaultPush: false,
    intentSeedStale: false,
    firestoreRulesChanged: false,
  });
  assert.deepEqual(blockers, []);
  assert.deepEqual(warnings, []);
});

test('collectShipBlockers diverged does not also flag needs-promote', () => {
  const { blockers } = collectShipBlockers({
    phase: 'diverged',
    userVisible: '- **Bot:** x',
    internal: '- y',
    productionTasks: '',
    tagExists: false,
    vaultDirty: false,
    vaultBranch: 'master',
    preprodMatch: true,
    lastTagSha: 'old',
    skipPromote: false,
    skipPreprodCheck: false,
    skipVaultPush: false,
    intentSeedStale: false,
    firestoreRulesChanged: false,
  });
  const codes = blockers.map((b) => b.code);
  assert.ok(codes.includes(SHIP_BLOCKER.DIVERGED));
  assert.equal(codes.includes(SHIP_BLOCKER.NEEDS_PROMOTE), false);
});

test('collectShipBlockers nothing-to-ship skips user-visible-empty', () => {
  const { blockers } = collectShipBlockers({
    phase: 'nothing-to-ship',
    userVisible: '',
    internal: '',
    productionTasks: '',
    tagExists: false,
    vaultDirty: false,
    vaultBranch: 'master',
    preprodMatch: true,
    lastTagSha: 'abc',
    skipPromote: false,
    skipPreprodCheck: false,
    skipVaultPush: false,
    intentSeedStale: false,
    firestoreRulesChanged: false,
  });
  const codes = blockers.map((b) => b.code);
  assert.ok(codes.includes(SHIP_BLOCKER.NOTHING_TO_SHIP));
  assert.equal(codes.includes(SHIP_BLOCKER.USER_VISIBLE_EMPTY), false);
});

test('formatReleaseStatus includes merge lines and blockers', () => {
  const text = formatReleaseStatus({
    phase: 'needs-promote',
    lastTag: 'v2026.08.2',
    nextTag: 'v2026.09.0',
    waitingToPromote: [{
      sha: 'abc1234', subject: 'Restaurant ZIP (#412)', prNumber: 412,
    }],
    waitingToShip: [],
    openPromotePr: { number: 99, url: 'https://github.com/bilocan/whatorder-app/pull/99', title: 'promote' },
    openSyncPr: null,
    vault: {
      userVisibleCount: 2,
      internalCount: 5,
      productionTasksCount: 1,
      branch: 'master',
      dirty: false,
      ahead: 0,
      behind: 0,
    },
    preprod: { expected: 'abc1234', actual: 'abc1234', match: true },
    blockers: [{ code: SHIP_BLOCKER.NEEDS_PROMOTE, message: 'Run: npm run release:promote' }],
    warnings: [],
  });
  assert.match(text, /phase: needs-promote/);
  assert.match(text, /abc1234\s+Restaurant ZIP \(#412\)/);
  assert.match(text, /github.com\/bilocan\/whatorder-app\/pull\/412/);
  assert.match(text, /Waiting to ship[\s\S]*\(none\)/);
  assert.match(text, /needs-promote/);
  assert.match(text, /Run: npm run release:promote/);
});

test('formatReleaseStatus prints (none) for empty promote, blockers, warnings', () => {
  const text = formatReleaseStatus({
    phase: 'ready-to-ship',
    lastTag: 'v2026.08.2',
    nextTag: 'v2026.09.0',
    waitingToPromote: [],
    waitingToShip: [{ sha: 'deadbee', subject: 'ship me (#1)', prNumber: 1 }],
    openPromotePr: null,
    openSyncPr: null,
    vault: {
      userVisibleCount: 1,
      internalCount: 1,
      productionTasksCount: 0,
      branch: 'master',
      dirty: false,
      ahead: 0,
      behind: 0,
    },
    preprod: { expected: 'deadbee', actual: 'deadbee', match: true },
    blockers: [],
    warnings: [],
  });
  assert.match(text, /Waiting to promote[\s\S]*\(none\)/);
  assert.match(text, /==> Blockers[\s\S]*\(none\)/);
  assert.match(text, /==> Warnings[\s\S]*\(none\)/);
});

test('formatReleaseStatus prints skipped when preprod match is unavailable', () => {
  const text = formatReleaseStatus({
    phase: 'ready-to-ship',
    lastTag: 'v2026.08.2',
    nextTag: 'v2026.09.0',
    waitingToPromote: [],
    waitingToShip: [],
    openPromotePr: null,
    openSyncPr: null,
    vault: {
      userVisibleCount: 1,
      internalCount: 1,
      productionTasksCount: 0,
      branch: 'master',
      dirty: false,
      ahead: 0,
      behind: 0,
    },
    preprod: { expected: 'deadbee', actual: null, match: null },
    blockers: [],
    warnings: [],
  });
  assert.match(text, /actual: \(skipped\)/);
  assert.match(text, /match: skipped/);
  assert.doesNotMatch(text, /match: no/);
});
