import { describe, it, expect } from 'vitest';
import {
  envBadgeColors,
  environmentsMismatch,
  formatBuildInfoCopyText,
  getFrontendBuildInfo,
} from '../buildInfo';

describe('getFrontendBuildInfo', () => {
  it('returns local defaults in dev when VITE vars are unset', () => {
    const info = getFrontendBuildInfo();
    expect(info.environment).toBe('local');
    expect(info.version).toBe('local');
  });
});

describe('envBadgeColors', () => {
  it('maps test to amber styling', () => {
    expect(envBadgeColors('test').background).toBe('#ffedd5');
  });
});

describe('environmentsMismatch', () => {
  it('detects frontend/backend env drift', () => {
    expect(
      environmentsMismatch(
        { environment: 'test', version: 'a', gitSha: 'abc', firebaseProject: null },
        { environment: 'production', version: 'b', gitSha: 'def', firebaseProject: null },
      ),
    ).toBe(true);
  });

  it('ignores unknown env', () => {
    expect(
      environmentsMismatch(
        { environment: 'unknown', version: 'a', gitSha: null, firebaseProject: null },
        { environment: 'test', version: 'b', gitSha: null, firebaseProject: null },
      ),
    ).toBe(false);
  });
});

describe('formatBuildInfoCopyText', () => {
  it('includes frontend and backend lines', () => {
    const text = formatBuildInfoCopyText(
      { environment: 'test', version: 'dev-abc', gitSha: 'abc1234', firebaseProject: 'whatorder-fire' },
      { environment: 'test', version: 'dev-abc', gitSha: 'abc1234', firebaseProject: 'whatorder-fire' },
    );
    expect(text).toContain('Frontend: test');
    expect(text).toContain('Backend: test');
  });
});
