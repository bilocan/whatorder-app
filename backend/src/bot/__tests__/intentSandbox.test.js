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

  test('beide mit allen eine extra scharf splits into two kebabs with per-line spicy', async () => {
    const result = await evaluateIntent(
      'hallo wir hatten gerne zwei doner beide mit allen eine extra scharf bitte',
      { menu: BUILTIN_MENU, lang: 'de', llm: false },
    );
    expect(result.outcome).toBe('proposal');
    expect(result.intent.parsedBy).toBe('rules');
    expect(result.intent.items).toEqual([
      { name: 'doner mit allen ohne scharf', qty: 1 },
      { name: 'doner mit allen und scharf', qty: 1 },
    ]);
    expect(result.matched).toHaveLength(2);
    expect(result.matched.reduce((s, m) => s + m.qty, 0)).toBe(2);
    expect(result.botReply).toMatch(/Scharfe Sauce|extra scharf/i);
    expect((result.botReply.match(/extra scharf/gi) ?? []).length
      + (result.botReply.match(/Scharfe Sauce/g) ?? []).length).toBe(1);
    expect(result.botReply).toMatch(/€15\.00/);
  });

  test('beide mit alles recovers when parser collapsed to 2x one line', async () => {
    const result = await evaluateIntent(
      'zwei doner beide mit alles eine extra scharf bitte',
      { menu: BUILTIN_MENU, lang: 'de', llm: false },
    );
    expect(result.matched).toHaveLength(2);
    expect(result.botReply).not.toMatch(/2x Kebap Sandwich Huhn.*extra scharf.*€15/i);
    expect(result.botReply).toMatch(/€15\.00/);
  });

  test('trailing quote after bitte still splits zwei doner beide mit allen', async () => {
    const result = await evaluateIntent(
      'hallo wir hatten gerne zwei doner beide mit allen eine extra scharf bitte"',
      { menu: BUILTIN_MENU, lang: 'de', llm: false },
    );
    expect(result.intent.items).toEqual([
      { name: 'doner mit allen ohne scharf', qty: 1 },
      { name: 'doner mit allen und scharf', qty: 1 },
    ]);
    expect(result.matched).toHaveLength(2);
    expect(result.botReply).not.toMatch(/2x Kebap Sandwich Huhn/);
    expect((result.botReply.match(/extra scharf/gi) ?? []).length
      + (result.botReply.match(/Scharfe Sauce/g) ?? []).length).toBe(1);
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

  test('döner mit allem ohne scharf stays on rules and omits extra scharf note', async () => {
    const result = await evaluateIntent('döner mit allem ohne scharf', {
      menu: BUILTIN_MENU,
      lang: 'de',
      llm: false,
    });
    expect(result.outcome).toBe('proposal');
    expect(result.intent.parsedBy).toBe('rules');
    expect(result.botReply).not.toMatch(/extra scharf/i);
  });

  test('döner mit allem ohne scharf bitte resolves beilagen in bot reply', async () => {
    const result = await evaluateIntent('döner mit allem ohne scharf bitte', {
      menu: BUILTIN_MENU,
      lang: 'de',
      llm: false,
    });
    expect(result.outcome).toBe('proposal');
    expect(result.botReply).toMatch(/Tomaten.*Salat.*Zwiebel.*Sauce/i);
    expect(result.botReply).not.toMatch(/Scharfe Sauce/i);
    expect(result.botReply).not.toMatch(/extra scharf/i);
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
