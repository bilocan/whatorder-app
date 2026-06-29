const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('../menuService', () => ({
  getMenuContext: jest.fn(),
}));

jest.mock('../intentEval', () => ({
  appendCaseToCorpus: jest.fn(),
  recordIntentCase: jest.fn(),
}));

const { getMenuContext } = require('../menuService');
const { appendCaseToCorpus, recordIntentCase } = require('../intentEval');
const {
  buildPilotScaffold,
  ensurePilotScaffold,
  exportRestaurantMenuFixture,
  loadRestaurantMenuFixture,
  recordPhrasesToPilot,
  stripMenuForFixture,
} = require('../restaurantCorpus');

describe('restaurantCorpus', () => {
  describe('buildPilotScaffold', () => {
    test('builds tenant pilot metadata with relative menu refs', () => {
      const doc = buildPilotScaffold('enes', {
        businessId: 'biz_enes_kebap_9450w',
        restaurantName: 'Enes Kebap',
      });
      expect(doc.menu).toBe('menu.json');
      expect(doc.menuMatch).toBe('menuMatch.json');
      expect(doc.businessId).toBe('biz_enes_kebap_9450w');
      expect(doc.cases).toEqual([]);
      expect(doc.name).toBe('enes-pilot-phrases');
    });
  });

  describe('ensurePilotScaffold', () => {
    test('creates pilot.json once and skips when it exists', () => {
      const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-init-'));
      const first = ensurePilotScaffold('demo', {
        corpusDir,
        businessId: 'biz_demo_abc',
        restaurantName: 'Demo',
      });
      expect(first.created).toBe(true);
      expect(fs.existsSync(first.path)).toBe(true);

      const second = ensurePilotScaffold('demo', { corpusDir, businessId: 'biz_demo_abc' });
      expect(second.created).toBe(false);
    });
  });

  describe('stripMenuForFixture', () => {
    test('keeps fixture fields and drops unknown props', () => {
      const rows = stripMenuForFixture([
        {
          id: 'a',
          name: 'Cola',
          price: 2.5,
          category: 'Drinks',
          description: 'Cold',
          aliases: ['coke'],
          optionGroups: [{ id: 'size', options: [] }],
          available: false,
          extra: 'ignored',
        },
      ]);
      expect(rows[0]).toEqual({
        id: 'a',
        name: 'Cola',
        price: 2.5,
        available: false,
        category: 'Drinks',
        description: 'Cold',
        aliases: ['coke'],
        optionGroups: [{ id: 'size', options: [] }],
      });
    });
  });

  describe('loadRestaurantMenuFixture', () => {
    test('loads menu and builds menuMatch from fixture dir', () => {
      const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-menu-'));
      const tenantDir = path.join(corpusDir, 'restaurants', 'demo');
      fs.mkdirSync(tenantDir, { recursive: true });
      fs.writeFileSync(
        path.join(tenantDir, 'menu.json'),
        JSON.stringify([{ id: 'a', name: 'Cola', price: 2.5, category: 'Drinks' }]),
      );

      const { menu, menuMatch } = loadRestaurantMenuFixture('demo', corpusDir);
      expect(menu).toHaveLength(1);
      expect(menuMatch).toBeTruthy();
    });

    test('loads saved menuMatch.json when present', () => {
      const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-match-'));
      const tenantDir = path.join(corpusDir, 'restaurants', 'demo');
      fs.mkdirSync(tenantDir, { recursive: true });
      const menu = [{ id: 'a', name: 'Cola', price: 2.5, category: 'Drinks' }];
      fs.writeFileSync(path.join(tenantDir, 'menu.json'), JSON.stringify(menu));
      fs.writeFileSync(
        path.join(tenantDir, 'menuMatch.json'),
        JSON.stringify({ categories: { Drinks: ['a'] } }),
      );

      const loaded = loadRestaurantMenuFixture('demo', corpusDir);
      expect(loaded.menu).toHaveLength(1);
      expect(loaded.menuMatch.categories.Drinks.itemCount).toBe(1);
    });

    test('throws when menu fixture is missing', () => {
      const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-missing-'));
      expect(() => loadRestaurantMenuFixture('missing', corpusDir)).toThrow(/Menu fixture missing/);
    });

    test('throws when menu fixture is not an array', () => {
      const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-bad-'));
      const tenantDir = path.join(corpusDir, 'restaurants', 'demo');
      fs.mkdirSync(tenantDir, { recursive: true });
      fs.writeFileSync(path.join(tenantDir, 'menu.json'), JSON.stringify({ bad: true }));

      expect(() => loadRestaurantMenuFixture('demo', corpusDir)).toThrow(/must be a JSON array/);
    });
  });

  describe('ensurePilotScaffold overwrite', () => {
    test('replaces pilot.json when overwrite is true', () => {
      const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-overwrite-'));
      ensurePilotScaffold('demo', { corpusDir, businessId: 'biz_a' });
      const replaced = ensurePilotScaffold('demo', {
        corpusDir,
        businessId: 'biz_b',
        overwrite: true,
      });
      expect(replaced.created).toBe(true);
      expect(replaced.doc.businessId).toBe('biz_b');
    });
  });

  describe('exportRestaurantMenuFixture', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('writes menu and menuMatch fixtures from Firestore menu', async () => {
      const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-export-'));
      getMenuContext.mockResolvedValue({
        menu: [
          {
            id: 'a',
            name: 'Cola',
            price: 2.5,
            category: 'Drinks',
            available: true,
          },
        ],
        menuMatch: { categories: { Drinks: ['a'] } },
      });

      const result = await exportRestaurantMenuFixture('biz_demo', 'demo', { corpusDir });
      expect(result.itemCount).toBe(1);
      expect(result.menuMatchPath).toBeTruthy();
      expect(fs.existsSync(result.menuPath)).toBe(true);
      expect(fs.existsSync(result.menuMatchPath)).toBe(true);
    });

    test('throws when Firestore menu is empty', async () => {
      getMenuContext.mockResolvedValue({ menu: [], menuMatch: null });
      await expect(exportRestaurantMenuFixture('biz_empty', 'demo')).rejects.toThrow(
        /No available menu items/,
      );
    });
  });

  describe('recordPhrasesToPilot', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    test('records trimmed phrases into pilot corpus', async () => {
      const corpusDir = fs.mkdtempSync(path.join(os.tmpdir(), 'corpus-record-'));
      const tenantDir = path.join(corpusDir, 'restaurants', 'demo');
      fs.mkdirSync(tenantDir, { recursive: true });
      fs.writeFileSync(
        path.join(tenantDir, 'menu.json'),
        JSON.stringify([{ id: 'a', name: 'Cola', price: 2.5, category: 'Drinks' }]),
      );

      recordIntentCase.mockResolvedValue({
        caseDef: { id: 'case_1', text: 'cola bitte' },
      });
      appendCaseToCorpus.mockReturnValue({ filePath: '/tmp/pilot.json', total: 1 });

      const recorded = await recordPhrasesToPilot('demo', [' cola bitte ', ''], { corpusDir });
      expect(recorded).toHaveLength(1);
      expect(recorded[0].text).toBe('cola bitte');
      expect(recordIntentCase).toHaveBeenCalledTimes(1);
      expect(appendCaseToCorpus).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'case_1' }),
        expect.objectContaining({ target: 'demo', corpusDir }),
      );
    });
  });
});
