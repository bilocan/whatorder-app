/**
 * Lightweight checks for CSV phone normalization helpers used by the batch sender.
 * The script is ops-only; keep these pure so we do not hit Graph API in CI.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '../send-template-batch.js');

function runDry(csvBody, extraArgs = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-batch-'));
  const csvPath = path.join(dir, 'batch.csv');
  fs.writeFileSync(csvPath, csvBody, 'utf8');
  const envPath = path.join(dir, '.env');
  fs.writeFileSync(
    envPath,
    'WHATSAPP_ACCESS_TOKEN=test-token\nWHATSAPP_PHONE_NUMBER_ID=123\n',
    'utf8',
  );
  const result = spawnSync(
    process.execPath,
    [SCRIPT, '--csv', csvPath, '--template', 'whatorder_intro_de', '--env', envPath, ...extraArgs],
    { encoding: 'utf8' },
  );
  return { ...result, dir };
}

describe('send-template-batch', () => {
  test('strips leading 00 international prefix in dry-run', () => {
    const { status, stdout, stderr } = runDry(
      'phone,name\n00905074591757,Haci\n',
    );
    expect(status).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toMatch(/dry-run 1\/1 \*\*\*1757/);
    expect(stdout).not.toMatch(/0090/);
  });

  test('accepts UTF-8 BOM on phone header', () => {
    const { status, stdout } = runDry(
      '\uFEFFphone,name\n+430000000099,Alex\n',
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(/Rows ready: 1/);
    expect(stdout).toMatch(/dry-run 1\/1 \*\*\*0099 params=\["Alex"\]/);
  });

  test('skips repeated header rows', () => {
    const { status, stdout } = runDry(
      'phone,name\n+430000000001,Alex\nphone,name\n+430000000002,Sam\n',
    );
    expect(status).toBe(0);
    expect(stdout).toMatch(/Rows ready: 2/);
    expect(stdout).toMatch(/Alex/);
    expect(stdout).toMatch(/Sam/);
  });
});
