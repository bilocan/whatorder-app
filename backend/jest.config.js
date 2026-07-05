module.exports = {
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/helpers/'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/index.js',
    '!src/lib/firebase.js',   // bootstrapping — always mocked, never executed in tests
    '!src/bot/orderParser.js', // not yet covered — Phase 2 scope
    '!src/scripts/**',         // CLI tools — not unit-testable
  ],
  coverageThreshold: { global: { branches: 65, functions: 80, lines: 80, statements: 80 } },
};
