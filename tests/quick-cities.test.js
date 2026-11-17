'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QUICK_CITIES_PATH,
  loadQuickCities,
  findCountryCode,
  findQuickCities,
  sameCity
} = require('../electron/quick-cities');

const REQUIRED = {
  CN: {
    country: '中国',
    cities: ['北京', '上海', '杭州', '广州', '深圳', '成都', '南京', '武汉']
  },
  JP: {
    country: '日本',
    cities: ['东京', '大阪', '京都', '名古屋', '札幌', '福冈']
  },
  US: {
    country: '美国',
    cities: ['纽约', '华盛顿', '波士顿', '芝加哥', '洛杉矶', '旧金山']
  }
};

const EXTRA = {
  KR: '韩国',
  SG: '新加坡',
  GB: '英国',
  FR: '法国',
  DE: '德国',
  CA: '加拿大',
  AU: '澳大利亚'
};

test('quick city list has the required countries and valid city records', () => {
  const data = loadQuickCities();
  assert.ok(QUICK_CITIES_PATH.endsWith('quick-cities.json'));

  for (const [code, expected] of Object.entries(REQUIRED)) {
    const group = data[code];
    assert.ok(group, `missing country group ${code}`);
    assert.equal(group.country, expected.country);
    assert.ok(Array.isArray(group.cities));

    for (const name of expected.cities) {
      assert.ok(
        group.cities.some((city) => city.name === name),
        `${code} is missing ${name}`
      );
    }

    for (const city of group.cities) {
      assert.equal(typeof city.name, 'string');
      assert.ok(city.name.trim());
      assert.equal(city.country, expected.country);
      assert.equal(typeof city.latitude, 'number');
      assert.equal(typeof city.longitude, 'number');
      assert.ok(city.latitude >= -90 && city.latitude <= 90);
      assert.ok(city.longitude >= -180 && city.longitude <= 180);
    }
  }

  // The three headline countries each offer 6–8 cities; China city names need
  // admin1 so itboy city-code matching can fall back to the province.
  assert.ok(data.CN.cities.length >= 6 && data.CN.cities.length <= 8);
  assert.ok(data.JP.cities.length >= 6 && data.JP.cities.length <= 8);
  assert.ok(data.US.cities.length >= 6 && data.US.cities.length <= 8);
  for (const city of data.CN.cities) {
    assert.equal(typeof city.admin1, 'string');
    assert.ok(city.admin1.trim());
  }

  for (const [code, country] of Object.entries(EXTRA)) {
    const group = data[code];
    assert.ok(group, `missing country group ${code}`);
    assert.equal(group.country, country);
    assert.ok(group.cities.length >= 4 && group.cities.length <= 6);
  }
});

test('country matching accepts Open-Meteo Chinese names and ipwho.is values', () => {
  assert.equal(findCountryCode('CN'), 'CN');
  assert.equal(findCountryCode('cn'), 'CN');
  assert.equal(findCountryCode('中国'), 'CN');
  assert.equal(findCountryCode('China'), 'CN');

  assert.equal(findCountryCode('JP'), 'JP');
  assert.equal(findCountryCode('日本'), 'JP');
  assert.equal(findCountryCode('Japan'), 'JP');

  assert.equal(findCountryCode('US'), 'US');
  assert.equal(findCountryCode('美国'), 'US');
  assert.equal(findCountryCode('United States'), 'US');
  assert.equal(findCountryCode('United States of America'), 'US');

  assert.equal(findCountryCode('GB'), 'GB');
  assert.equal(findCountryCode('英国'), 'GB');
  assert.equal(findCountryCode('United Kingdom'), 'GB');
  assert.equal(findCountryCode('UK'), 'GB');

  assert.equal(findCountryCode('KR'), 'KR');
  assert.equal(findCountryCode('韩国'), 'KR');
  assert.equal(findCountryCode('South Korea'), 'KR');

  assert.equal(findCountryCode(''), '');
  assert.equal(findCountryCode('   '), '');
  assert.equal(findCountryCode('Atlantis'), '');
});

test('findQuickCities returns normalized rows for the matched country', () => {
  const japan = findQuickCities('日本');
  assert.equal(japan.code, 'JP');
  assert.equal(japan.country, '日本');
  assert.deepEqual(
    japan.cities.find((city) => city.name === '东京'),
    {
      name: '东京',
      latitude: 35.6762,
      longitude: 139.6503,
      country: '日本',
      admin1: '东京都'
    }
  );

  const china = findQuickCities('China');
  assert.equal(china.code, 'CN');
  assert.equal(china.cities.find((city) => city.name === '北京').admin1, '北京市');

  assert.equal(findQuickCities('Atlantis'), null);
  assert.equal(findQuickCities(''), null);
});

test('sameCity marks the saved manual city while ignoring common suffixes', () => {
  assert.equal(sameCity({ name: '北京' }, { name: '北京' }), true);
  assert.equal(sameCity({ name: '北京' }, { name: '北京市' }), true);
  assert.equal(
    sameCity(
      { name: '上海', latitude: 31.2304, longitude: 121.4737 },
      { name: '上海', latitude: 31.23, longitude: 121.47 }
    ),
    true
  );
  assert.equal(
    sameCity(
      { name: '上海', latitude: 31.2304, longitude: 121.4737 },
      { name: '北京', latitude: 39.9042, longitude: 116.4074 }
    ),
    false
  );
  assert.equal(sameCity(null, { name: '北京' }), false);
});
