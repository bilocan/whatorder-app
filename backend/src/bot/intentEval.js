const fs = require('fs');
const path = require('path');
const { BUILTIN_MENU, evaluateIntent } = require('./intentSandbox');

const DEFAULT_CORPUS_DIR = path.join(__dirname, '../../fixtures/intent-corpus');

function listCorpusFiles(corpusDir = DEFAULT_CORPUS_DIR) {
  if (!fs.existsSync(corpusDir)) return [];
  return fs.readdirSync(corpusDir)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(corpusDir, f));
}

function loadCorpusFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const cases = (raw.cases ?? []).map((c) => ({
    ...c,
    _source: path.basename(filePath),
    _suite: raw.name ?? path.basename(filePath, '.json'),
  }));
  return { meta: raw, cases };
}

function loadAllCases(options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const fileFilter = options.file ? [path.join(corpusDir, options.file)] : listCorpusFiles(corpusDir);
  const tagFilter = options.tag ? String(options.tag).toLowerCase() : null;

  const suites = fileFilter.map(loadCorpusFile);
  let cases = suites.flatMap(s => s.cases);
  if (tagFilter) {
    cases = cases.filter(c => (c.tags ?? []).some(t => String(t).toLowerCase() === tagFilter));
  }
  return { suites, cases };
}

function resolveMenu(caseDef, corpusDir = DEFAULT_CORPUS_DIR) {
  const menuRef = caseDef.menu ?? 'builtin';
  if (menuRef === 'builtin') return BUILTIN_MENU;
  const menuPath = path.isAbsolute(menuRef)
    ? menuRef
    : path.join(corpusDir, menuRef);
  const items = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
  if (!Array.isArray(items)) {
    throw new Error(`Menu file must be a JSON array: ${menuPath}`);
  }
  return items;
}

function matchedNames(result) {
  return (result.matched ?? []).map(m => m.name);
}

function compareIntentItems(actual, expected) {
  const failures = [];
  if (!Array.isArray(expected)) return failures;
  if (!actual || actual.length !== expected.length) {
    failures.push(`intent items length: expected ${expected.length}, got ${actual?.length ?? 0}`);
    return failures;
  }
  for (let i = 0; i < expected.length; i += 1) {
    const exp = expected[i];
    const got = actual[i];
    if (exp.name != null && exp.name !== got.name) {
      failures.push(`intent[${i}].name: expected "${exp.name}", got "${got.name}"`);
    }
    if (exp.qty != null && exp.qty !== got.qty) {
      failures.push(`intent[${i}].qty: expected ${exp.qty}, got ${got.qty}`);
    }
  }
  return failures;
}

function assertExpectations(result, expect = {}) {
  const failures = [];

  if (expect.orderLike != null && result.orderLike !== expect.orderLike) {
    failures.push(`orderLike: expected ${expect.orderLike}, got ${result.orderLike}`);
  }
  if (expect.outcome != null && result.outcome !== expect.outcome) {
    failures.push(`outcome: expected ${expect.outcome}, got ${result.outcome}`);
  }
  if (expect.parsedBy != null) {
    const got = result.intent?.parsedBy ?? null;
    if (got !== expect.parsedBy) {
      failures.push(`parsedBy: expected ${expect.parsedBy}, got ${got}`);
    }
  }
  if (expect.intentItems != null) {
    failures.push(...compareIntentItems(result.intent?.items, expect.intentItems));
  }
  if (expect.intentItemNames != null) {
    const names = (result.intent?.items ?? []).map(i => i.name);
    const exp = expect.intentItemNames;
    if (names.length !== exp.length || exp.some((n, i) => n !== names[i])) {
      failures.push(`intentItemNames: expected ${JSON.stringify(exp)}, got ${JSON.stringify(names)}`);
    }
  }
  if (expect.matchedCount != null) {
    const count = result.matched?.length ?? 0;
    if (count !== expect.matchedCount) {
      failures.push(`matchedCount: expected ${expect.matchedCount}, got ${count}`);
    }
  }
  if (expect.matchedQtySum != null) {
    const sum = (result.matched ?? []).reduce((n, m) => n + (m.qty ?? 1), 0);
    if (sum !== expect.matchedQtySum) {
      failures.push(`matchedQtySum: expected ${expect.matchedQtySum}, got ${sum}`);
    }
  }
  if (expect.matchedContains != null) {
    const names = matchedNames(result).join(' ').toLowerCase();
    for (const needle of expect.matchedContains) {
      if (!names.includes(String(needle).toLowerCase())) {
        failures.push(`matchedContains: no match line contains "${needle}" (got: ${matchedNames(result).join(', ')})`);
      }
    }
  }
  if (expect.matchedNames != null) {
    const names = matchedNames(result);
    const exp = expect.matchedNames;
    if (names.length !== exp.length || exp.some((n, i) => n !== names[i])) {
      failures.push(`matchedNames: expected ${JSON.stringify(exp)}, got ${JSON.stringify(names)}`);
    }
  }
  if (expect.unmatched != null) {
    const got = result.unmatched ?? [];
    for (const name of expect.unmatched) {
      if (!got.includes(name)) {
        failures.push(`unmatched: expected to include "${name}", got ${JSON.stringify(got)}`);
      }
    }
  }
  if (expect.botReplyContains != null) {
    const reply = result.botReply ?? '';
    for (const needle of expect.botReplyContains) {
      if (!reply.toLowerCase().includes(String(needle).toLowerCase())) {
        failures.push(`botReplyContains: missing "${needle}"`);
      }
    }
  }
  if (expect.botReplyNotContains != null) {
    const reply = result.botReply ?? '';
    for (const needle of expect.botReplyNotContains) {
      if (reply.toLowerCase().includes(String(needle).toLowerCase())) {
        failures.push(`botReplyNotContains: should not include "${needle}"`);
      }
    }
  }
  if (expect.botReplyMatches != null) {
    const reply = result.botReply ?? '';
    const re = new RegExp(expect.botReplyMatches, 'i');
    if (!re.test(reply)) {
      failures.push(`botReplyMatches: pattern /${expect.botReplyMatches}/i did not match reply`);
    }
  }

  return failures;
}

async function runCase(caseDef, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const llmDefault = options.llm ?? false;
  const menu = resolveMenu(caseDef, corpusDir);
  const result = await evaluateIntent(caseDef.text, {
    menu,
    lang: caseDef.lang ?? 'de',
    basket: caseDef.basket ?? [],
    llm: caseDef.llm ?? llmDefault,
    businessId: caseDef.businessId ?? null,
  });
  const failures = assertExpectations(result, caseDef.expect ?? {});
  return {
    id: caseDef.id,
    text: caseDef.text,
    tags: caseDef.tags ?? [],
    suite: caseDef._suite,
    source: caseDef._source,
    result,
    failures,
    pass: failures.length === 0,
  };
}

async function runCorpusEval(options = {}) {
  const { cases } = loadAllCases(options);
  const runs = await Promise.all(cases.map(c => runCase(c, options)));
  const passed = runs.filter(r => r.pass);
  const failed = runs.filter(r => !r.pass);
  return {
    total: runs.length,
    passed: passed.length,
    failed: failed.length,
    runs,
    failures: failed,
  };
}

function formatEvalReport(report, { verbose = false } = {}) {
  const lines = [];
  lines.push(`Intent corpus: ${report.passed}/${report.total} passed`);
  if (report.failed > 0) {
    lines.push('');
    for (const run of report.failures) {
      lines.push(`FAIL [${run.id}] ${run.text.slice(0, 72)}${run.text.length > 72 ? '…' : ''}`);
      for (const f of run.failures) {
        lines.push(`  • ${f}`);
      }
      if (verbose) {
        lines.push(`  outcome: ${run.result.outcome}, parsedBy: ${run.result.intent?.parsedBy ?? '—'}`);
        lines.push(`  matched: ${matchedNames(run.result).join(', ') || '—'}`);
      }
    }
  } else if (verbose) {
    for (const run of report.runs) {
      lines.push(`OK   [${run.id}] ${run.outcome ?? run.result.outcome}`);
    }
  }
  return lines.join('\n');
}

module.exports = {
  DEFAULT_CORPUS_DIR,
  assertExpectations,
  formatEvalReport,
  loadAllCases,
  loadCorpusFile,
  runCase,
  runCorpusEval,
};
