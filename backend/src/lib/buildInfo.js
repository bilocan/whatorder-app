/**
 * Runtime build/deploy metadata for /health and /version.
 * Cloud Run: set DEPLOY_ENV, GIT_SHA, APP_VERSION at deploy time (CI).
 */
function getBuildInfo() {
  const deployEnv = process.env.DEPLOY_ENV
    ?? (process.env.NODE_ENV === 'production' ? 'unknown' : 'local');

  const gitShaRaw = process.env.GIT_SHA?.trim() || null;
  const gitSha = gitShaRaw ? gitShaRaw.slice(0, 7) : null;

  const appVersion = process.env.APP_VERSION?.trim()
    || (deployEnv === 'local' ? 'local' : null);

  const firebaseProject = process.env.FIREBASE_PROJECT_ID?.trim() || null;

  return {
    environment: deployEnv,
    version: appVersion,
    gitSha,
    firebaseProject,
  };
}

module.exports = { getBuildInfo };
