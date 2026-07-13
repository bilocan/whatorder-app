/**
 * Pure helpers for deploying Firestore rules + composite indexes to a named
 * database (preprod). The default database is deployed by firebase-tools via
 * firebase.json; named databases are not (multi-DB `--only firestore:rules`
 * silently no-ops — firebase-tools #10447), so we go through the Rules API
 * and `gcloud firestore indexes` instead.
 */

/**
 * firebase-tools accepts // and block comments in firestore.indexes.json
 * (JSONC); JSON.parse does not. Strip comments outside string literals.
 *
 * @param {string} text
 * @returns {string} strict JSON
 */
function stripJsonComments(text) {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') { out += next ?? ''; i += 1; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i += 1;
      out += '\n';
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i += 1;
      i += 1;
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Canonical key for a composite index: collection group + query scope +
 * ordered field specs. Firestore appends a __name__ field to stored indexes;
 * strip it so repo definitions compare equal to deployed ones.
 *
 * @param {{collectionGroup?: string, queryScope: string, fields: Array<object>, name?: string}} index
 * @returns {string}
 */
function indexKey(index) {
  const cg = index.collectionGroup
    || /collectionGroups\/([^/]+)\//.exec(index.name || '')?.[1]
    || '';
  const fields = (index.fields || [])
    .filter((f) => f.fieldPath !== '__name__')
    .map((f) => `${f.fieldPath}:${f.order || f.arrayConfig || ''}`);
  return `${cg}|${index.queryScope}|${fields.join(',')}`;
}

/**
 * Indexes present in the repo definition but missing from the deployed list.
 *
 * @param {Array<object>} repoIndexes  firestore.indexes.json `indexes` array
 * @param {Array<object>} deployedIndexes  gcloud composite list (JSON)
 */
function missingIndexes(repoIndexes, deployedIndexes) {
  const deployed = new Set(deployedIndexes.map(indexKey));
  return repoIndexes.filter((idx) => !deployed.has(indexKey(idx)));
}

/**
 * gcloud args to create one composite index on a named database.
 *
 * @param {{collectionGroup: string, queryScope: string, fields: Array<object>}} index
 * @param {{project: string, database: string}} target
 */
function buildIndexCreateArgs(index, { project, database }) {
  const args = [
    'firestore', 'indexes', 'composite', 'create',
    `--project=${project}`,
    `--database=${database}`,
    `--collection-group=${index.collectionGroup}`,
    `--query-scope=${index.queryScope}`,
  ];
  for (const field of index.fields) {
    if (field.fieldPath === '__name__') continue;
    const spec = field.arrayConfig
      ? `field-path=${field.fieldPath},array-config=${field.arrayConfig.toLowerCase()}`
      : `field-path=${field.fieldPath},order=${(field.order || 'ASCENDING').toLowerCase()}`;
    args.push(`--field-config=${spec}`);
  }
  return args;
}

/** Rules API request body for a ruleset created from firestore.rules content. */
function buildRulesetBody(rulesContent) {
  return {
    source: {
      files: [{ name: 'firestore.rules', content: rulesContent }],
    },
  };
}

/** Rules API release name for a database: default DB has no suffix. */
function releaseName(project, database) {
  return database === '(default)'
    ? `projects/${project}/releases/cloud.firestore`
    : `projects/${project}/releases/cloud.firestore/${database}`;
}

module.exports = {
  stripJsonComments,
  indexKey,
  missingIndexes,
  buildIndexCreateArgs,
  buildRulesetBody,
  releaseName,
};
