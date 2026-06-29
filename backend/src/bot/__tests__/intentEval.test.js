const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendCaseToCorpus,
  buildRecordedCase,
  isCandidateCase,
  loadAllCases,
  readCorpusDocument,
  recordExpectFromResult,
  runCorpusEval,
  slugifyCaseId,
  writeCorpusDocument,
} = require('../intentEval');
const { BUILTIN_MENU, evaluateIntent } = require('../intentSandbox');

const CORPUS_PATH = path.join(__dirname, '../../../fixtures/intent-corpus/builtin.json');
const CANDIDATE_PATH = path.join(__dirname, '../../../fixtures/intent-corpus/candidate.json');

describe('recordExpectFromResult', () => {
  test('snapshots outcome, parsedBy, intent items, and matched names', async () => {
    const result = await evaluateIntent('2x Cola', {
      menu: BUILTIN_MENU,
      lang: 'de',
      llm: false,
    });
    const snapshot = recordExpectFromResult(result);
    expect(snapshot.outcome).toBe('proposal');
    expect(snapshot.parsedBy).toBe('rules');
    expect(snapshot.intentItems).toEqual([{ name: 'Cola', qty: 2 }]);
    expect(snapshot.matchedNames).toEqual(['Cola']);
  });
});

describe('slugifyCaseId', () => {
  test('deduplicates when slug already taken', () => {
    const ids = new Set(['zwei-doner']);
    expect(slugifyCaseId('zwei döner', ids)).toBe('zwei-doner-2');
  });
});

describe('buildRecordedCase', () => {
  test('marks candidate status and tag by default', async () => {
    const result = await evaluateIntent('cola', { menu: BUILTIN_MENU, llm: false });
    const caseDef = buildRecordedCase(result, { text: 'cola', status: 'candidate' });
    expect(caseDef.status).toBe('candidate');
    expect(caseDef.tags).toContain('candidate');
    expect(caseDef.expect.outcome).toBe('proposal');
  });
});

describe('loadAllCases modes', () => {
  test('ci mode loads only builtin.json', () => {
    const { cases } = loadAllCases({ mode: 'ci' });
    expect(cases.length).toBeGreaterThanOrEqual(25);
    expect(cases.every(c => c._source === 'builtin.json')).toBe(true);
  });

  test('candidate mode loads candidate file only', () => {
    const { cases } = loadAllCases({ mode: 'candidate' });
    expect(Array.isArray(cases)).toBe(true);
  });

  test('shipped mode skips status candidate cases', () => {
    const { cases } = loadAllCases({ mode: 'shipped' });
    expect(cases.every(c => !isCandidateCase(c))).toBe(true);
  });
});

describe('appendCaseToCorpus', () => {
  test('writes case to temp corpus and rejects duplicate id', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-corpus-'));
    const caseDef = {
      id: 'test-case',
      text: '2x cola',
      tags: ['candidate'],
      status: 'candidate',
      menu: 'builtin',
      expect: { outcome: 'proposal' },
    };
    appendCaseToCorpus(caseDef, { corpusDir: dir, target: 'candidate' });
    expect(() => appendCaseToCorpus(caseDef, { corpusDir: dir, target: 'candidate' }))
      .toThrow(/already exists/);
    const doc = readCorpusDocument(path.join(dir, 'candidate.json'));
    expect(doc.cases).toHaveLength(1);
  });
});

describe('assertExpectations', () => {
  const { assertExpectations, formatEvalReport, loadCorpusFile, runCase, runCorpusEval } = require('../intentEval');

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

  describe('intent corpus (rules-only)', () => {
    test('builtin.json loads with cases', () => {
      const { meta, cases } = loadCorpusFile(CORPUS_PATH);
      expect(meta.name).toBe('builtin-pilot-phrases');
      expect(cases.length).toBeGreaterThanOrEqual(25);
    });

    test('CI mode: all builtin corpus cases pass without LLM', async () => {
      const report = await runCorpusEval({ mode: 'ci', llm: false });
      if (report.failed > 0) {
        console.error(formatEvalReport(report, { verbose: true }));
      }
      expect(report.failed).toBe(0);
      expect(report.total).toBeGreaterThanOrEqual(25);
    });

    test('restaurants/enes/pilot.json passes on menu fixture without LLM', async () => {
      const report = await runCorpusEval({ mode: 'enes', llm: false });
      if (report.failed > 0) {
        console.error(formatEvalReport(report, { verbose: true, label: 'enes-pilot' }));
      }
      expect(report.failed).toBe(0);
      expect(report.total).toBeGreaterThanOrEqual(10);
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
});

describe('intent:record integration', () => {
  test('record then verify passes for known phrase', async () => {
    const result = await evaluateIntent('2x Cola', { menu: BUILTIN_MENU, llm: false });
    const caseDef = buildRecordedCase(result, {
      text: '2x Cola',
      id: 'record-integration-cola',
      status: 'candidate',
      tags: ['drink'],
    });
    const { runCase } = require('../intentEval');
    const run = await runCase(caseDef, { llm: false });
    expect(run.pass).toBe(true);
  });
});

describe('promoteCase', () => {
  const {
    promoteCase,
    readCorpusDocument,
    sanitizeCaseForShipped,
    writeCorpusDocument,
  } = require('../intentEval');

  test('sanitizeCaseForShipped strips candidate metadata', () => {
    const shipped = sanitizeCaseForShipped({
      id: 'x',
      text: 'cola',
      status: 'candidate',
      tags: ['candidate', 'drink'],
      recordedFrom: 'builtin',
      expect: { outcome: 'proposal' },
    });
    expect(shipped.status).toBeUndefined();
    expect(shipped.recordedFrom).toBeUndefined();
    expect(shipped.tags).toEqual(['drink']);
  });

  test('moves passing case from candidate to builtin in temp dir', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-promote-'));
    const candidatePath = path.join(dir, 'candidate.json');
    const builtinPath = path.join(dir, 'builtin.json');
    const caseDef = {
      id: 'promote-test-cola',
      text: '2x Cola',
      tags: ['candidate', 'drink'],
      status: 'candidate',
      menu: 'builtin',
      expect: {
        outcome: 'proposal',
        parsedBy: 'rules',
        matchedNames: ['Cola'],
      },
    };
    writeCorpusDocument(candidatePath, {
      version: 1,
      name: 'candidates',
      cases: [caseDef],
    });
    writeCorpusDocument(builtinPath, {
      version: 1,
      name: 'builtin',
      cases: [],
    });

    const result = await promoteCase('promote-test-cola', { corpusDir: dir });
    expect(result.builtinTotal).toBe(1);
    expect(result.candidateRemaining).toBe(0);

    const builtin = readCorpusDocument(builtinPath);
    const candidate = readCorpusDocument(candidatePath);
    expect(builtin.cases).toHaveLength(1);
    expect(builtin.cases[0].status).toBeUndefined();
    expect(builtin.cases[0].tags).toEqual(['drink']);
    expect(candidate.cases).toHaveLength(0);
  });

  test('rejects promote when eval fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-promote-fail-'));
    writeCorpusDocument(path.join(dir, 'candidate.json'), {
      version: 1,
      name: 'candidates',
      cases: [{
        id: 'bad-case',
        text: '2x Cola',
        status: 'candidate',
        menu: 'builtin',
        expect: { outcome: 'no_match' },
      }],
    });
    writeCorpusDocument(path.join(dir, 'builtin.json'), { version: 1, name: 'builtin', cases: [] });

    await expect(promoteCase('bad-case', { corpusDir: dir })).rejects.toThrow(/does not pass eval/);
  });
});

describe('shipIntentCase', () => {
  const { shipIntentCase, readCorpusDocument, writeCorpusDocument } = require('../intentEval');

  test('ships new passing case end-to-end in temp dir', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-ship-'));
    writeCorpusDocument(path.join(dir, 'candidate.json'), {
      version: 1,
      name: 'candidates',
      cases: [],
    });
    writeCorpusDocument(path.join(dir, 'builtin.json'), {
      version: 1,
      name: 'builtin',
      cases: [],
    });

    const result = await shipIntentCase(
      { text: '2x Cola' },
      {
        corpusDir: dir,
        evalOptions: { menu: BUILTIN_MENU, llm: false },
      },
    );
    expect(result.status).toBe('shipped');
    expect(readCorpusDocument(path.join(dir, 'candidate.json')).cases).toHaveLength(0);
    expect(readCorpusDocument(path.join(dir, 'builtin.json')).cases).toHaveLength(1);
  });

  test('eval_failed does not promote', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-ship-fail-'));
    writeCorpusDocument(path.join(dir, 'candidate.json'), {
      version: 1,
      name: 'candidates',
      cases: [{
        id: 'ship-fail-case',
        text: 'was empfehlt ihr',
        status: 'candidate',
        menu: 'builtin',
        expect: { outcome: 'proposal', parsedBy: 'rules' },
      }],
    });
    writeCorpusDocument(path.join(dir, 'builtin.json'), { version: 1, name: 'builtin', cases: [] });

    const result = await shipIntentCase(
      { id: 'ship-fail-case' },
      { corpusDir: dir, evalOptions: { menu: BUILTIN_MENU, llm: false } },
    );
    expect(result.status).toBe('eval_failed');
    expect(readCorpusDocument(path.join(dir, 'builtin.json')).cases).toHaveLength(0);
  });

  test('already_shipped when phrase in builtin', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'intent-ship-done-'));
    writeCorpusDocument(path.join(dir, 'candidate.json'), { version: 1, name: 'candidates', cases: [] });
    writeCorpusDocument(path.join(dir, 'builtin.json'), {
      version: 1,
      name: 'builtin',
      cases: [{
        id: 'qty-2x-cola',
        text: '2x Cola',
        menu: 'builtin',
        expect: { outcome: 'proposal', parsedBy: 'rules', matchedNames: ['Cola'] },
      }],
    });

    const result = await shipIntentCase(
      { text: '2x Cola' },
      { corpusDir: dir, evalOptions: { menu: BUILTIN_MENU, llm: false } },
    );
    expect(result.status).toBe('already_shipped');
  });
});
