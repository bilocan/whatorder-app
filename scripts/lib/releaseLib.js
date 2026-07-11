const fs = require('fs');
const path = require('path');

const PROD_HEALTH_URL = 'https://whatorder-backend-87472938058.europe-west3.run.app/health';
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

function printHelp() {
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
  --help, -h           Show this help

Flow:
  1. Ensure dev is merged into master (opens promote PR if needed)
  2. Rotate vault releases/unreleased.md → releases/<tag>.md
  3. Commit + push vault on master
  4. gh release create (triggers prod deploy via release.yml)
  5. Watch deploy + prod /health
  6. Open master → dev sync PR if master is ahead of dev

Docs: whatorder-vault/Projects/WhatOrder/specs/dev-workflow-guide.md
`);
}

module.exports = {
  PROD_HEALTH_URL,
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
  readUnreleasedOrThrow,
  rotateVaultRelease,
  printHelp,
};
