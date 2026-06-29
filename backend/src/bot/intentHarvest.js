const fs = require('fs');
const path = require('path');
const { evaluateIntent, formatMatchedLineLabel } = require('./intentSandbox');
const { buildMenuTokenIndex } = require('./menuTokenIndex');
const { loadRestaurantMenuFixture } = require('./restaurantCorpus');
const {
  appendCaseToCorpus,
  assertExpectations,
  buildRecordedCase,
  readCorpusDocument,
  recordExpectFromResult,
  runCorpusEval,
  slugifyCaseId,
} = require('./intentEval');
const {
  DEFAULT_CORPUS_DIR,
  restaurantHarvestPath,
  restaurantPhrasesPath,
  restaurantPilotPath,
} = require('./corpusLayout');

const GREEN_OUTCOMES = new Set(['proposal', 'disambiguation', 'remove']);
const GREEN_PARSED_BY = new Set(['rules', 'learned']);

function buildHarvestScaffold(slug, { businessId, restaurantName } = {}) {
  const label = restaurantName || slug;
  return {
    version: 1,
    name: `${slug}-harvest`,
    description: `Owner/TTS/log phrase worksheet for ${label}. Fill phrases[], then: npm run intent:harvest -- --restaurant ${slug}`,
    businessId: businessId ?? null,
    restaurant: slug,
    phrases: [],
  };
}

function parsePhrasesTxt(content) {
  return String(content)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

function normalizePhraseEntry(entry, existingIds, options = {}) {
  const defaultSource = options.defaultSource ?? 'owner';
  if (typeof entry === 'string') {
    const text = entry.trim();
    if (!text) return null;
    return {
      id: slugifyCaseId(text, existingIds),
      text,
      source: defaultSource,
      status: 'pending',
    };
  }
  if (entry && typeof entry === 'object' && entry.text) {
    const text = String(entry.text).trim();
    if (!text) return null;
    const id = entry.id ?? slugifyCaseId(text, existingIds);
    existingIds.add(id);
    return { ...entry, id, text };
  }
  return null;
}

function normalizePhraseList(phrases, options = {}) {
  const existingIds = new Set();
  const out = [];
  for (const entry of phrases ?? []) {
    const row = normalizePhraseEntry(entry, existingIds, options);
    if (row) {
      existingIds.add(row.id);
      out.push(row);
    }
  }
  return out;
}

function businessIdFromPilot(slug, corpusDir = DEFAULT_CORPUS_DIR) {
  const pilotPath = restaurantPilotPath(slug, corpusDir);
  if (!fs.existsSync(pilotPath)) return null;
  const doc = readCorpusDocument(pilotPath);
  return doc.businessId ?? null;
}

function resolveHarvestInput(slug, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const explicit = options.filePath ? path.resolve(options.filePath) : null;

  let inputPath = explicit;
  let format = null;
  if (!inputPath) {
    const txtPath = restaurantPhrasesPath(slug, corpusDir);
    const jsonPath = restaurantHarvestPath(slug, corpusDir);
    if (fs.existsSync(txtPath)) {
      inputPath = txtPath;
      format = 'txt';
    } else if (fs.existsSync(jsonPath)) {
      inputPath = jsonPath;
      format = 'json';
    } else {
      inputPath = txtPath;
      format = 'txt';
    }
  } else if (inputPath.endsWith('.txt')) {
    format = 'txt';
  } else {
    format = 'json';
  }

  if (!fs.existsSync(inputPath)) {
    return { inputPath, format, missing: true, manifest: null };
  }

  if (format === 'txt') {
    const lines = parsePhrasesTxt(fs.readFileSync(inputPath, 'utf8'));
    const manifest = {
      version: 1,
      restaurant: slug,
      businessId: businessIdFromPilot(slug, corpusDir),
      phrases: normalizePhraseList(lines),
      _sourceFile: inputPath,
      _format: 'txt',
    };
    return { inputPath, format: 'txt', missing: false, manifest };
  }

  const doc = loadHarvestManifest(inputPath);
  doc.phrases = normalizePhraseList(doc.phrases);
  doc._sourceFile = inputPath;
  doc._format = 'json';
  if (!doc.businessId) doc.businessId = businessIdFromPilot(slug, corpusDir);
  return { inputPath, format: 'json', missing: false, manifest: doc };
}

function ensurePhrasesTxtScaffold(slug, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const filePath = restaurantPhrasesPath(slug, corpusDir);
  if (fs.existsSync(filePath) && !options.overwrite) {
    return { created: false, path: filePath };
  }
  const sample = `# One phrase per line. Lines starting with # are ignored.
# Owner session — paste exact phrases below:

`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, sample, 'utf8');
  return { created: true, path: filePath };
}

function loadHarvestManifest(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Harvest manifest not found: ${filePath}`);
  }
  const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(doc.phrases)) {
    throw new Error(`Harvest manifest must have phrases[]: ${filePath}`);
  }
  return doc;
}

function writeHarvestManifest(filePath, doc) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
}

function ensureHarvestScaffold(slug, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const filePath = restaurantHarvestPath(slug, corpusDir);
  if (fs.existsSync(filePath) && !options.overwrite) {
    return { created: false, path: filePath, doc: loadHarvestManifest(filePath) };
  }
  const doc = buildHarvestScaffold(slug, {
    businessId: options.businessId,
    restaurantName: options.restaurantName,
  });
  writeHarvestManifest(filePath, doc);
  return { created: true, path: filePath, doc };
}

function matchedNamesFromResult(result) {
  return (result.matched ?? []).map((m) => m.name);
}

function defaultGreenExpect(result) {
  const expect = {
    orderLike: true,
    outcome: result.outcome,
    parsedBy: result.intent?.parsedBy ?? null,
  };
  if (result.matched?.length) {
    expect.matchedNames = matchedNamesFromResult(result);
    expect.matchedCount = result.matched.length;
  }
  return expect;
}

function isDefaultGreen(result, options = {}) {
  const allowLlm = options.allowLlm ?? false;
  if (!result.orderLike) return false;
  if (!GREEN_OUTCOMES.has(result.outcome)) return false;
  const parsedBy = result.intent?.parsedBy ?? null;
  if (!parsedBy) return false;
  if (!allowLlm && parsedBy === 'llm') return false;
  if (!allowLlm && !GREEN_PARSED_BY.has(parsedBy)) return false;
  if (result.outcome === 'proposal' || result.outcome === 'remove') {
    return (result.matched?.length ?? 0) > 0;
  }
  return true;
}

async function evaluateHarvestPhrase(phrase, evalCtx, options = {}) {
  const text = String(phrase.text ?? '').trim();
  if (!text) {
    return {
      id: phrase.id ?? null,
      text: '',
      skipped: true,
      reason: 'empty text',
      pass: false,
    };
  }
  if (phrase.skip === true || phrase.status === 'skip') {
    return {
      id: phrase.id ?? null,
      text,
      skipped: true,
      reason: 'marked skip',
      pass: false,
    };
  }

  const result = await evalCtx.evaluate(text);
  const snapshot = {
    outcome: result.outcome,
    parsedBy: result.intent?.parsedBy ?? null,
    matchedNames: matchedNamesFromResult(result),
    unmatched: result.unmatched ?? [],
  };

  let failures = [];
  if (phrase.expect && typeof phrase.expect === 'object') {
    failures = assertExpectations(result, phrase.expect);
  } else if (!isDefaultGreen(result, options)) {
    failures = [`default green check failed (outcome=${result.outcome}, parsedBy=${snapshot.parsedBy})`];
  }

  return {
    id: phrase.id ?? null,
    text,
    phrase,
    skipped: false,
    pass: failures.length === 0,
    failures,
    result,
    snapshot,
  };
}

function buildEvalContext(slug, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const { menu, menuMatch } = loadRestaurantMenuFixture(slug, corpusDir);
  const menuTokenIndex = buildMenuTokenIndex(menu);
  const businessId = options.businessId ?? null;
  const llm = options.llm ?? false;

  return {
    menu,
    menuMatch,
    evaluate: (text) => evaluateIntent(text, {
      menu,
      menuMatch,
      menuTokenIndex,
      businessId,
      llm,
    }),
  };
}

function phraseAlreadyInPilot(slug, text, corpusDir = DEFAULT_CORPUS_DIR) {
  const pilotPath = restaurantPilotPath(slug, corpusDir);
  if (!fs.existsSync(pilotPath)) return false;
  const doc = readCorpusDocument(pilotPath);
  const trimmed = String(text).trim();
  return doc.cases.some((c) => c.text === trimmed);
}

function formatInteractiveSessionSummary(stats) {
  const lines = [
    '',
    `Session: ${stats.reviewed}/${stats.total} reviewed`,
    `  recorded: ${stats.recorded}`,
  ];
  if (stats.alreadyInPilot) lines.push(`  already in pilot.json: ${stats.alreadyInPilot}`);
  if (stats.skipped) {
    const extra = stats.skippedPassedNew
      ? ` (${stats.skippedPassedNew} passed, not in pilot yet — press r to record)`
      : '';
    lines.push(`  skipped: ${stats.skipped}${extra}`);
  }
  if (stats.quitEarly) lines.push(`  quit early (${stats.remaining} phrase(s) not reviewed)`);
  if (stats.recorded === 0 && stats.skippedPassedNew > 0) {
    lines.push('  tip: re-run -i and press r on phrases you want in pilot.json');
  }
  return lines.join('\n');
}

async function runHarvestBatch(manifest, options = {}) {
  const slug = options.slug ?? manifest.restaurant;
  if (!slug) throw new Error('Harvest manifest needs restaurant slug or pass options.slug');

  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  const evalCtx = buildEvalContext(slug, {
    corpusDir,
    businessId: options.businessId ?? manifest.businessId ?? null,
    llm: options.llm ?? false,
  });

  const runs = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let recorded = 0;
  let candidateRecorded = 0;

  const defaultTags = options.tags ?? [`${slug}_pilot`, 'harvest'];
  const pilotDoc = readCorpusDocument(restaurantPilotPath(slug, corpusDir));
  const existingIds = new Set(pilotDoc.cases.map((c) => c.id));

  for (const phrase of manifest.phrases) {
    const run = await evaluateHarvestPhrase(phrase, evalCtx, options);
    run.phrase = phrase;
    runs.push(run);

    if (run.skipped) {
      skipped += 1;
      if (options.writeManifest) {
        phrase.status = phrase.status === 'skip' ? 'skip' : 'pending';
        phrase.lastRun = { skipped: true, reason: run.reason };
      }
      continue;
    }

    if (run.pass) {
      passed += 1;
      if (options.fillExpect && !phrase.expect) {
        phrase.expect = recordExpectFromResult(run.result);
      }
      if (options.writeManifest) {
        phrase.status = 'pass';
        phrase.lastRun = { ...run.snapshot, pass: true };
      }
      if (options.record && !phraseAlreadyInPilot(slug, run.text, corpusDir)) {
        const tags = [...new Set([...defaultTags, ...(phrase.tags ?? []), phrase.source].filter(Boolean))];
        const caseDef = buildRecordedCase(run.result, {
          text: run.text,
          id: phrase.id ?? null,
          tags,
          status: 'shipped',
          menu: 'menu.json',
          notes: phrase.notes ?? null,
          source: phrase.source ?? 'harvest',
          existingIds,
        });
        appendCaseToCorpus(caseDef, { target: slug, corpusDir });
        existingIds.add(caseDef.id);
        recorded += 1;
        if (options.writeManifest) phrase.status = 'recorded';
      } else if (options.writeManifest && phraseAlreadyInPilot(slug, run.text, corpusDir)) {
        phrase.status = 'recorded';
      }
    } else {
      failed += 1;
      if (options.writeManifest) {
        phrase.status = 'fail';
        phrase.lastRun = { ...run.snapshot, pass: false, failures: run.failures };
      }
      if (options.candidate) {
        const tags = [...new Set(['candidate', 'harvest', ...(phrase.tags ?? []), phrase.source].filter(Boolean))];
        try {
          const caseDef = buildRecordedCase(run.result, {
            text: run.text,
            id: phrase.id ?? null,
            tags,
            status: 'candidate',
            menu: 'menu.json',
            notes: phrase.notes ?? `harvest fail: ${run.failures.join('; ')}`,
            source: phrase.source ?? 'harvest',
            existingIds: new Set(),
          });
          appendCaseToCorpus(caseDef, { target: 'candidate', corpusDir });
          candidateRecorded += 1;
        } catch (err) {
          run.candidateError = err.message;
        }
      }
    }
  }

  if (options.writeManifest && options.manifestPath && manifest._format === 'json') {
    manifest.lastRun = new Date().toISOString();
    writeHarvestManifest(options.manifestPath, manifest);
  } else if (options.writeManifest && manifest._format === 'txt' && manifest._sourceFile) {
    const sidecar = manifest._sourceFile.replace(/\.txt$/i, '.last-run.json');
    writeHarvestManifest(sidecar, {
      lastRun: new Date().toISOString(),
      restaurant: slug,
      source: manifest._sourceFile,
      runs: runs.map((r) => ({
        text: r.text,
        pass: r.pass,
        skipped: r.skipped,
        snapshot: r.snapshot,
        failures: r.failures,
      })),
    });
  }

  let evalReport = null;
  if (options.runEval && recorded > 0) {
    evalReport = await runCorpusEval({ restaurant: slug, corpusDir, llm: false });
  }

  return {
    slug,
    total: manifest.phrases.length,
    passed,
    failed,
    skipped,
    recorded,
    candidateRecorded,
    runs,
    evalReport,
  };
}

function formatHarvestReport(summary, options = {}) {
  const verbose = options.verbose ?? false;
  const lines = [
    `Harvest ${summary.slug}: ${summary.passed} passed, ${summary.failed} failed, ${summary.skipped} skipped (${summary.total} phrases)`,
  ];
  if (summary.recorded) lines.push(`  recorded → pilot.json: ${summary.recorded}`);
  if (summary.candidateRecorded) lines.push(`  recorded → candidate.json: ${summary.candidateRecorded}`);
  if (summary.evalReport) {
    lines.push(`  eval: ${summary.evalReport.passed}/${summary.evalReport.total} passed`);
  }
  lines.push('');
  for (const run of summary.runs) {
    if (verbose && !run.skipped) {
      lines.push(formatPhraseDetail(run));
      continue;
    }
    if (run.skipped) {
      lines.push(`  ⏭ ${run.id || '(no id)'}: "${run.text}" — ${run.reason}`);
      continue;
    }
    const mark = run.pass ? '✓' : '✗';
    const detail = run.pass
      ? `${run.snapshot.outcome}, ${run.snapshot.parsedBy}`
      : run.failures.join('; ');
    lines.push(`  ${mark} ${run.id || '(no id)'}: "${run.text}" — ${detail}`);
    if (run.snapshot.matchedNames?.length) {
      lines.push(`      matched: ${run.snapshot.matchedNames.join(', ')}`);
    }
    if (!run.pass && run.snapshot.unmatched?.length) {
      lines.push(`      unmatched: ${run.snapshot.unmatched.join(', ')}`);
    }
  }
  return lines.join('\n');
}

function formatPhraseDetail(run) {
  if (run.skipped) {
    return `\n"${run.text}"\n  skipped: ${run.reason}`;
  }
  const lines = [`\n"${run.text}"`];
  const mark = run.pass ? 'PASS' : 'FAIL';
  lines.push(`  ${mark} — outcome: ${run.snapshot.outcome}, parsedBy: ${run.snapshot.parsedBy ?? '—'}`);
  const matched = run.result?.matched ?? [];
  if (matched.length) {
    for (const m of matched) {
      const label = formatMatchedLineLabel(m);
      lines.push(`  • ${m.qty > 1 ? `${m.qty}× ` : ''}${label}`);
    }
  } else if (run.snapshot.outcome === 'disambiguation') {
    lines.push('  • (disambiguation list — no single SKU yet)');
  }
  if (run.snapshot.unmatched?.length) {
    lines.push(`  unmatched tokens: ${run.snapshot.unmatched.join(', ')}`);
  }
  if (!run.pass) {
    lines.push(`  why: ${run.failures.join('; ')}`);
    lines.push('  fix: parser/aliases, edit phrases.txt, or interactive [r] to record as-is');
  }
  return lines.join('\n');
}

async function recordSinglePhrase(run, slug, options = {}) {
  const corpusDir = options.corpusDir ?? DEFAULT_CORPUS_DIR;
  if (phraseAlreadyInPilot(slug, run.text, corpusDir)) {
    return { recorded: false, reason: 'already in pilot.json' };
  }
  const pilotDoc = readCorpusDocument(restaurantPilotPath(slug, corpusDir));
  const existingIds = new Set(pilotDoc.cases.map((c) => c.id));
  const tags = [...new Set([...(options.tags ?? [`${slug}_pilot`, 'harvest']), ...(run.phrase?.tags ?? []), run.phrase?.source].filter(Boolean))];
  const caseDef = buildRecordedCase(run.result, {
    text: run.text,
    id: run.id ?? null,
    tags,
    status: 'shipped',
    menu: 'menu.json',
    notes: run.phrase?.notes ?? null,
    source: run.phrase?.source ?? 'harvest',
    existingIds,
  });
  appendCaseToCorpus(caseDef, { target: slug, corpusDir });
  return { recorded: true, caseId: caseDef.id };
}

module.exports = {
  buildHarvestScaffold,
  buildEvalContext,
  defaultGreenExpect,
  ensureHarvestScaffold,
  ensurePhrasesTxtScaffold,
  evaluateHarvestPhrase,
  formatHarvestReport,
  formatPhraseDetail,
  isDefaultGreen,
  loadHarvestManifest,
  normalizePhraseList,
  parsePhrasesTxt,
  recordSinglePhrase,
  resolveHarvestInput,
  runHarvestBatch,
  writeHarvestManifest,
  phraseAlreadyInPilot,
  formatInteractiveSessionSummary,
};
