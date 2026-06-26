const {
  DEFAULT_GOLDEN_INFRA_BACKUP,
  INFRA_COLLECTION_IDS,
  parseResetProductionArgs,
  printResetPlan,
} = require('../firestoreResetProductionLib');

describe('DEFAULT_GOLDEN_INFRA_BACKUP', () => {
  it('is pinned to known golden export', () => {
    expect(DEFAULT_GOLDEN_INFRA_BACKUP).toBe('2026-06-27-in8ra');
  });
});

describe('parseResetProductionArgs', () => {
  const orig = process.env.GOLDEN_INFRA_BACKUP;

  afterEach(() => {
    if (orig === undefined) delete process.env.GOLDEN_INFRA_BACKUP;
    else process.env.GOLDEN_INFRA_BACKUP = orig;
  });

  it('defaults to dry-run off and golden backup folder', () => {
    delete process.env.GOLDEN_INFRA_BACKUP;
    const opts = parseResetProductionArgs(['--confirm']);
    expect(opts.dryRun).toBe(false);
    expect(opts.confirm).toBe(true);
    expect(opts.infraBackup).toBe('2026-06-27-in8ra');
    expect(opts.gcsImportUri).toContain('2026-06-27-in8ra');
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
