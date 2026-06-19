const { execSync } = require('child_process');
try {
  if (process.platform === 'win32') {
    execSync('taskkill /F /IM ngrok.exe', { stdio: 'ignore' });
  } else {
    execSync('pkill -f ngrok', { stdio: 'ignore' });
  }
} catch (_) {}
