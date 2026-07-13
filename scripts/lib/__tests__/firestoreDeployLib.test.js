const { test } = require('node:test');
const assert = require('node:assert');

const {
  stripJsonComments,
  indexKey,
  missingIndexes,
  buildIndexCreateArgs,
  buildRulesetBody,
  releaseName,
} = require('../firestoreDeployLib');

const repoIndex = {
  collectionGroup: 'orders',
  queryScope: 'COLLECTION',
  fields: [
    { fieldPath: 'customerPhone', order: 'ASCENDING' },
    { fieldPath: 'createdAt', order: 'DESCENDING' },
  ],
};

test('stripJsonComments handles JSONC line and block comments', () => {
  const jsonc = '{\r\n  // firebase-tools JSONC comment\r\n  "a": "http://x//y", /* block */ "b": "c \\" // not a comment"\r\n}';
  const parsed = JSON.parse(stripJsonComments(jsonc));
  assert.strictEqual(parsed.a, 'http://x//y');
  assert.strictEqual(parsed.b, 'c " // not a comment');
});

test('indexKey strips the auto-added __name__ field', () => {
  const deployed = {
    name: 'projects/p/databases/preprod/collectionGroups/orders/indexes/abc',
    queryScope: 'COLLECTION',
    fields: [
      { fieldPath: 'customerPhone', order: 'ASCENDING' },
      { fieldPath: 'createdAt', order: 'DESCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ],
  };
  assert.strictEqual(indexKey(deployed), indexKey(repoIndex));
});

test('indexKey distinguishes query scopes', () => {
  const cgScope = { ...repoIndex, queryScope: 'COLLECTION_GROUP' };
  assert.notStrictEqual(indexKey(cgScope), indexKey(repoIndex));
});

test('missingIndexes returns only undeployed repo indexes', () => {
  const other = {
    collectionGroup: 'payouts',
    queryScope: 'COLLECTION',
    fields: [{ fieldPath: 'businessId', order: 'ASCENDING' }],
  };
  const deployed = [{
    name: 'projects/p/databases/preprod/collectionGroups/orders/indexes/abc',
    queryScope: 'COLLECTION',
    fields: [...repoIndex.fields, { fieldPath: '__name__', order: 'DESCENDING' }],
  }];
  assert.deepStrictEqual(missingIndexes([repoIndex, other], deployed), [other]);
});

test('buildIndexCreateArgs emits gcloud field-config flags', () => {
  const args = buildIndexCreateArgs(repoIndex, { project: 'p', database: 'preprod' });
  assert.ok(args.includes('--collection-group=orders'));
  assert.ok(args.includes('--database=preprod'));
  assert.ok(args.includes('--field-config=field-path=customerPhone,order=ascending'));
  assert.ok(args.includes('--field-config=field-path=createdAt,order=descending'));
});

test('buildRulesetBody wraps rules content for the Rules API', () => {
  const body = buildRulesetBody('rules_version = "2";');
  assert.strictEqual(body.source.files[0].name, 'firestore.rules');
  assert.strictEqual(body.source.files[0].content, 'rules_version = "2";');
});

test('releaseName handles default and named databases', () => {
  assert.strictEqual(releaseName('p', '(default)'), 'projects/p/releases/cloud.firestore');
  assert.strictEqual(releaseName('p', 'preprod'), 'projects/p/releases/cloud.firestore/preprod');
});
