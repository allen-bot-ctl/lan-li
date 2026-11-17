'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IP_LOCATION_URL,
  REVERSE_GEOCODE_ENDPOINT,
  FORECAST_ENDPOINT,
  CACHE_TTL_MS,
  UNAVAILABLE_TEXT,
  GEOLOCATION_ERROR_TEXT,
  describeLocationSource,
  describeWeatherCode,
  pickCityName,
  pickIpCity,
  normalizeCoordinates,
  parseIpLocation,
  formatTemperature,
  formatWeatherResult,
  buildReverseGeocodeUrl,
  buildForecastUrl,
  createWeatherService
} = require('../electron/weather');

function response(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body
  };
}

test('WMO weather codes map to short Chinese text', () => {
  assert.equal(describeWeatherCode(0), '晴');
  assert.equal(describeWeatherCode(2), '多云');
  assert.equal(describeWeatherCode(3), '阴');
  assert.equal(describeWeatherCode(45), '雾');
  assert.equal(describeWeatherCode(51), '毛毛雨');
  assert.equal(describeWeatherCode(63), '中雨');
  assert.equal(describeWeatherCode(73), '中雪');
  assert.equal(describeWeatherCode(80), '阵雨');
  assert.equal(describeWeatherCode(85), '阵雪');
  assert.equal(describeWeatherCode(95), '雷暴');
  assert.equal(describeWeatherCode(999), '未知');
  assert.equal(describeWeatherCode(null), '未知');
  assert.equal(describeWeatherCode('nope'), '未知');
});

test('city selection falls back city → locality → principalSubdivision', () => {
  assert.equal(pickCityName({ city: '纽约', locality: '曼哈顿', principalSubdivision: '纽约州' }), '纽约');
  assert.equal(pickCityName({ city: '  ', locality: '曼哈顿', principalSubdivision: '纽约州' }), '曼哈顿');
  assert.equal(pickCityName({ principalSubdivision: '纽约州' }), '纽约州');
  assert.equal(pickCityName({ city: 42 }), '');
  assert.equal(pickCityName(null), '');
});

test('IP city selection is ignored when ipwho.is reports failure', () => {
  assert.equal(pickIpCity({ success: true, city: '纽约' }), '纽约');
  assert.equal(pickIpCity({ city: '纽约' }), '纽约');
  assert.equal(pickIpCity({ success: false, city: '纽约' }), '');
  assert.equal(pickIpCity(null), '');
});

test('coordinates are validated before any request is built', () => {
  assert.deepEqual(normalizeCoordinates({ latitude: 40.7, longitude: -74 }), {
    latitude: 40.7,
    longitude: -74
  });
  assert.deepEqual(normalizeCoordinates({ latitude: '40.7', longitude: '-74' }), {
    latitude: 40.7,
    longitude: -74
  });
  assert.equal(normalizeCoordinates({ latitude: 91, longitude: 0 }), null);
  assert.equal(normalizeCoordinates({ latitude: 0, longitude: 181 }), null);
  assert.equal(normalizeCoordinates({ latitude: '', longitude: 0 }), null);
  assert.equal(normalizeCoordinates(null), null);

  assert.deepEqual(
    parseIpLocation({ success: true, city: '纽约', latitude: 40.7, longitude: -74 }),
    { coordinates: { latitude: 40.7, longitude: -74 }, city: '纽约' }
  );
  assert.equal(parseIpLocation({ success: false, latitude: 40.7, longitude: -74 }), null);
});

test('reverse geocode and forecast URLs carry the coordinates', () => {
  const reverse = buildReverseGeocodeUrl(40.71, -74.01);
  assert.ok(reverse.startsWith(REVERSE_GEOCODE_ENDPOINT + '?'));
  assert.ok(reverse.includes('latitude=40.71'));
  assert.ok(reverse.includes('longitude=-74.01'));
  assert.ok(reverse.includes('localityLanguage=zh'));

  const forecast = buildForecastUrl(40.71, -74.01);
  assert.ok(forecast.startsWith(FORECAST_ENDPOINT + '?'));
  assert.ok(forecast.includes('latitude=40.71'));
  assert.ok(forecast.includes('longitude=-74.01'));
  assert.ok(forecast.includes('current=temperature_2m,weather_code'));
  assert.ok(forecast.includes('timezone=auto'));

  assert.equal(buildForecastUrl(100, 0), '');
});

test('weather result formats as 城市 · 天气 · 温度°C', () => {
  assert.equal(formatTemperature(8.4), '8°C');
  assert.equal(formatTemperature('8.6'), '9°C');
  assert.equal(formatTemperature(null), '');

  assert.deepEqual(
    formatWeatherResult({ city: '纽约', temperature: 8.2, weatherCode: 2 }),
    {
      ok: true,
      city: '纽约',
      weather: '多云',
      temperature: 8,
      temperatureText: '8°C',
      text: '纽约 · 多云 · 8°C'
    }
  );

  const noCity = formatWeatherResult({ temperature: 0, weatherCode: 0 });
  assert.equal(noCity.text, '当前位置 · 晴 · 0°C');

  assert.deepEqual(
    formatWeatherResult({ city: '纽约', weatherCode: 2 }),
    { ok: false, text: UNAVAILABLE_TEXT }
  );
});

test('weather service uses coordinates, caches for 30 minutes and logs failures', async () => {
  let clock = 1000;
  const calls = [];
  function fakeFetch(url) {
    calls.push(url);
    if (url.startsWith(REVERSE_GEOCODE_ENDPOINT)) {
      return Promise.resolve(response({
        city: '',
        locality: '曼哈顿',
        principalSubdivision: '纽约州'
      }));
    }
    if (url.startsWith(FORECAST_ENDPOINT)) {
      return Promise.resolve(response({
        current: { temperature_2m: 8.2, weather_code: 2 }
      }));
    }
    return Promise.reject(new Error('unexpected URL ' + url));
  }

  const logs = [];
  const service = createWeatherService({
    fetch: fakeFetch,
    now: () => clock,
    logger: {
      info: (message) => logs.push('info:' + message),
      warn: (message) => logs.push('warn:' + message)
    }
  });

  const first = await service.get({ latitude: 40.71, longitude: -74.01 });
  assert.equal(first.text, '曼哈顿 · 多云 · 8°C');
  assert.equal(calls.length, 2);

  const cached = await service.get({ latitude: 40.71, longitude: -74.01 });
  assert.equal(cached.text, first.text);
  assert.equal(calls.length, 2);

  clock += CACHE_TTL_MS;
  await service.refresh();
  assert.equal(calls.length, 4);
  assert.ok(logs.some((line) => line.startsWith('info:更新成功')));

  const failing = createWeatherService({
    fetch: async () => {
      throw new Error('offline');
    },
    logger: { warn: (message) => logs.push('warn:' + message) }
  });
  assert.deepEqual(await failing.get(null), { ok: false, text: UNAVAILABLE_TEXT });
  assert.ok(logs.some((line) => line === 'warn:更新失败：offline'));
});

test('location source describes system success, failure and missing geolocation', () => {
  assert.equal(describeLocationSource({ source: 'system' }), '定位来源=系统');
  assert.equal(
    describeLocationSource({ source: 'system', error: { code: 3, message: 'Timeout expired' } }),
    '定位来源=IP（系统定位失败 code=3 TIMEOUT: Timeout expired）'
  );
  assert.equal(
    describeLocationSource({ source: 'system', error: { code: 1, message: 'User denied Geolocation' } }),
    '定位来源=IP（系统定位失败 code=1 PERMISSION_DENIED: User denied Geolocation）'
  );
  assert.equal(
    describeLocationSource({ source: 'system', error: { code: 2, message: 'Position unavailable' } }),
    '定位来源=IP（系统定位失败 code=2 POSITION_UNAVAILABLE: Position unavailable）'
  );
  assert.equal(
    describeLocationSource({ source: 'system', error: { code: 3 } }),
    '定位来源=IP（系统定位失败 code=3 TIMEOUT）'
  );
  assert.equal(
    describeLocationSource({ source: 'none' }),
    '定位来源=IP（无系统定位 API）'
  );
  assert.equal(describeLocationSource(null), '');
  assert.equal(describeLocationSource(undefined), '');
  assert.equal(describeLocationSource({ source: 'unknown' }), '');
});

test('geolocation error codes map to DOM constant names', () => {
  assert.equal(GEOLOCATION_ERROR_TEXT[1], 'PERMISSION_DENIED');
  assert.equal(GEOLOCATION_ERROR_TEXT[2], 'POSITION_UNAVAILABLE');
  assert.equal(GEOLOCATION_ERROR_TEXT[3], 'TIMEOUT');
});

test('weather service logs the location source without logging coordinates', async () => {
  const logs = [];
  function fakeFetch(url) {
    if (url.startsWith(REVERSE_GEOCODE_ENDPOINT)) {
      return Promise.resolve(response({ city: '纽约', locality: '', principalSubdivision: '' }));
    }
    if (url.startsWith(FORECAST_ENDPOINT)) {
      return Promise.resolve(response({ current: { temperature_2m: 8.2, weather_code: 2 } }));
    }
    return Promise.reject(new Error('unexpected URL ' + url));
  }

  const service = createWeatherService({
    fetch: fakeFetch,
    logger: {
      info: (message) => logs.push('info:' + message),
      warn: (message) => logs.push('warn:' + message)
    }
  });

  await service.get({ latitude: 40.71, longitude: -74.01 }, { source: 'system' });
  assert.ok(logs.some((line) => line === 'info:定位来源=系统'));
  assert.ok(!logs.some((line) => line.includes('40.71')));

  const failing = createWeatherService({
    fetch: async () => {
      throw new Error('offline');
    },
    logger: { warn: (message) => logs.push('warn:' + message) }
  });
  await failing.get(null, {
    source: 'system',
    error: { code: 3, message: 'Timeout expired' }
  });
  assert.ok(logs.some((line) => (
    line === 'warn:定位来源=IP（系统定位失败 code=3 TIMEOUT: Timeout expired）'
  )));
});
