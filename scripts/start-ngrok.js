const { spawn } = require('child_process');
const domain = process.env.NGROK_DOMAIN;
if (!domain) { console.error('[ngrok] NGROK_DOMAIN not set'); process.exit(1); }
spawn('ngrok', ['http', `--url=${domain}`, '3000'], { stdio: 'inherit' });
