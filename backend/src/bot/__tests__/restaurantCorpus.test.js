const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  buildPilotScaffold,
  ensurePilotScaffold,
  loadRestaurantMenuFixture,
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
  });
});
