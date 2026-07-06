const {
  DEFAULT_GOLDEN_INFRA_BACKUP,
  MIN_INFRA_BACKUP_BYTES,
  DEFAULT_FIRESTORE_PROJECT,
  FIRESTORE_DATABASE,
  INFRA_COLLECTION_IDS,
  backupsBucketFor,
  buildFirestoreImportArgs,
  parseDuTotalBytes,
  parseResetProductionArgs,
  printResetPlan,
  resolveFirestoreProject,
} = require('../firestoreResetProductionLib');

describe('DEFAULT_GOLDEN_INFRA_BACKUP', () => {
  it('is pinned to known golden export', () => {
    expect(DEFAULT_GOLDEN_INFRA_BACKUP).toBe('2026-07-06-infra');
  });

  it('is not one of the known-empty 2026-06-27 exports', () => {
    expect(DEFAULT_GOLDEN_INFRA_BACKUP).not.toMatch(/^2026-06-27/);
  });
});

describe('parseDuTotalBytes', () => {
  it('parses total from gcloud storage du -s output', () => {
    expect(parseDuTotalBytes('2360123      gs://whatorder-fire-backups/manual/2026-07-06-infra\n')).toBe(2360123);
  });

  it('parses leading-whitespace totals', () => {
    expect(parseDuTotalBytes('   316  gs://bucket/manual/2026-06-27-in8ra')).toBe(316);
  });

  it('throws on unparseable output', () => {
    expect(() => parseDuTotalBytes('')).toThrow(/Could not parse/);
    expect(() => parseDuTotalBytes('gs://no-size-here')).toThrow(/Could not parse/);
  });

  it('empty-export size is below the sanity threshold', () => {
    expect(parseDuTotalBytes('316 gs://bucket/manual/2026-06-27-in8ra')).toBeLessThan(MIN_INFRA_BACKUP_BYTES);
  });
});

describe('environment targeting', () => {
  const origProject = process.env.FIREBASE_PROJECT_ID;

  afterEach(() => {
    if (origProject === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = origProject;
  });

  it('defaults to the Test project', () => {
    delete process.env.FIREBASE_PROJECT_ID;
    expect(resolveFirestoreProject()).toBe(DEFAULT_FIRESTORE_PROJECT);
    expect(DEFAULT_FIRESTORE_PROJECT).toBe('whatorder-fire');
  });

  it('targets the project from FIREBASE_PROJECT_ID', () => {
    process.env.FIREBASE_PROJECT_ID = 'whatorder-fire-prod';
    const opts = parseResetProductionArgs([]);
    expect(opts.project).toBe('whatorder-fire-prod');
    expect(opts.gcsImportUri).toBe(`gs://whatorder-fire-prod-backups/manual/${opts.infraBackup}`);
    expect(buildFirestoreImportArgs(opts)).toContain('--project=whatorder-fire-prod');
  });

  it('derives the backups bucket per project', () => {
    expect(backupsBucketFor('whatorder-fire')).toBe('whatorder-fire-backups');
    expect(backupsBucketFor('whatorder-fire-prod')).toBe('whatorder-fire-prod-backups');
  });
});

describe('parseResetProductionArgs', () => {
  const orig = process.env.GOLDEN_INFRA_BACKUP;
  const origProject = process.env.FIREBASE_PROJECT_ID;

  afterEach(() => {
    if (orig === undefined) delete process.env.GOLDEN_INFRA_BACKUP;
    else process.env.GOLDEN_INFRA_BACKUP = orig;
    if (origProject === undefined) delete process.env.FIREBASE_PROJECT_ID;
    else process.env.FIREBASE_PROJECT_ID = origProject;
  });

  it('defaults to dry-run off and golden backup folder', () => {
    delete process.env.GOLDEN_INFRA_BACKUP;
    delete process.env.FIREBASE_PROJECT_ID;
    const opts = parseResetProductionArgs(['--confirm']);
    expect(opts.dryRun).toBe(false);
    expect(opts.confirm).toBe(true);
    expect(opts.infraBackup).toBe('2026-07-06-infra');
    expect(opts.project).toBe('whatorder-fire');
    expect(opts.gcsImportUri).toBe('gs://whatorder-fire-backups/manual/2026-07-06-infra');
  });

  it('parses custom infra backup', () => {
    const opts = parseResetProductionArgs(['--infra-backup', '2026-06-28-infra']);
    expect(opts.infraBackup).toBe('2026-06-28-infra');
  });

  it('respects GOLDEN_INFRA_BACKUP env', () => {
    process.env.GOLDEN_INFRA_BACKUP = 'custom-folder';
    const opts = parseResetProductionArgs([]);
    expect(opts.infraBackup).toBe('custom-folder');
  });

  it('includes all infra collection groups', () => {
    const opts = parseResetProductionArgs([]);
    expect(opts.collectionIds.split(',')).toEqual(INFRA_COLLECTION_IDS);
  });

  it('supports skip flags', () => {
    const opts = parseResetProductionArgs(['--skip-import', '--skip-smoke']);
    expect(opts.skipImport).toBe(true);
    expect(opts.skipSmoke).toBe(true);
    expect(opts.skipCleanup).toBe(false);
  });
});

describe('printResetPlan', () => {
  it('runs without throwing', () => {
    const opts = parseResetProductionArgs(['--dry-run']);
    expect(() => printResetPlan(opts)).not.toThrow();
  });
});

describe('buildFirestoreImportArgs', () => {
  it('imports full infra-only backup without collection filter', () => {
    const opts = parseResetProductionArgs([]);
    const args = buildFirestoreImportArgs(opts);
    expect(args).toEqual([
      'firestore', 'import', opts.gcsImportUri,
      `--project=${opts.project}`,
      '--database', FIRESTORE_DATABASE,
    ]);
    expect(args.some((a) => a.startsWith('--collection-ids'))).toBe(false);
  });
});
