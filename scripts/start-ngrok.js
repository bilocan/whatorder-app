const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const domain = process.env.NGROK_DOMAIN;
if (!domain) {
  console.error('[ngrok] NGROK_DOMAIN not set');
  process.exit(1);
}

function findNgrok() {
  if (process.env.NGROK_BIN && fs.existsSync(process.env.NGROK_BIN)) {
    return process.env.NGROK_BIN;
  }

  const isWin = process.platform === 'win32';
  const lookupCmd = isWin ? 'where ngrok' : 'command -v ngrok';
  try {
    const found = execSync(lookupCmd, { encoding: 'utf8', shell: true })
      .trim()
      .split(/\r?\n/)[0];
    if (found && fs.existsSync(found)) return found;
  } catch (_) {}

  const candidates = isWin
    ? [
        path.join(process.env.LOCALAPPDATA || '', 'ngrok', 'ngrok.exe'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'ngrok', 'ngrok.exe'),
      ]
    : [
        path.join(os.homedir(), '.local', 'bin', 'ngrok'),
        '/usr/local/bin/ngrok',
        '/usr/bin/ngrok',
      ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }

  // Fall back to PATH lookup (original behaviour — works on Windows when ngrok is installed normally)
  return 'ngrok';
}

const ngrok = findNgrok();
const child = spawn(ngrok, ['http', `--url=${domain}`, '3000'], { stdio: 'inherit' });
child.on('error', (err) => {
  console.error(`[ngrok] Failed to start: ${err.message}`);
  if (err.code === 'ENOENT') {
    console.error('[ngrok] ngrok CLI not found. Install from https://ngrok.com/download or set NGROK_BIN.');
  }
  process.exit(1);
});
