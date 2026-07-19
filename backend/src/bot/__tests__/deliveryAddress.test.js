const {
  hasUnitPattern,
  isHausSkip,
  normalizeBuildingLabel,
  composeDeliveryLabel,
} = require('../deliveryAddress');

describe('deliveryAddress helpers', () => {
  test('hasUnitPattern detects Top / Tür / Stiege / slash', () => {
    expect(hasUnitPattern('Hippgasse 11, Top 14, 1160 Wien')).toBe(true);
    expect(hasUnitPattern('Hippgasse 11/5')).toBe(true);
    expect(hasUnitPattern('Stiege 2, Tür 8')).toBe(true);
    expect(hasUnitPattern('Hippgasse 11, 1160 Wien')).toBe(false);
  });

  test('isHausSkip accepts haus / house / yok', () => {
    expect(isHausSkip('haus')).toBe(true);
    expect(isHausSkip('house')).toBe(true);
    expect(isHausSkip('yok')).toBe(true);
    expect(isHausSkip('top 14')).toBe(false);
  });

  test('normalizeBuildingLabel strips country suffix', () => {
    expect(normalizeBuildingLabel('Hippgasse 11, 1160 Wien, Austria')).toBe('Hippgasse 11, 1160 Wien');
    expect(normalizeBuildingLabel('Hippgasse 11, 1160 Wien, Österreich')).toBe('Hippgasse 11, 1160 Wien');
  });

  test('composeDeliveryLabel inserts unit before PLZ', () => {
    expect(composeDeliveryLabel('Hippgasse 11, 1160 Wien', 'Top 14')).toBe('Hippgasse 11, Top 14, 1160 Wien');
    expect(composeDeliveryLabel('Hippgasse 11, 1160 Wien', 'Haus')).toBe('Hippgasse 11, 1160 Wien');
    expect(composeDeliveryLabel('Somewhere', 'Top 1')).toBe('Somewhere, Top 1');
  });

  test('isDeliverableBuildingLabel requires street + house number', () => {
    const { isDeliverableBuildingLabel } = require('../deliveryAddress');
    expect(isDeliverableBuildingLabel('Lavaterstraße 3, 1220 Wien')).toBe(true);
    expect(isDeliverableBuildingLabel('Hippgasse 11, 1160 Wien, Austria')).toBe(true);
    expect(isDeliverableBuildingLabel('Wien')).toBe(false);
    expect(isDeliverableBuildingLabel('Wien, Austria')).toBe(false);
    expect(isDeliverableBuildingLabel('panikken gasse wien')).toBe(false);
    expect(isDeliverableBuildingLabel('Panikengasse, 1150 Wien')).toBe(false);
  });

  test('isNearlySameAddress does not match city-only against street text', () => {
    const { isNearlySameAddress } = require('../deliveryAddress');
    expect(isNearlySameAddress('panikken gasse wien', 'Wien')).toBe(false);
    expect(isNearlySameAddress('panikken gasse wien', 'Wien, Austria')).toBe(false);
    expect(isNearlySameAddress('Hippgasse 11', 'Hippgasse 11, 1160 Wien')).toBe(true);
  });

  test('parseDeliveryUnit normalizes and rejects nonsense', () => {
    const { parseDeliveryUnit } = require('../deliveryAddress');
    expect(parseDeliveryUnit('Haus')).toEqual({ ok: true, label: null });
    expect(parseDeliveryUnit('Top 14')).toEqual({ ok: true, label: 'Top 14' });
    expect(parseDeliveryUnit('15')).toEqual({ ok: true, label: 'Top 15' });
    expect(parseDeliveryUnit('3/12')).toEqual({ ok: true, label: 'Stiege 3, Top 12' });
    expect(parseDeliveryUnit('Stiege 1, Top 8')).toEqual({ ok: true, label: 'Stiege 1, Top 8' });
    expect(parseDeliveryUnit('9888')).toEqual({ ok: false });
    expect(parseDeliveryUnit('asdf')).toEqual({ ok: false });
  });

  test('splitStreetAndUnitHint parses AT slash house/stiege/top', () => {
    const { splitStreetAndUnitHint, isNearlySameAddress } = require('../deliveryAddress');
    expect(splitStreetAndUnitHint('lavatastrasse 3/3/15')).toEqual({
      query: 'lavatastrasse 3',
      unitHint: 'Stiege 3, Top 15',
    });
    expect(splitStreetAndUnitHint('Hippgasse 11/14')).toEqual({
      query: 'Hippgasse 11',
      unitHint: 'Top 14',
    });
    expect(splitStreetAndUnitHint('Lavaterstraße 3/3/15, 1220 Wien')).toEqual({
      query: 'Lavaterstraße 3, 1220 Wien',
      unitHint: 'Stiege 3, Top 15',
    });
    expect(splitStreetAndUnitHint('lavaterstrasse 3/3/15 1220')).toEqual({
      query: 'lavaterstrasse 3, 1220',
      unitHint: 'Stiege 3, Top 15',
    });
    expect(splitStreetAndUnitHint('Hippgasse 11, 1160 Wien')).toEqual({
      query: 'Hippgasse 11, 1160 Wien',
      unitHint: null,
    });
    expect(isNearlySameAddress(
      'Lavaterstraße 3/3/15, 1220 Wien',
      'Lavaterstraße 3, Stiege 3, Top 15, 1220 Wien',
    )).toBe(true);
    expect(isNearlySameAddress(
      'lavaterstrasse 3/3/15 1220',
      'Lavaterstraße 3, Stiege 3, Top 15, 1220 Wien',
    )).toBe(true);
  });
});
