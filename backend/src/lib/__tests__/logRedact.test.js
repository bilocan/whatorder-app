const { redactPhone, redactLogValue } = require('../logRedact');

describe('logRedact', () => {
  let savedEnv;

  beforeEach(() => {
    savedEnv = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  describe('redactPhone', () => {
    test('returns full phone in non-production', () => {
      process.env.NODE_ENV = 'test';
      expect(redactPhone('+43699000001')).toBe('+43699000001');
    });

    test('masks to last four digits in production', () => {
      process.env.NODE_ENV = 'production';
      expect(redactPhone('+43699000001')).toBe('***0001');
    });
  });

  describe('redactLogValue', () => {
    test('stringifies objects in non-production', () => {
      process.env.NODE_ENV = 'development';
      expect(redactLogValue({ secret: 'value' })).toBe('{"secret":"value"}');
    });

    test('redacts in production', () => {
      process.env.NODE_ENV = 'production';
      expect(redactLogValue({ secret: 'value' })).toBe('[redacted]');
    });
  });
});
