'use strict';

const path = require('path');
const { loadScriptFile, listScriptFiles } = require('../lib/scriptLoader');
const { validateScript } = require('../lib/scriptRunner');

test('loadScriptFile reads id and steps', () => {
  const doc = loadScriptFile(path.join(__dirname, 'fixtures/minimal.yml'));
  expect(doc.id).toBe('minimal');
  expect(doc.steps.length).toBeGreaterThan(0);
});

test('loadScriptFile defaults pack and timeout_ms', () => {
  const doc = loadScriptFile(path.join(__dirname, 'fixtures/minimal.yml'));
  expect(doc.pack).toBe('c');
  expect(doc.timeout_ms).toBe(45_000);
});

test('loadScriptFile validates the Pack A delivery script', () => {
  const doc = loadScriptFile(path.join(__dirname, '../scripts/happy_stripe_delivery.yml'));
  expect(doc).toMatchObject({
    id: 'happy_stripe_delivery',
    pack: 'a',
    priority: 'p0',
    timeout_ms: 90_000,
  });
  expect(doc.steps).toHaveLength(8);
});

test('loadScriptFile throws when id missing', () => {
  const fs = require('fs');
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `e2e-wa-${Date.now()}.yml`);
  fs.writeFileSync(tmp, 'steps:\n  - send: { text: "hi" }\n');
  try {
    expect(() => loadScriptFile(tmp)).toThrow(/missing id/i);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('loadScriptFile throws when steps missing', () => {
  const fs = require('fs');
  const os = require('os');
  const tmp = path.join(os.tmpdir(), `e2e-wa-${Date.now()}.yml`);
  fs.writeFileSync(tmp, 'id: no-steps\n');
  try {
    expect(() => loadScriptFile(tmp)).toThrow(/missing steps/i);
  } finally {
    fs.unlinkSync(tmp);
  }
});

test('listScriptFiles returns loaded scripts from directory', () => {
  const dir = path.join(__dirname, 'fixtures');
  const files = listScriptFiles(dir);
  expect(files.length).toBeGreaterThan(0);
  expect(files[0]).toMatchObject({
    id: 'minimal',
    pack: 'c',
    path: expect.stringContaining('minimal.yml'),
    doc: expect.objectContaining({ id: 'minimal' }),
  });
});

test('listScriptFiles returns empty array for missing directory', () => {
  expect(listScriptFiles('/nonexistent/e2e-wa-scripts')).toEqual([]);
});

test('every checked-in YAML script validates', () => {
  const scriptsDir = path.join(__dirname, '../scripts');
  const files = listScriptFiles(scriptsDir);
  expect(files.length).toBeGreaterThan(0);
  expect(files.every((file) => !file.error)).toBe(true);
  for (const file of files) {
    expect(() => validateScript(file.doc)).not.toThrow();
  }
});

test('listScriptFiles isolates a broken YAML file for deferred failure', () => {
  const fs = require('fs');
  const os = require('os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-wa-scripts-'));
  fs.writeFileSync(path.join(dir, 'good.yml'), 'id: good\nsteps:\n  - send: { text: "hi" }\n');
  fs.writeFileSync(path.join(dir, 'broken.yml'), 'id: broken\nsteps:\n  - sleep: 500\n');
  try {
    const files = listScriptFiles(dir);
    expect(files).toHaveLength(2);
    expect(files.find((file) => file.id === 'good').error).toBeUndefined();
    expect(files.find((file) => file.id === 'broken').error).toEqual(expect.any(Error));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
