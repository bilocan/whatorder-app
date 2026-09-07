const fs = require('fs');
const path = require('path');

const PROD_HEALTH_URL = 'https://whatorder-backend-87472938058.europe-west3.run.app/health';
const PREPROD_VERSION_URL = 'https://whatorder-backend-pre-87472938058.europe-west3.run.app/version';
const TEST_BACKEND_VERSION_URL = 'https://whatorder-backend-6ehqrvd7yq-ey.a.run.app/version';
const TEST_DASHBOARD_URL = 'https://dashboard-test.whatorder.at';
const PREPROD_DASHBOARD_URL = 'https://pre.whatorder.at';
const PROD_DASHBOARD_URL = 'https://dashboard.whatorder.at';
const PREPROD_WORKFLOW_NAME = 'Deploy to Preproduction';
const RELEASE_WORKFLOW_NAME = 'Release to Production';
const GITHUB_APP_REPO = 'https://github.com/bilocan/whatorder-app';

function appRoot(startDir = __dirname) {
  return path.resolve(startDir, '..', '..');
}

function vaultRoot(appRootDir) {
  return path.resolve(appRootDir, '..', 'whatorder-vault');
}

function vaultReleasesDir(vaultRootDir) {
  return path.join(vaultRootDir, 'Projects', 'WhatOrder', 'releases');
}

function unreleasedPath(vaultRootDir) {
  return path.join(vaultReleasesDir(vaultRootDir), 'unreleased.md');
}

function productionTasksPath(vaultRootDir) {
  return path.join(vaultReleasesDir(vaultRootDir), 'production-tasks.md');
}

function releasedPath(vaultRootDir, tag) {
  return path.join(vaultReleasesDir(vaultRootDir), `${tag}.md`);
}

function parseReleaseArgs(argv) {
  const flags = {
    tag: null,
    dryRun: false,
    yes: false,
    skipPromote: false,
    skipSync: false,
    skipVaultPush: false,
    skipWatch: false,
    skipPreprodCheck: false,
    promoteOnly: false,
    help: false,
    status: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') flags.dryRun = true;
    else if (arg === '--yes' || arg === '-y') flags.yes = true;
    else if (arg === '--skip-promote') flags.skipPromote = true;
    else if (arg === '--skip-sync') flags.skipSync = true;
    else if (arg === '--skip-vault-push') flags.skipVaultPush = true;
    else if (arg === '--skip-watch') flags.skipWatch = true;
    else if (arg === '--skip-preprod-check') flags.skipPreprodCheck = true;
    else if (arg === '--promote-only') flags.promoteOnly = true;
    else if (arg === '--status') flags.status = true;
    else if (arg === '--tag' && argv[i + 1]) flags.tag = argv[++i];
    else if (arg === '--help' || arg === '-h') flags.help = true;
  }

  return flags;
}

function parsePrNumberFromSubject(subject) {
  const text = String(subject || '');
  const paren = text.match(/\(#(\d+)\)/);
  if (paren) return Number.parseInt(paren[1], 10);
  const merge = text.match(/Merge pull request #(\d+)/i);
  if (merge) return Number.parseInt(merge[1], 10);
  return null;
}

function parseFirstParentLog(stdout) {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf('\t');
      const sha = tab === -1 ? line : line.slice(0, tab);
      const subject = tab === -1 ? '' : line.slice(tab + 1);
      return { sha, subject, prNumber: parsePrNumberFromSubject(subject) };
    });
}

function prUrl(prNumber) {
  if (!prNumber) return null;
  return `${GITHUB_APP_REPO}/pull/${prNumber}`;
}

function classifyReleasePhase({ diverged, needsPromote, masterSha, lastTagSha }) {
  if (diverged) return 'diverged';
  if (needsPromote) return 'needs-promote';
  if (lastTagSha && masterSha && masterSha === lastTagSha) return 'nothing-to-ship';
  return 'ready-to-ship';
}

function shortGitSha(sha) {
  return String(sha || '').trim().slice(0, 7);
}

const SHIP_BLOCKER = {
  NEEDS_PROMOTE: 'needs-promote',
  DIVERGED: 'diverged',
  NOTHING_TO_SHIP: 'nothing-to-ship',
  USER_VISIBLE_EMPTY: 'user-visible-empty',
  TAG_EXISTS: 'tag-exists',
  VAULT_DIRTY: 'vault-dirty',
  VAULT_NOT_MASTER: 'vault-not-master',
  PREPROD_SHA_MISMATCH: 'preprod-sha-mismatch',
};

const SHIP_WARNING = {
  INTERNAL_EMPTY: 'internal-empty',
  INTENT_SEED_STALE: 'intent-seed-stale',
  FIRESTORE_RULES_CHANGED: 'firestore-rules-changed',
  PRODUCTION_TASKS_PRESENT: 'production-tasks-present',
  NO_PREVIOUS_TAG: 'no-previous-tag',
};

function countMarkdownBullets(text) {
  return String(text || '')
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+/.test(line)).length;
}

function collectShipBlockers(input) {
  const blockers = [];
  const warnings = [];
  const addB = (code, message) => { blockers.push({ code, message }); };
  const addW = (code, message) => { warnings.push({ code, message }); };

  if (input.phase === 'needs-promote' && !input.skipPromote) {
    addB(SHIP_BLOCKER.NEEDS_PROMOTE, 'Run: npm run release:promote');
  }
  if (input.phase === 'diverged') {
    addB(SHIP_BLOCKER.DIVERGED, 'dev and master have diverged. Resolve manually.');
  }
  if (input.phase === 'nothing-to-ship') {
    addB(SHIP_BLOCKER.NOTHING_TO_SHIP, 'origin/master HEAD is already the latest production tag');
  }
  if (!input.userVisible && (input.phase === 'ready-to-ship' || input.phase === 'needs-promote')) {
    addB(SHIP_BLOCKER.USER_VISIBLE_EMPTY, 'Vault unreleased.md has no User-visible entries');
  }
  if (input.tagExists) {
    addB(SHIP_BLOCKER.TAG_EXISTS, 'Release tag already exists');
  }
  if (input.vaultDirty && !input.skipVaultPush) {
    addB(SHIP_BLOCKER.VAULT_DIRTY, 'Vault working tree is dirty');
  }
  if (input.vaultBranch && input.vaultBranch !== 'master') {
    addB(SHIP_BLOCKER.VAULT_NOT_MASTER, `Vault HEAD is ${input.vaultBranch}, not master`);
  }
  if (input.preprodMatch === false && !input.skipPreprodCheck) {
    addB(SHIP_BLOCKER.PREPROD_SHA_MISMATCH, 'Preprod /version gitSha does not match origin/master');
  }

  if (input.userVisible && !input.internal) {
    addW(SHIP_WARNING.INTERNAL_EMPTY, 'unreleased.md Internal section is empty');
  }
  if (input.intentSeedStale) {
    addW(SHIP_WARNING.INTENT_SEED_STALE, 'Intent seed is empty or older than 14 days');
  }
  if (input.firestoreRulesChanged) {
    addW(SHIP_WARNING.FIRESTORE_RULES_CHANGED, 'firestore.rules or firestore.indexes.json changed since last tag');
  }
  if (input.productionTasks) {
    addW(SHIP_WARNING.PRODUCTION_TASKS_PRESENT, 'production-tasks.md has bullets for this tag');
  }
  if (!input.lastTagSha) {
    addW(SHIP_WARNING.NO_PREVIOUS_TAG, 'No previous production tag. Waiting-to-ship lists origin/master first-parent.');
  }

  return { blockers, warnings };
}

function formatMergeLines(entries) {
  if (!entries || entries.length === 0) return ['  (none)'];
  return entries.map(({ sha, subject, prNumber }) => {
    const url = prUrl(prNumber);
    const suffix = url ? ` (${url})` : '';
    return `  ${sha} ${subject}${suffix}`;
  });
}

function formatNumberedCodeMessages(items) {
  if (!items || items.length === 0) return ['  (none)'];
  return items.map((item, index) => `  ${index + 1}. ${item.code}: ${item.message}`);
}

function formatOpenPrLines(openPromotePr, openSyncPr) {
  const lines = [];
  if (openPromotePr) {
    lines.push(`  promote: #${openPromotePr.number} ${openPromotePr.url} (${openPromotePr.title})`);
  }
  if (openSyncPr) {
    lines.push(`  sync: #${openSyncPr.number} ${openSyncPr.url} (${openSyncPr.title})`);
  }
  if (lines.length === 0) return ['  (none)'];
  return lines;
}

function formatReleaseStatus(report) {
  const lines = [];
  const vault = report.vault || {};
  const preprod = report.preprod || {};

  lines.push('==> Release status');
  lines.push(`  phase: ${report.phase}`);
  lines.push(`  last tag: ${report.lastTag ?? '(none)'}`);
  lines.push(`  next tag: ${report.nextTag}`);

  lines.push('==> Waiting to promote (origin/dev not in origin/master)');
  lines.push(...formatMergeLines(report.waitingToPromote));

  const shipSince = report.lastTag || 'no previous tag';
  lines.push(`==> Waiting to ship (origin/master since ${shipSince})`);
  lines.push(...formatMergeLines(report.waitingToShip));

  lines.push('==> Open PRs');
  lines.push(...formatOpenPrLines(report.openPromotePr, report.openSyncPr));

  lines.push('==> Vault');
  lines.push(`  User-visible: ${vault.userVisibleCount}`);
  lines.push(`  Internal: ${vault.internalCount}`);
  lines.push(`  production-tasks: ${vault.productionTasksCount}`);
  const cleanDirty = vault.dirty ? 'dirty' : 'clean';
  lines.push(`  git: ${vault.branch}, ${cleanDirty}, ahead ${vault.ahead} / behind ${vault.behind}`);

  lines.push('==> Preprod');
  lines.push(`  expected: ${preprod.expected}`);
  lines.push(`  actual: ${preprod.actual ?? '(skipped)'}`);
  const preprodMatch = preprod.match === null
    ? 'skipped'
    : (preprod.match ? 'yes' : 'no');
  lines.push(`  match: ${preprodMatch}`);

  lines.push('==> Blockers');
  lines.push(...formatNumberedCodeMessages(report.blockers));

  lines.push('==> Warnings');
  lines.push(...formatNumberedCodeMessages(report.warnings));

  return lines.join('\n');
}

function formatReleaseDate(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function suggestNextTag(existingTags, date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const prefix = `v${yyyy}.${mm}.`;
  const patchNumbers = existingTags
    .filter((tag) => tag.startsWith(prefix))
    .map((tag) => Number.parseInt(tag.slice(prefix.length), 10))
    .filter((n) => !Number.isNaN(n));

  const nextPatch = patchNumbers.length > 0 ? Math.max(...patchNumbers) + 1 : 0;
  return `${prefix}${nextPatch}`;
}

function normalizeTag(tag) {
  const trimmed = String(tag || '').trim();
  if (!trimmed) return null;
  return trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
}

function parseFrontmatter(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: markdown };

  const frontmatter = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    frontmatter[key] = value;
  }

  return {
    frontmatter,
    body: markdown.slice(match[0].length).replace(/^\r?\n/, ''),
  };
}

function stringifyFrontmatter(frontmatter) {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}: [${value.join(', ')}]`;
    }
    return `${key}: ${value}`;
  });
  return `---\n${lines.join('\n')}\n---\n`;
}

function extractMarkdownSections(markdown, heading) {
  const headingRe = new RegExp(`^## ${heading}\\s*$`, 'i');
  const lines = markdown.split(/\r?\n/);
  const chunks = [];
  let collecting = false;
  let current = [];

  for (const line of lines) {
    if (headingRe.test(line)) {
      if (collecting && current.length > 0) chunks.push(current.join('\n').trim());
      collecting = true;
      current = [];
      continue;
    }
    if (/^## /.test(line)) {
      if (collecting) {
        if (current.length > 0) chunks.push(current.join('\n').trim());
        collecting = false;
        current = [];
      }
      continue;
    }
    if (collecting && line.trim()) current.push(line);
  }

  if (collecting && current.length > 0) chunks.push(current.join('\n').trim());
  return chunks.join('\n\n').trim();
}

function extractUserVisibleNotes(markdown) {
  return extractMarkdownSections(markdown, 'User-visible');
}

function extractProductionTasks(markdown) {
  const fromHeading = extractMarkdownSections(markdown, 'Production tasks');
  if (fromHeading) return fromHeading;
  const { body } = parseFrontmatter(markdown);
  const bullets = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^\s*[-*]\s+/.test(line)) bullets.push(line);
  }
  return bullets.join('\n').trim();
}

function stripMarkdownSection(markdown, heading) {
  const headingRe = new RegExp(`^## ${heading}\\s*$`, 'i');
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let skipping = false;
  for (const line of lines) {
    if (headingRe.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^## /.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildReleasedMarkdown(
  sourceMarkdown,
  tag,
  releaseDate = formatReleaseDate(),
  productionTasksMarkdown = '',
) {
  const { frontmatter, body } = parseFrontmatter(sourceMarkdown);
  const nextFrontmatter = {
    ...frontmatter,
    type: frontmatter.type || 'release-log',
    project: frontmatter.project || 'WhatOrder',
    status: 'released',
    release: tag,
    date: releaseDate,
    tags: frontmatter.tags || '[whatorder, releases]',
  };

  const leftoverTasks = extractMarkdownSections(body, 'Production tasks');
  const fileTasks = extractProductionTasks(productionTasksMarkdown);
  const tasks = [fileTasks, leftoverTasks].filter(Boolean).join('\n\n');
  const changelogBody = stripMarkdownSection(body, 'Production tasks');
  const tasksBlock = `## Production tasks\n\n${tasks ? `${tasks}\n` : ''}`;
  const title = `# ${tag}`;
  return `${stringifyFrontmatter(nextFrontmatter)}${title}\n\n${tasksBlock}\n${changelogBody}\n`;
}

function buildFreshUnreleasedTemplate() {
  return `${stringifyFrontmatter({
    type: 'release-log',
    project: 'WhatOrder',
    status: 'unreleased',
    tags: '[whatorder, releases]',
  })}# Unreleased

> [!info] When to log
> Append at **task done** (\`full\` / \`app\` / \`vault\`), not at \`npm run release\`. What goes where: [[releases/README|releases/README]].

## User-visible

## Internal

`;
}

function buildFreshProductionTasksTemplate() {
  return `${stringifyFrontmatter({
    type: 'release-ops',
    project: 'WhatOrder',
    status: 'unreleased',
    tags: '[whatorder, releases, production-tasks]',
  })}# Production tasks

> [!info] When to log
> Human env steps CI will not run for **this tag**. Append at **task done**. Empty is fine. Pass 2 of \`npm run release\` copies this into \`releases/<tag>.md\` and clears this file. Rules: [[releases/README#Production tasks]].

`;
}

function branchSyncState(devAhead, masterAhead) {
  if (devAhead > 0 && masterAhead > 0) return 'diverged';
  if (devAhead > 0) return 'dev-ahead';
  if (masterAhead > 0) return 'master-ahead';
  return 'in-sync';
}

/**
 * Decide whether master is safe to release from and whether a post-release
 * master → dev back-merge is useful.
 *
 * Commit counts lie after merge commits: a promote merge leaves master +1,
 * a back-merge leaves dev +1. Use ancestry + tree equality instead.
 */
function assessReleaseBranches({ devInMaster, masterInDev, contentSynced }) {
  if (!devInMaster && !masterInDev && !contentSynced) {
    return {
      ready: false,
      reason: 'diverged',
      needsPromote: true,
      needsPostReleaseSync: false,
    };
  }

  if (devInMaster) {
    return {
      ready: true,
      reason: 'promoted',
      needsPromote: false,
      needsPostReleaseSync: !masterInDev && !contentSynced,
    };
  }

  if (contentSynced) {
    return {
      ready: true,
      reason: 'content-synced',
      needsPromote: false,
      needsPostReleaseSync: false,
    };
  }

  return {
    ready: false,
    reason: 'needs-promote',
    needsPromote: true,
    needsPostReleaseSync: false,
  };
}

function readUnreleasedOrThrow(vaultRootDir) {
  const filePath = unreleasedPath(vaultRootDir);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Vault unreleased log not found: ${filePath}`);
  }
  const content = fs.readFileSync(filePath, 'utf8');
  if (!extractUserVisibleNotes(content)) {
    throw new Error(
      'Vault unreleased.md has no User-visible entries — add release notes at task done before shipping. '
      + 'See whatorder-vault/Projects/WhatOrder/releases/README.md',
    );
  }
  return content;
}

function readProductionTasksMarkdown(vaultRootDir) {
  const filePath = productionTasksPath(vaultRootDir);
  if (!fs.existsSync(filePath)) return '';
  return fs.readFileSync(filePath, 'utf8');
}

function planVaultRelease(vaultRootDir, tag) {
  const source = readUnreleasedOrThrow(vaultRootDir);
  const productionTasksSource = readProductionTasksMarkdown(vaultRootDir);
  const releaseDate = formatReleaseDate();
  const releasedMarkdown = buildReleasedMarkdown(
    source,
    tag,
    releaseDate,
    productionTasksSource,
  );
  const freshMarkdown = buildFreshUnreleasedTemplate();
  const freshProductionTasks = buildFreshProductionTasksTemplate();
  const releasedFile = releasedPath(vaultRootDir, tag);
  const unreleasedFile = unreleasedPath(vaultRootDir);
  const productionTasksFile = productionTasksPath(vaultRootDir);

  return {
    releasedFile,
    unreleasedFile,
    productionTasksFile,
    releasedMarkdown,
    freshMarkdown,
    freshProductionTasks,
    releaseNotes: extractUserVisibleNotes(source),
    productionTasks: extractProductionTasks(productionTasksSource)
      || extractMarkdownSections(source, 'Production tasks'),
    releaseDate,
  };
}

function applyVaultRelease(plan) {
  if (fs.existsSync(plan.releasedFile)) {
    throw new Error(`Vault release file already exists: ${plan.releasedFile}`);
  }

  fs.writeFileSync(plan.releasedFile, plan.releasedMarkdown, 'utf8');
  fs.writeFileSync(plan.unreleasedFile, plan.freshMarkdown, 'utf8');
  fs.writeFileSync(plan.productionTasksFile, plan.freshProductionTasks, 'utf8');
}

/** @deprecated Use planVaultRelease + applyVaultRelease; kept for tests */
function rotateVaultRelease(vaultRootDir, tag, { dryRun = false } = {}) {
  const plan = planVaultRelease(vaultRootDir, tag);
  if (!dryRun) {
    applyVaultRelease(plan);
  }
  return plan;
}

function printNextSteps(title, steps) {
  if (!steps.length) return;
  console.log(`\n--- ${title} ---`);
  steps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step}`);
  });
}

const RELEASE_OVERVIEW_ROWS = [
  ['CI', 'Merge feature PR to `dev` → Test auto-deploys'],
  ['You', `Smoke Test — dashboard ${TEST_DASHBOARD_URL} + \`curl ${TEST_BACKEND_VERSION_URL}\` (badge Test, matching gitSha)`],
  ['You', 'task done → append vault releases/unreleased.md and production-tasks.md'],
  ['Script', '`npm run release:status` - read-only: phase, merge lists, blockers (exit 0)'],
  ['Script', '`npm run release:promote` - pass 1: opens **dev → master** PR if needed; **never ships**'],
  ['GitHub', 'Merge the promote PR when CI is green'],
  ['CI', '**Deploy to Preproduction** runs on `master` push (automatic)'],
  ['You', `Smoke Preprod — ${PREPROD_DASHBOARD_URL} + preprod /version (sandbox WhatsApp + Stripe only)`],
  ['Script', '`npm run release:dry-run` - preview ship; **exit 1** if any ship blocker (no writes)'],
  ['Script', '`npm run release` - pass 2 only: vault changelog + GitHub Release; **never opens a promote PR**'],
  ['CI', '**Release to Production** — promotes same backend image; dashboard rebuilds for prod'],
  ['You', `Verify prod — \`curl ${PROD_HEALTH_URL}\` + ${PROD_DASHBOARD_URL}`],
  ['GitHub', 'Merge **master → dev** sync PR if the script opened one'],
];

function printReleaseOverview() {
  console.log('\n--- Release workflow ---');
  console.log(`  Test dashboard:    ${TEST_DASHBOARD_URL}`);
  console.log(`  Preprod dashboard: ${PREPROD_DASHBOARD_URL}`);
  console.log(`  Prod dashboard:    ${PROD_DASHBOARD_URL}`);
  console.log('');
  const whoWidth = Math.max(...RELEASE_OVERVIEW_ROWS.map(([who]) => who.length));
  RELEASE_OVERVIEW_ROWS.forEach(([who, what], index) => {
    const n = String(index + 1).padStart(2);
    console.log(`  ${n}. ${who.padEnd(whoWidth)}  ${what}`);
  });
  console.log('\n  Legend: CI/GitHub = outside terminal · Script = npm in whatorder-app · You = manual verify or vault');
}

function nextStepsForPromoteRequired({ prUrl, dryRun } = {}) {
  const steps = [];
  if (prUrl) {
    steps.push(`Merge the promote PR: ${prUrl}`);
  } else if (dryRun) {
    steps.push('Merge the **dev → master** promote PR when CI is green');
  } else {
    steps.push('Merge the **dev → master** promote PR when CI is green');
  }
  steps.push('Wait for **Deploy to Preproduction** workflow to finish on `master`');
  steps.push('Do any bullets in vault `releases/production-tasks.md` before the named gate');
  steps.push(`Smoke-test Preprod: ${PREPROD_DASHBOARD_URL} (guide: vault notes/deploy-test-to-prod.md)`);
  steps.push('Re-run: `npm run release`');
  steps.push('(Optional preview first: `npm run release:dry-run`)');
  printNextSteps('Next steps', steps);
}

function nextStepsForReleaseComplete({ tag, syncPrUrl, needsPostReleaseSync, skipWatch = false }) {
  console.log(`\n✅ Release ${tag} published — script finished.`);
  if (skipWatch) {
    console.log('   **Release to Production** running on GitHub — check Actions (used --skip-watch).');
  } else {
    console.log('   **Release to Production** finished (script waited on `gh run watch`).');
  }
  const followUps = [
    `Verify prod dashboard: ${PROD_DASHBOARD_URL}`,
    `Verify backend: ${PROD_HEALTH_URL}`,
  ];
  if (needsPostReleaseSync && syncPrUrl) {
    followUps.push(`Merge the sync PR (GitHub, not this script): ${syncPrUrl}`);
    followUps.push('Then branch new work from `dev`');
  } else if (needsPostReleaseSync) {
    followUps.push('Merge the **master → dev** sync PR on GitHub when CI is green');
  } else {
    followUps.push('Branches aligned — start the next feature branch from `dev`');
  }
  followUps.push('Go-live only: cutover checklist in vault `specs/environments-and-branching`');
  printNextSteps('Optional follow-ups (outside this script)', followUps);
}

function nextStepsForDiverged() {
  printNextSteps('Next steps', [
    'Resolve the divergence locally (merge or rebase — team choice)',
    'Push fixed `dev` and/or `master`, then run `npm run release` again',
  ]);
}

function nextStepsForPromoteOnlyAlreadyDone() {
  printNextSteps('Already promoted — next steps', [
    `Smoke Preprod: ${PREPROD_DASHBOARD_URL} (Phase 3 checklist in deploy guide)`,
    'Fill vault `releases/unreleased.md` and `production-tasks.md` if not done at task done',
    'Ship: `npm run release` (pass 2 — vault + GitHub Release)',
    'Preview ship: `npm run release:dry-run`',
  ]);
}

function nextStepsForDryRunComplete({ wouldPromote, tag }) {
  if (wouldPromote) {
    nextStepsForPromoteRequired({ dryRun: true });
    return;
  }
  printNextSteps('Dry run OK — to ship for real', [
    `Run: \`npm run release\`${tag ? ` (will use tag ${tag})` : ''}`,
    'Confirm vault commit + GitHub Release when prompted (or pass `--yes`)',
    'Watch the **Release to Production** GitHub Action until green',
  ]);
}
function printHelp() {
  printReleaseOverview();
  console.log(`Usage: npm run release [-- options]

Ship production by publishing a GitHub Release from master, rotating the vault
changelog, and opening PRs to keep dev and master aligned.

Options:
  --tag <vYYYY.MM.N>   Release tag (default: next tag for current month)
  --status             Print release state and merge lists; no writes (npm run release:status)
  --dry-run            Print plan only; no writes; exit 1 if any ship blocker
                       (npm: use \`npm run release:dry-run\` or \`npm run release -- --dry-run\`)
  --yes, -y            Skip confirmation prompts
  --skip-promote       Drop the needs-promote ship blocker only (escape hatch; does not open a PR)
  --skip-sync          Do not create master → dev sync PR after release
  --skip-vault-push    Rotate vault files locally but do not commit/push vault
  --skip-watch         Do not block on \`gh run watch\` after publishing (or Ctrl+C during watch)
  --skip-preprod-check Skip preprod /version SHA check before publishing release
  --promote-only       Pass 1 only — open dev → master PR; never ship
  --help, -h           Show this help

Docs: whatorder-vault/Projects/WhatOrder/notes/deploy-test-to-prod.md
`);
}

module.exports = {
  PROD_HEALTH_URL,
  PREPROD_VERSION_URL,
  TEST_BACKEND_VERSION_URL,
  TEST_DASHBOARD_URL,
  PREPROD_DASHBOARD_URL,
  PROD_DASHBOARD_URL,
  PREPROD_WORKFLOW_NAME,
  RELEASE_WORKFLOW_NAME,
  GITHUB_APP_REPO,
  appRoot,
  vaultRoot,
  vaultReleasesDir,
  unreleasedPath,
  productionTasksPath,
  releasedPath,
  parseReleaseArgs,
  parsePrNumberFromSubject,
  parseFirstParentLog,
  prUrl,
  classifyReleasePhase,
  shortGitSha,
  SHIP_BLOCKER,
  SHIP_WARNING,
  countMarkdownBullets,
  collectShipBlockers,
  formatReleaseStatus,
  formatReleaseDate,
  suggestNextTag,
  normalizeTag,
  parseFrontmatter,
  stringifyFrontmatter,
  extractMarkdownSections,
  extractUserVisibleNotes,
  extractProductionTasks,
  stripMarkdownSection,
  buildReleasedMarkdown,
  buildFreshUnreleasedTemplate,
  buildFreshProductionTasksTemplate,
  branchSyncState,
  assessReleaseBranches,
  readUnreleasedOrThrow,
  planVaultRelease,
  applyVaultRelease,
  rotateVaultRelease,
  printHelp,
  printReleaseOverview,
  printNextSteps,
  nextStepsForPromoteRequired,
  nextStepsForReleaseComplete,
  nextStepsForDiverged,
  nextStepsForPromoteOnlyAlreadyDone,
  nextStepsForDryRunComplete,
};
