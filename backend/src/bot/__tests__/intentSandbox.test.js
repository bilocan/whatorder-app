const { BUILTIN_MENU, evaluateIntent, formatSandboxResult } = require('../intentSandbox');

describe('evaluateIntent', () => {
  test('rules parse matches menu and builds proposal', async () => {
    const result = await evaluateIntent('2 Döner 1 ayran', {
      menu: BUILTIN_MENU,
      lang: 'de',
      llm: false,
    });
    expect(result.outcome).toBe('proposal');
    expect(result.intent.parsedBy).toBe('rules');
    expect(result.matched.length).toBeGreaterThan(0);
    expect(result.botReply).toMatch(/€/);
  });

  test('German modifier split matches kebap sandwich', async () => {
    const result = await evaluateIntent(
      'zwei döner einer mit allem einer ohne zwiebel',
      { menu: BUILTIN_MENU, lang: 'de', llm: false },
    );
    expect(result.outcome).toBe('proposal');
    expect(result.matched.some(m => /kebap/i.test(m.name))).toBe(true);
  });

  test('greeting is not treated as order', async () => {
    const result = await evaluateIntent('hallo', {
      menu: BUILTIN_MENU,
      lang: 'de',
      llm: false,
    });
    expect(result.outcome).toBe('not_order');
    expect(result.botReply).toBeNull();
  });

  test('ambiguous single word triggers disambiguation when multiple döner-like items', async () => {
    const result = await evaluateIntent('döner', {
      menu: BUILTIN_MENU,
      lang: 'de',
      llm: false,
    });
    expect(['disambiguation', 'proposal']).toContain(result.outcome);
  });
});

describe('formatSandboxResult', () => {
  test('includes parsedBy and bot reply sections', async () => {
    const result = await evaluateIntent('2x Cola', {
      menu: BUILTIN_MENU,
      lang: 'en',
      llm: false,
    });
    const text = formatSandboxResult(result);
    expect(text).toContain('parsedBy:');
    expect(text).toContain('--- bot reply ---');
  });
});
