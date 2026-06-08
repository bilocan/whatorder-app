module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!src/lib/firebase.js',   // bootstrapping — always mocked, never executed in tests
    '!src/bot/orderParser.js', // not yet covered — Phase 2 scope
  ],
  coverageThreshold: { global: { branches: 70, functions: 80, lines: 80, statements: 80 } },
};
