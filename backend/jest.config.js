module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
  ],
  // Thresholds will be enforced once Phase 1B bot tests are complete.
  // coverageThreshold: { global: { branches: 70, functions: 80, lines: 80, statements: 80 } },
};
