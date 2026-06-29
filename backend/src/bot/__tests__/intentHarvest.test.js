const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  evaluateHarvestPhrase,
  formatHarvestReport,
  isDefaultGreen,
  runHarvestBatch,
  writeHarvestManifest,
} = require('../intentHarvest');
const { evaluateIntent, BUILTIN_MENU } = require('../intentSandbox');
const { buildMenuMatchIndex } = require('../menuMapper');

const FIXTURE_MENU = [
  { id: 'kebab', name: 'Kebap Sandwich Huhn', price: 7.5, category: 'Kebap', available: true },
  { id: 'cola', name: 'Coca Cola 0.33L', price: 2.9, category: 'Getraenke', available: true },
];

describe('intentHarvest', () => {
  test('parsePhrasesTxt ignores comments and blanks', () => {
    const { parsePhrasesTxt } = require('../intentHarvest');
    expect(parsePhrasesTxt('# comment\n\nein Cola\n')).toEqual(['ein Cola']);
  });
  test('isDefaultGreen accepts rules proposal with matched SKUs', async () => {
    const menuMatch = buildMenuMatchIndex(FIXTURE_MENU);
    const result = await evaluateIntent('ein Cola', { menu: FIXTURE_MENU, menuMatch });
    expect(isDefaultGreen(result)).toBe(true);
  });

  test('evaluateHarvestPhrase uses expect when provided', async () => {
    const menuMatch = buildMenuMatchIndex(FIXTURE_MENU);
    const evalCtx = {
      evaluate: (text) => evaluateIntent(text, { menu: FIXTURE_MENU, menuMatch }),
    };
    const run = await evaluateHarvestPhrase({
      id: 'cola',
      text: 'ein Cola',
      expect: { outcome: 'proposal', matchedNames: ['Coca Cola 0.33L'] },
    }, evalCtx, {});
    expect(run.pass).toBe(true);
  });

  test('formatPhraseDetail shows beilagen for mit allem', async () => {
    const { formatPhraseDetail } = require('../intentHarvest');
    const menuMatch = buildMenuMatchIndex(BUILTIN_MENU);
    const result = await evaluateIntent('döner mit allem ohne scharf bitte', { menu: BUILTIN_MENU, menuMatch, llm: false });
    const detail = formatPhraseDetail({
      pass: true,
      text: 'döner mit allem ohne scharf bitte',
      snapshot: { outcome: 'proposal', parsedBy: 'rules' },
      result,
    });
    expect(detail).toMatch(/Tomaten/);
    expect(detail).not.toMatch(/Scharfe Sauce/);
  });

  test('formatInteractiveSessionSummary lists skipped passes not in pilot', () => {
    const { formatInteractiveSessionSummary } = require('../intentHarvest');
    const summary = formatInteractiveSessionSummary({
      total: 3,
      reviewed: 3,
      recorded: 0,
      skipped: 1,
      skippedPassedNew: 1,
      alreadyInPilot: 2,
      quitEarly: false,
      remaining: 0,
    });
    expect(summary).toContain('recorded: 0');
    expect(summary).toContain('already in pilot.json: 2');
    expect(summary).toContain('not in pilot yet');
  });

  test('runHarvestBatch records passing phrases to pilot.json', async () => {
    const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'harvest-'));
    const slug = 'demo';
    const tenantDir = path.join(corpusDir, 'restaurants', slug);
    fs.mkdirSync(tenantDir, { recursive: true });
    fs.writeFileSync(path.join(tenantDir, 'menu.json'), JSON.stringify(FIXTURE_MENU));
    fs.writeFileSync(
      path.join(tenantDir, 'pilot.json'),
      JSON.stringify({
        version: 1,
        name: 'demo-pilot',
        menu: 'menu.json',
        cases: [],
      }),
    );

    const manifest = {
      restaurant: slug,
      phrases: [
        { id: 'cola-case', text: 'ein Cola', source: 'owner', tags: ['owner_pattern'] },
        { id: 'empty', text: '', source: 'owner' },
      ],
    };
    writeHarvestManifest(path.join(tenantDir, 'harvest.json'), manifest);

    const summary = await runHarvestBatch(manifest, {
      slug,
      corpusDir,
      record: true,
      manifestPath: path.join(tenantDir, 'harvest.json'),
      writeManifest: true,
    });

    expect(summary.passed).toBe(1);
    expect(summary.recorded).toBe(1);
    expect(summary.skipped).toBe(1);

    const pilot = JSON.parse(fs.readFileSync(path.join(tenantDir, 'pilot.json'), 'utf8'));
    expect(pilot.cases).toHaveLength(1);
    expect(pilot.cases[0].text).toBe('ein Cola');

    const report = formatHarvestReport(summary);
    expect(report).toContain('✓ cola-case');
  });
});
