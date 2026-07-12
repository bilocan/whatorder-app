const { getBuildInfo } = require('../buildInfo');

describe('getBuildInfo', () => {
  const orig = {
    DEPLOY_ENV: process.env.DEPLOY_ENV,
    GIT_SHA: process.env.GIT_SHA,
    APP_VERSION: process.env.APP_VERSION,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
    NODE_ENV: process.env.NODE_ENV,
  };

  afterEach(() => {
    for (const [key, value] of Object.entries(orig)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('returns explicit Cloud Run metadata', () => {
    process.env.DEPLOY_ENV = 'preproduction';
    process.env.GIT_SHA = 'abc1234567890';
    process.env.APP_VERSION = 'pre-abc1234567890';
    process.env.FIREBASE_PROJECT_ID = 'whatorder-fire-prod';

    expect(getBuildInfo()).toEqual({
      environment: 'preproduction',
      version: 'pre-abc1234567890',
      gitSha: 'abc1234',
      firebaseProject: 'whatorder-fire-prod',
    });
  });

  it('returns explicit Cloud Run metadata for test', () => {
    process.env.DEPLOY_ENV = 'test';
    process.env.GIT_SHA = 'abc1234567890';
    process.env.APP_VERSION = 'dev-abc1234567890';
    process.env.FIREBASE_PROJECT_ID = 'whatorder-fire';

    expect(getBuildInfo()).toEqual({
      environment: 'test',
      version: 'dev-abc1234567890',
      gitSha: 'abc1234',
      firebaseProject: 'whatorder-fire',
    });
  });

  it('defaults to local when unset in non-production', () => {
    delete process.env.DEPLOY_ENV;
    delete process.env.GIT_SHA;
    delete process.env.APP_VERSION;
    delete process.env.FIREBASE_PROJECT_ID;
    process.env.NODE_ENV = 'development';

    expect(getBuildInfo()).toEqual({
      environment: 'local',
      version: 'local',
      gitSha: null,
      firebaseProject: null,
    });
  });

  it('defaults environment to unknown in production without DEPLOY_ENV', () => {
    delete process.env.DEPLOY_ENV;
    process.env.NODE_ENV = 'production';

    expect(getBuildInfo().environment).toBe('unknown');
  });
});
