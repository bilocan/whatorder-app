const fs = require('fs');
const path = require('path');
const { BUILTIN_MENU, evaluateIntent } = require('./intentSandbox');
const { buildMenuMatchIndex } = require('./menuMapper');
const { buildMenuTokenIndex } = require('./menuTokenIndex');
const {
  CANDIDATE_CORPUS_FILE,
  CI_CORPUS_FILE,
  DEFAULT_CORPUS_DIR,
  ENES_PILOT_CORPUS_FILE,
  corpusFilePath,
  resolveCorpusFileRef,
  restaurantPilotPath,
} = require('./corpusLayout');

function listCorpusFiles(corpusDir = DEFAULT_CORPUS_DIR) {
  if (!fs.existsSync(corpusDir)) return [];
  return fs.readdirSync(corpusDir)
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(corpusDir, f));
}

function isCandidateCase(caseDef) {
  return caseDef.status === 'candidate';
}

function filterCasesByMode(cases, mode) {
  if (mode === 'candidate') {
    return cases.filter(isCandidateCase);
  }
  if (mode === 'ci' || mode === 'shipped') {
    return cases.filter(c => !isCandidateCase(c));
  }
  return cases;
}

function loadCorpusFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const suiteMeta = {
    menu: raw.menu ?? null,
    menuMatch: raw.menuMatch ?? null,
    businessId: raw.businessId ?? null,
  };
  const corpusBaseDir = path.dirname(filePath);
  const cases = (raw.cases ?? []).map((c) => ({
    ...c,
    _source: path.basename(filePath),
    _suite: raw.name ?? path.basename(filePath, '.json'),
    _suiteMeta: suiteMeta,
    _corpusBaseDir: corpusBaseDir,
  }));
  return { meta: raw, suiteMeta, cases, filePath };
}

function loadAllCases(options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const mode = options.mode ?? (options.candidate ? 'candidate' : 'shipped');
  let fileFilter;

  if (options.file) {
    fileFilter = [resolveCorpusFileRef(options.file, corpusDir)];
  } else if (options.restaurant) {
    fileFilter = [restaurantPilotPath(options.restaurant, corpusDir)];
  } else if (mode === 'ci') {
    fileFilter = [path.join(corpusDir, CI_CORPUS_FILE)];
  } else if (mode === 'enes') {
    fileFilter = [restaurantPilotPath('enes', corpusDir)];
  } else if (mode === 'candidate') {
    fileFilter = [path.join(corpusDir, CANDIDATE_CORPUS_FILE)];
  } else {
    fileFilter = listCorpusFiles(corpusDir);
  }

  const tagFilter = options.tag ? String(options.tag).toLowerCase() : null;

  const suites = fileFilter
    .filter(f => fs.existsSync(f))
    .map(loadCorpusFile);
  let cases = suites.flatMap(s => s.cases);
  cases = filterCasesByMode(cases, mode === 'all' ? 'all' : mode);

  if (tagFilter) {
    cases = cases.filter(c => (c.tags ?? []).some(t => String(t).toLowerCase() === tagFilter));
  }
  return { suites, cases };
}

function resolveFixturePath(ref, corpusDir = DEFAULT_CORPUS_DIR, baseDir = null) {
  if (!ref || ref === 'builtin') return null;
  if (path.isAbsolute(ref)) return ref;
  if (baseDir) {
    const local = path.join(baseDir, ref);
    if (fs.existsSync(local)) return local;
  }
  return path.join(corpusDir, ref);
}

function loadFixtureJson(ref, corpusDir = DEFAULT_CORPUS_DIR, baseDir = null) {
  const fixturePath = resolveFixturePath(ref, corpusDir, baseDir);
  if (!fixturePath) return null;
  return JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
}

function resolveMenu(caseDef, corpusDir = DEFAULT_CORPUS_DIR) {
  const baseDir = caseDef._corpusBaseDir ?? null;
  const suiteMenu = caseDef._suiteMeta?.menu;
  const menuRef = caseDef.menu ?? suiteMenu ?? 'builtin';
  if (menuRef === 'builtin') return BUILTIN_MENU;
  const items = loadFixtureJson(menuRef, corpusDir, baseDir);
  if (!Array.isArray(items)) {
    throw new Error(`Menu file must be a JSON array: ${resolveFixturePath(menuRef, corpusDir, baseDir)}`);
  }
  return items;
}

function resolveMenuMatch(caseDef, menu, corpusDir = DEFAULT_CORPUS_DIR) {
  const baseDir = caseDef._corpusBaseDir ?? null;
  const suiteMatch = caseDef._suiteMeta?.menuMatch;
  const matchRef = caseDef.menuMatch ?? suiteMatch;
  if (!matchRef) return buildMenuMatchIndex(menu);
  const stored = loadFixtureJson(matchRef, corpusDir, baseDir);
  if (!stored || typeof stored !== 'object') {
    throw new Error(`menuMatch file must be a JSON object: ${resolveFixturePath(matchRef, corpusDir, baseDir)}`);
  }
  return buildMenuMatchIndex(menu, stored);
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
  if (expect.parsePath != null && result.parsePath !== expect.parsePath) {
    failures.push(`parsePath: expected ${expect.parsePath}, got ${result.parsePath ?? '—'}`);
  }
  if (expect.appliedCount != null) {
    const count = result.appliedPreview?.applied?.length ?? 0;
    if (count !== expect.appliedCount) {
      failures.push(`appliedCount: expected ${expect.appliedCount}, got ${count}`);
    }
  }
  if (expect.rejectedCount != null) {
    const count = result.appliedPreview?.rejected?.length ?? 0;
    if (count !== expect.rejectedCount) {
      failures.push(`rejectedCount: expected ${expect.rejectedCount}, got ${count}`);
    }
  }
  if (expect.basketAfterNames != null) {
    const names = (result.basketAfter ?? []).map(line => line.name);
    const exp = expect.basketAfterNames;
    if (names.length !== exp.length || exp.some((n, i) => n !== names[i])) {
      failures.push(`basketAfterNames: expected ${JSON.stringify(exp)}, got ${JSON.stringify(names)}`);
    }
  }
  if (expect.basketLineQty != null) {
    const { fragment, qty } = expect.basketLineQty;
    const line = (result.basketAfter ?? []).find(l =>
      l.name.toLowerCase().includes(String(fragment).toLowerCase()));
    if (!line) {
      failures.push(`basketLineQty: no line contains "${fragment}"`);
    } else if (line.qty !== qty) {
      failures.push(`basketLineQty: expected ${qty} for "${fragment}", got ${line.qty}`);
    }
  }

  return failures;
}

async function runCase(caseDef, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const llmDefault = options.llm ?? false;
  const menu = resolveMenu(caseDef, corpusDir);
  const menuMatch = resolveMenuMatch(caseDef, menu, corpusDir);
  const menuTokenIndex = buildMenuTokenIndex(menu);
  const businessId = caseDef.businessId ?? caseDef._suiteMeta?.businessId ?? null;
  const basket = caseDef.basket ?? [];
  const tagBasketEdit = (caseDef.tags ?? []).includes('basket_edit');
  const useBasketOps = options.basketOps ?? (
    caseDef.expect?.outcome === 'basket_ops' || tagBasketEdit
  );
  const result = await evaluateIntent(caseDef.text, {
    menu,
    menuMatch,
    menuTokenIndex,
    lang: caseDef.lang ?? 'de',
    basket,
    basketOps: useBasketOps,
    llm: caseDef.llm ?? llmDefault,
    businessId,
    skipLearned: caseDef.useLearned !== true,
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
  const mode = options.mode ?? (options.candidate ? 'candidate' : 'shipped');
  const { cases } = loadAllCases({ ...options, mode });
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

function formatEvalReport(report, { verbose = false, label = null } = {}) {
  const lines = [];
  const prefix = label ? `${label}: ` : '';
  lines.push(`${prefix}Intent corpus: ${report.passed}/${report.total} passed`);
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

function slugifyCaseId(text, existingIds = new Set()) {
  let base = String(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  if (!base) base = 'case';
  let id = base;
  let n = 2;
  while (existingIds.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  return id;
}

/** Snapshot evaluateIntent output into an expect block (current behavior, not desired). */
/**
 * Re-snapshot expect blocks for every case in a corpus file (e.g. after menu re-export).
 * Preserves case id, text, tags, and suite metadata; only updates expect from current parser output.
 */
async function refreshCorpusExpects(corpusFile, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const filePath = resolveCorpusFileRef(corpusFile, corpusDir);
  const doc = readCorpusDocument(filePath);
  const corpusBaseDir = path.dirname(filePath);
  const suiteMeta = {
    menu: doc.menu ?? null,
    menuMatch: doc.menuMatch ?? null,
    businessId: doc.businessId ?? null,
  };

  const refreshed = [];
  for (const c of doc.cases) {
    const caseDef = {
      ...c,
      _suiteMeta: suiteMeta,
      _corpusBaseDir: corpusBaseDir,
      _source: path.basename(filePath),
      _suite: doc.name ?? path.basename(filePath, '.json'),
    };
    const run = await runCase(caseDef, { corpusDir, llm: options.llm ?? false });
    c.expect = recordExpectFromResult(run.result);
    refreshed.push({ id: c.id, outcome: run.result.outcome, pass: run.pass });
  }

  if (!options.dryRun) {
    writeCorpusDocument(filePath, doc);
  }

  return { filePath, doc, refreshed };
}

function recordExpectFromResult(result) {
  const expect = {
    orderLike: result.orderLike,
    outcome: result.outcome,
  };

  if (result.intent?.parsedBy) {
    expect.parsedBy = result.intent.parsedBy;
  }
  if (result.intent?.items?.length) {
    expect.intentItems = result.intent.items.map(i => ({
      name: i.name,
      qty: i.qty ?? 1,
    }));
  }
  if (result.matched?.length) {
    expect.matchedNames = matchedNames(result);
    expect.matchedCount = result.matched.length;
    const qtySum = result.matched.reduce((n, m) => n + (m.qty ?? 1), 0);
    if (qtySum !== result.matched.length) {
      expect.matchedQtySum = qtySum;
    }
  }
  if (result.unmatched?.length) {
    expect.unmatched = [...result.unmatched];
  }

  return expect;
}

function buildRecordedCase(result, options = {}) {
  const {
    text,
    id = null,
    tags = [],
    status = 'candidate',
    menu = 'builtin',
    lang = 'de',
    basket = [],
    notes = null,
    source = 'record',
    existingIds = new Set(),
  } = options;

  const caseId = id ?? slugifyCaseId(text, existingIds);
  const caseDef = {
    id: caseId,
    text,
    tags: status === 'candidate' ? ['candidate', ...tags.filter(t => t !== 'candidate')] : tags,
    menu,
    expect: recordExpectFromResult(result),
  };

  if (status === 'candidate') {
    caseDef.status = 'candidate';
  }
  if (lang !== 'de') caseDef.lang = lang;
  if (basket?.length) caseDef.basket = basket;
  if (notes) caseDef.notes = notes;
  if (source) caseDef.recordedFrom = source;

  return caseDef;
}

function readCorpusDocument(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      version: 1,
      name: path.basename(filePath, '.json'),
      description: '',
      cases: [],
    };
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeCorpusDocument(filePath, doc) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

function appendCaseToCorpus(caseDef, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const target = options.target ?? 'candidate';
  const filePath = corpusFilePath(target, corpusDir);
  const doc = readCorpusDocument(filePath);

  const dupId = doc.cases.find(c => c.id === caseDef.id);
  if (dupId) {
    throw new Error(`Case id "${caseDef.id}" already exists in ${path.basename(filePath)}`);
  }
  const dupText = doc.cases.find(c => c.text === caseDef.text);
  if (dupText) {
    throw new Error(`Phrase already recorded as "${dupText.id}" in ${path.basename(filePath)}`);
  }

  doc.cases.push(caseDef);
  writeCorpusDocument(filePath, doc);
  return { filePath, caseDef, total: doc.cases.length };
}

async function recordIntentCase(text, evalOptions = {}, recordOptions = {}) {
  const result = await evaluateIntent(text, evalOptions);
  const corpusDir = recordOptions.corpusDir ?? DEFAULT_CORPUS_DIR;
  const target = recordOptions.target ?? 'candidate';
  const filePath = corpusFilePath(target, corpusDir);
  const doc = readCorpusDocument(filePath);
  const existingIds = new Set(doc.cases.map(c => c.id));

  const caseDef = buildRecordedCase(result, {
    text,
    ...recordOptions,
    existingIds,
  });

  return { result, caseDef };
}

const CANDIDATE_ONLY_FIELDS = ['status', 'recordedFrom'];

function sanitizeCaseForShipped(caseDef) {
  const shipped = { ...caseDef };
  for (const key of CANDIDATE_ONLY_FIELDS) {
    delete shipped[key];
  }
  if (shipped.tags) {
    shipped.tags = shipped.tags.filter(t => t !== 'candidate');
    if (!shipped.tags.length) delete shipped.tags;
  }
  return shipped;
}

function findCaseInDocument(doc, caseId) {
  const index = doc.cases.findIndex(c => c.id === caseId);
  if (index < 0) return null;
  return { caseDef: doc.cases[index], index };
}

function findCaseByText(doc, text) {
  const trimmed = String(text ?? '').trim();
  const index = doc.cases.findIndex(c => c.text === trimmed);
  if (index < 0) return null;
  return { caseDef: doc.cases[index], index };
}

function findShippedCase({ text, id, corpusDir = DEFAULT_CORPUS_DIR }) {
  const builtinDoc = readCorpusDocument(corpusFilePath('builtin', corpusDir));
  if (id) {
    const found = findCaseInDocument(builtinDoc, id);
    if (found) return found.caseDef;
  }
  if (text) {
    const found = findCaseByText(builtinDoc, text);
    if (found) return found.caseDef;
  }
  return null;
}

/**
 * End-to-end: ensure candidate exists → eval → promote → CI verify.
 * Idempotent: re-run same phrase after fixing expect/parser; skips if already in builtin.
 */
async function shipIntentCase(input, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const text = input.text?.trim() || null;
  const caseId = input.id || null;

  if (!text && !caseId) {
    throw new Error('shipIntentCase requires text or id');
  }

  const shipped = findShippedCase({ text, id: caseId, corpusDir });
  if (shipped) {
    const verifyRun = await runCase(shipped, { corpusDir, llm: options.llm ?? false });
    const ciReport = await runCorpusEval({ mode: 'ci', corpusDir, llm: false });
    return {
      status: verifyRun.pass && ciReport.failed === 0 ? 'already_shipped' : 'shipped_regression',
      caseId: shipped.id,
      caseDef: shipped,
      verifyRun,
      ciReport,
    };
  }

  const candidatePath = corpusFilePath('candidate', corpusDir);
  const candidateDoc = readCorpusDocument(candidatePath);
  let caseDef = null;
  let recorded = false;

  if (caseId) {
    const found = findCaseInDocument(candidateDoc, caseId);
    if (found) caseDef = found.caseDef;
  }
  if (!caseDef && text) {
    const found = findCaseByText(candidateDoc, text);
    if (found) caseDef = found.caseDef;
  }

  if (!caseDef) {
    if (!text) {
      throw new Error(`Case "${caseId}" not found in ${CANDIDATE_CORPUS_FILE}`);
    }
    const { caseDef: newCase } = await recordIntentCase(text, options.evalOptions ?? {}, {
      id: caseId ?? undefined,
      tags: options.tags ?? [],
      notes: options.notes ?? null,
      menu: options.menuRef ?? 'builtin',
      lang: options.lang ?? 'de',
      source: options.source ?? 'ship',
      corpusDir,
    });
    caseDef = newCase;
    if (!options.dryRun) {
      appendCaseToCorpus(caseDef, { corpusDir, target: 'candidate' });
    }
    recorded = true;
  }

  const verifyRun = await runCase(caseDef, { corpusDir, llm: options.llm ?? false });
  if (!verifyRun.pass) {
    return {
      status: 'eval_failed',
      caseId: caseDef.id,
      caseDef,
      verifyRun,
      recorded,
    };
  }

  if (options.dryRun) {
    const dryPromote = await promoteCase(caseDef.id, { corpusDir, dryRun: true });
    return {
      status: 'dry_run',
      caseId: caseDef.id,
      caseDef,
      verifyRun,
      recorded,
      dryPromote,
    };
  }

  const promoteResult = await promoteCase(caseDef.id, { corpusDir });
  const ciReport = await runCorpusEval({ mode: 'ci', corpusDir, llm: false });
  if (ciReport.failed > 0) {
    return {
      status: 'ci_failed',
      caseId: caseDef.id,
      promoteResult,
      ciReport,
    };
  }

  return {
    status: 'shipped',
    caseId: caseDef.id,
    recorded,
    promoteResult,
    ciReport,
  };
}

/**
 * Move a passing candidate case into builtin.json (CI corpus).
 * Throws if case missing, duplicate in builtin, or eval fails (unless skipVerify).
 */
async function promoteCase(caseId, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const candidatePath = corpusFilePath('candidate', corpusDir);
  const builtinPath = corpusFilePath('builtin', corpusDir);
  const candidateDoc = readCorpusDocument(candidatePath);
  const builtinDoc = readCorpusDocument(builtinPath);

  const found = findCaseInDocument(candidateDoc, caseId);
  if (!found) {
    throw new Error(`Case "${caseId}" not found in ${CANDIDATE_CORPUS_FILE}`);
  }

  const { caseDef } = found;
  let verifyRun = null;
  if (!options.skipVerify) {
    verifyRun = await runCase(caseDef, { corpusDir, llm: false });
    if (!verifyRun.pass) {
      const err = new Error(`Case "${caseId}" does not pass eval — fix expect or parser before promote`);
      err.failures = verifyRun.failures;
      throw err;
    }
  }

  const shipped = sanitizeCaseForShipped(caseDef);
  if (builtinDoc.cases.some(c => c.id === shipped.id)) {
    throw new Error(`Case id "${shipped.id}" already exists in ${CI_CORPUS_FILE}`);
  }
  if (builtinDoc.cases.some(c => c.text === shipped.text)) {
    throw new Error(`Phrase already in ${CI_CORPUS_FILE}`);
  }

  if (options.dryRun) {
    return {
      dryRun: true,
      caseId,
      shipped,
      candidatePath,
      builtinPath,
      verifyRun,
    };
  }

  builtinDoc.cases.push(shipped);
  candidateDoc.cases.splice(found.index, 1);
  writeCorpusDocument(builtinPath, builtinDoc);
  writeCorpusDocument(candidatePath, candidateDoc);

  return {
    caseId,
    shipped,
    candidatePath,
    builtinPath,
    candidateRemaining: candidateDoc.cases.length,
    builtinTotal: builtinDoc.cases.length,
    verifyRun,
  };
}

/** Promote every candidate case that passes eval. Returns per-case results. */
async function promoteAllCases(options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const candidatePath = corpusFilePath('candidate', corpusDir);
  const candidateDoc = readCorpusDocument(candidatePath);
  const ids = candidateDoc.cases.map(c => c.id);

  const results = [];
  for (const id of ids) {
    try {
      const result = await promoteCase(id, { ...options, corpusDir });
      results.push({ id, ok: true, result });
    } catch (err) {
      results.push({ id, ok: false, error: err.message, failures: err.failures });
      if (!options.continueOnError) break;
    }
  }
  return results;
}

module.exports = {
  CI_CORPUS_FILE,
  ENES_PILOT_CORPUS_FILE,
  CANDIDATE_CORPUS_FILE,
  DEFAULT_CORPUS_DIR,
  appendCaseToCorpus,
  assertExpectations,
  buildRecordedCase,
  corpusFilePath,
  findCaseByText,
  findShippedCase,
  formatEvalReport,
  isCandidateCase,
  loadAllCases,
  loadCorpusFile,
  loadFixtureJson,
  promoteAllCases,
  promoteCase,
  readCorpusDocument,
  refreshCorpusExpects,
  recordExpectFromResult,
  recordIntentCase,
  resolveFixturePath,
  resolveMenu,
  resolveMenuMatch,
  runCase,
  runCorpusEval,
  sanitizeCaseForShipped,
  shipIntentCase,
  slugifyCaseId,
  writeCorpusDocument,
};
