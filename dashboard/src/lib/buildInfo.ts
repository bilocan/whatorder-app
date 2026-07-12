export type DeployEnv = 'local' | 'test' | 'production' | 'unknown';

export type BuildInfo = {
  environment: DeployEnv;
  version: string;
  gitSha: string | null;
  firebaseProject: string | null;
};

function readDeployEnv(): DeployEnv {
  const raw = import.meta.env.VITE_DEPLOY_ENV as string | undefined;
  if (raw === 'local' || raw === 'test' || raw === 'production' || raw === 'unknown') {
    return raw;
  }
  if (import.meta.env.DEV) return 'local';
  return 'unknown';
}

function readGitSha(): string | null {
  const raw = (import.meta.env.VITE_GIT_SHA as string | undefined)?.trim();
  if (!raw) return null;
  return raw.slice(0, 7);
}

export function getFrontendBuildInfo(): BuildInfo {
  const environment = readDeployEnv();
  const gitSha = readGitSha();
  const version = (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim()
    || (environment === 'local' ? 'local' : gitSha ? `dev-${gitSha}` : 'unknown');
  const firebaseProject = (import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined)?.trim()
    || null;

  return { environment, version, gitSha, firebaseProject };
}

export function envBadgeColors(env: DeployEnv): { background: string; color: string } {
  switch (env) {
    case 'local':
      return { background: '#fef3c7', color: '#92400e' };
    case 'test':
      return { background: '#ffedd5', color: '#c2410c' };
    case 'production':
      return { background: '#ecfdf5', color: '#047857' };
    default:
      return { background: '#f3f4f6', color: '#4b5563' };
  }
}

export function formatBuildInfoCopyText(info: BuildInfo, backend?: BuildInfo | null): string {
  const lines = [
    `Frontend: ${info.environment} · ${info.version}${info.gitSha ? ` · ${info.gitSha}` : ''}`,
  ];
  if (info.firebaseProject) lines.push(`Firebase: ${info.firebaseProject}`);
  if (backend) {
    lines.push(
      `Backend: ${backend.environment} · ${backend.version ?? '—'}${backend.gitSha ? ` · ${backend.gitSha}` : ''}`,
    );
    if (backend.firebaseProject) lines.push(`Backend Firebase: ${backend.firebaseProject}`);
  }
  return lines.join('\n');
}

export type BackendHealthPayload = BuildInfo & { status?: string; timestamp?: string };

export function healthUrl(): string {
  const base = import.meta.env.DEV
    ? ''
    : ((import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '');
  return `${base}/health`;
}

export function environmentsMismatch(frontend: BuildInfo, backend: BuildInfo): boolean {
  if (frontend.environment === 'unknown' || backend.environment === 'unknown') return false;
  return frontend.environment !== backend.environment;
}
