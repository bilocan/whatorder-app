const request = require('supertest');

describe('GET /health and GET /version', () => {
  const orig = {
    DEPLOY_ENV: process.env.DEPLOY_ENV,
    GIT_SHA: process.env.GIT_SHA,
    APP_VERSION: process.env.APP_VERSION,
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID,
  };

  beforeEach(() => {
    process.env.DEPLOY_ENV = 'test';
    process.env.GIT_SHA = 'deadbeef1234';
    process.env.APP_VERSION = 'dev-deadbeef1234';
    process.env.FIREBASE_PROJECT_ID = 'whatorder-fire';
    jest.resetModules();
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(orig)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function app() {
    return require('../index');
  }

  test('/health includes status and build metadata', async () => {
    const res = await request(app()).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('OK');
    expect(res.body.timestamp).toBeDefined();
    expect(res.body.environment).toBe('test');
    expect(res.body.version).toBe('dev-deadbeef1234');
    expect(res.body.gitSha).toBe('deadbee');
    expect(res.body.firebaseProject).toBe('whatorder-fire');
  });

  test('/version returns build metadata only', async () => {
    const res = await request(app()).get('/version');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      environment: 'test',
      version: 'dev-deadbeef1234',
      gitSha: 'deadbee',
      firebaseProject: 'whatorder-fire',
    });
    expect(res.body.status).toBeUndefined();
  });
});
