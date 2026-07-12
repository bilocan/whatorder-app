const fs = require('fs');
const path = require('path');

const PROD_HEALTH_URL = 'https://whatorder-backend-87472938058.europe-west3.run.app/health';
const PREPROD_VERSION_URL = 'https://whatorder-backend-pre-87472938058.europe-west3.run.app/version';
const PREPROD_WORKFLOW_NAME = 'Deploy to Preproduction';
const RELEASE_WORKFLOW_NAME = 'Release to Production';

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
    help: false,
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
    else if (arg === '--tag' && argv[i + 1]) flags.tag = argv[++i];
    else if (arg === '--help' || arg === '-h') flags.help = true;
  }

  return flags;
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

function extractUserVisibleNotes(markdown) {
  const lines = markdown.split(/\r?\n/);
  const chunks = [];
  let collecting = false;
  let current = [];

  for (const line of lines) {
    if (/^## User-visible\s*$/i.test(line)) {
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

function buildReleasedMarkdown(sourceMarkdown, tag, releaseDate = formatReleaseDate()) {
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

  const title = `# ${tag}`;
  return `${stringifyFrontmatter(nextFrontmatter)}${title}\n\n${body.trim()}\n`;
}

function buildFreshUnreleasedTemplate() {
  return `${stringifyFrontmatter({
    type: 'release-log',
    project: 'WhatOrder',
    status: 'unreleased',
    tags: '[whatorder, releases]',
  })}# Unreleased

## User-visible

## Internal

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
    throw new Error('Vault unreleased.md has no User-visible entries — add release notes before shipping.');
  }
  return content;
}

function rotateVaultRelease(vaultRootDir, tag, { dryRun = false } = {}) {
  const source = readUnreleasedOrThrow(vaultRootDir);
  const releaseDate = formatReleaseDate();
  const released = buildReleasedMarkdown(source, tag, releaseDate);
  const fresh = buildFreshUnreleasedTemplate();
  const releasedFile = releasedPath(vaultRootDir, tag);
  const unreleasedFile = unreleasedPath(vaultRootDir);

  if (dryRun) {
    return {
      releasedFile,
      unreleasedFile,
      releaseNotes: extractUserVisibleNotes(source),
      releaseDate,
    };
  }

  if (fs.existsSync(releasedFile)) {
    throw new Error(`Vault release file already exists: ${releasedFile}`);
  }

  fs.writeFileSync(releasedFile, released, 'utf8');
  fs.writeFileSync(unreleasedFile, fresh, 'utf8');

  return {
    releasedFile,
    unreleasedFile,
    releaseNotes: extractUserVisibleNotes(source),
    releaseDate,
  };
}

function printNextSteps(title, steps) {
  if (!steps.length) return;
  console.log(`\n--- ${title} ---`);
  steps.forEach((step, index) => {
    console.log(`  ${index + 1}. ${step}`);
  });
}

const RELEASE_OVERVIEW_STEPS = [
  'Verify changes on **Test** (`whatorder-fire.web.app`) after merging feature PRs into `dev`',
  'Run `npm run release` — opens **dev → master** promote PR if needed',
  'Merge promote PR when CI is green → **Deploy to Preproduction** runs on `master`',
  'Smoke-test on **Preprod** (`pre.whatorder.at`) — prod-parity config, sandbox webhooks only',
  'Re-run `npm run release` — rotates vault changelog + publishes GitHub Release',
  'Release **promotes the same image SHA** to live prod (no backend rebuild)',
  'Merge **master → dev** sync PR if opened',
];

function printReleaseOverview() {
  printNextSteps('Release workflow (overview)', RELEASE_OVERVIEW_STEPS);
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
  steps.push(`Smoke-test Preprod: https://pre.whatorder.at (guide: vault notes/deploy-test-to-prod.md)`);
  steps.push('Re-run: `npm run release`');
  steps.push('(Optional preview first: `npm run release -- --dry-run`)');
  printNextSteps('Next steps', steps);
}

function nextStepsForReleaseComplete({ tag, syncPrUrl, needsPostReleaseSync }) {
  const steps = [
    `Prod deploy promoted for **${tag}** — dashboard: https://whatorder-fire-prod.web.app`,
    `Backend health: ${PROD_HEALTH_URL}`,
    'If this was a go-live release, run the cutover checklist in vault `specs/environments-and-branching`',
  ];
  if (needsPostReleaseSync && syncPrUrl) {
    steps.push(`Merge the sync PR: ${syncPrUrl}`);
    steps.push('Then branch new work from `dev` as usual');
  } else if (needsPostReleaseSync) {
    steps.push('Merge the **master → dev** sync PR when CI is green');
  } else {
    steps.push('Branches already aligned — start the next feature branch from `dev`');
  }
  printNextSteps('Release complete — what to do next', steps);
}

function nextStepsForDiverged() {
  printNextSteps('Next steps', [
    'Resolve the divergence locally (merge or rebase — team choice)',
    'Push fixed `dev` and/or `master`, then run `npm run release` again',
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
  --dry-run            Print plan only; no file writes, PRs, or release
  --yes, -y            Skip confirmation prompts
  --skip-promote       Do not require/create dev → master promote PR
  --skip-sync          Do not create master → dev sync PR after release
  --skip-vault-push    Rotate vault files locally but do not commit/push vault
  --skip-watch         Do not wait on the Release to Production GitHub Action
  --skip-preprod-check Skip preprod /version SHA check before publishing release
  --help, -h           Show this help

Docs: whatorder-vault/Projects/WhatOrder/notes/deploy-test-to-prod.md
`);
}

module.exports = {
  PROD_HEALTH_URL,
  PREPROD_VERSION_URL,
  PREPROD_WORKFLOW_NAME,
  RELEASE_WORKFLOW_NAME,
  appRoot,
  vaultRoot,
  vaultReleasesDir,
  unreleasedPath,
  releasedPath,
  parseReleaseArgs,
  formatReleaseDate,
  suggestNextTag,
  normalizeTag,
  parseFrontmatter,
  stringifyFrontmatter,
  extractUserVisibleNotes,
  buildReleasedMarkdown,
  buildFreshUnreleasedTemplate,
  branchSyncState,
  assessReleaseBranches,
  readUnreleasedOrThrow,
  rotateVaultRelease,
  printHelp,
  printReleaseOverview,
  printNextSteps,
  nextStepsForPromoteRequired,
  nextStepsForReleaseComplete,
  nextStepsForDiverged,
  nextStepsForDryRunComplete,
};
