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

test('loadScriptFile validates basket_edit_mid_checkout Pack C script', () => {
  const doc = loadScriptFile(path.join(__dirname, '../scripts/basket_edit_mid_checkout.yml'));
  expect(doc).toMatchObject({
    id: 'basket_edit_mid_checkout',
    pack: 'c',
    priority: 'p1',
    timeout_ms: 60_000,
  });
  expect(doc.steps).toHaveLength(6);
  expect(doc.steps[3]).toEqual({ send: { text: 'mach 2 ayran' } });
  expect(doc.steps[4]).toEqual({
    gate: { name: 'basket_qty', item_includes: 'ayran', eq: 2 },
  });
});

test('loadScriptFile validates happy_delivery_address_prompt Pack C script', () => {
  const doc = loadScriptFile(path.join(__dirname, '../scripts/happy_delivery_address_prompt.yml'));
  expect(doc).toMatchObject({
    id: 'happy_delivery_address_prompt',
    pack: 'c',
    priority: 'p1',
    manual: 'M2 row 50',
    timeout_ms: 120_000,
  });
  expect(doc.steps).toHaveLength(9);
  expect(doc.steps[4]).toEqual({
    gate: {
      name: 'state',
      in: [
        'awaiting_delivery_address_choice',
        'awaiting_delivery_address',
        'awaiting_delivery_address_confirm',
        'awaiting_delivery_address_unit',
      ],
    },
  });
  expect(doc.steps[5]).toEqual({ macro: 'complete_delivery_address_ask' });
  expect(doc.steps[8]).toEqual({
    gate: { name: 'order_stripe_delivery', address_includes: 'Hauptstraße' },
  });
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
