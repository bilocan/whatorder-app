const path = require('path');
const {
  assertExpectations,
  formatEvalReport,
  loadCorpusFile,
  runCase,
  runCorpusEval,
} = require('../intentEval');
const { BUILTIN_MENU, evaluateIntent } = require('../intentSandbox');

const CORPUS_PATH = path.join(__dirname, '../../../fixtures/intent-corpus/builtin.json');

describe('assertExpectations', () => {
  test('passes when result matches expect block', async () => {
    const result = await evaluateIntent('2x Cola', {
      menu: BUILTIN_MENU,
      lang: 'de',
      llm: false,
    });
    const failures = assertExpectations(result, {
      outcome: 'proposal',
      parsedBy: 'rules',
      matchedNames: ['Cola'],
    });
    expect(failures).toEqual([]);
  });

  test('reports outcome mismatch', () => {
    const failures = assertExpectations(
      { outcome: 'no_match', orderLike: true },
      { outcome: 'proposal' },
    );
    expect(failures[0]).toMatch(/outcome/);
  });
});

describe('intent corpus (rules-only)', () => {
  test('builtin.json loads with cases', () => {
    const { meta, cases } = loadCorpusFile(CORPUS_PATH);
    expect(meta.name).toBe('builtin-pilot-phrases');
    expect(cases.length).toBeGreaterThanOrEqual(25);
  });

  test('all builtin corpus cases pass without LLM', async () => {
    const report = await runCorpusEval({ file: 'builtin.json', llm: false });
    if (report.failed > 0) {
      console.error(formatEvalReport(report, { verbose: true }));
    }
    expect(report.failed).toBe(0);
    expect(report.total).toBeGreaterThanOrEqual(25);
  });

  test('modifier-tagged cases pass', async () => {
    const report = await runCorpusEval({ file: 'builtin.json', tag: 'modifier', llm: false });
    expect(report.failed).toBe(0);
    expect(report.total).toBeGreaterThan(0);
  });
});

describe('runCase', () => {
  test('returns structured pass/fail for a single case', async () => {
    const { cases } = loadCorpusFile(CORPUS_PATH);
    const caseDef = cases.find(c => c.id === 'qty-2x-cola');
    const run = await runCase(caseDef, { llm: false });
    expect(run.pass).toBe(true);
    expect(run.result.outcome).toBe('proposal');
  });
});
