'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IP_LOCATION_URL,
  REVERSE_GEOCODE_ENDPOINT,
  FORECAST_ENDPOINT,
  GEOCODING_ENDPOINT,
  CACHE_TTL_MS,
  UNAVAILABLE_TEXT,
  describeWeatherCode,
  describeWeatherLocation,
  pickCityName,
  pickIpCity,
  normalizeCoordinates,
  parseIpLocation,
  normalizeWeatherCity,
  readWeatherCity,
  writeWeatherCity,
  resolveWeatherLocation,
  formatTemperature,
  formatWeatherResult,
  buildReverseGeocodeUrl,
  buildForecastUrl,
  buildGeocodingUrl,
  parseGeocodingResults,
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

test('reverse geocode, geocoding and forecast URLs carry their inputs', () => {
  const reverse = buildReverseGeocodeUrl(40.71, -74.01);
  assert.ok(reverse.startsWith(REVERSE_GEOCODE_ENDPOINT + '?'));
  assert.ok(reverse.includes('latitude=40.71'));
  assert.ok(reverse.includes('longitude=-74.01'));
  assert.ok(reverse.includes('localityLanguage=zh'));

  const geocoding = buildGeocodingUrl(' 东京 ');
  assert.ok(geocoding.startsWith(GEOCODING_ENDPOINT + '?'));
  assert.ok(geocoding.includes('name=%E4%B8%9C%E4%BA%AC'));
  assert.ok(geocoding.includes('count=8'));
  assert.ok(geocoding.includes('language=zh'));
  assert.ok(geocoding.includes('format=json'));
  assert.equal(buildGeocodingUrl('   '), '');

  const forecast = buildForecastUrl(40.71, -74.01);
  assert.ok(forecast.startsWith(FORECAST_ENDPOINT + '?'));
  assert.ok(forecast.includes('latitude=40.71'));
  assert.ok(forecast.includes('longitude=-74.01'));
  assert.ok(forecast.includes('current=temperature_2m,weather_code'));
  assert.ok(forecast.includes('timezone=auto'));

  assert.equal(buildForecastUrl(100, 0), '');
});

test('geocoding results become 城市名 · 省/州 · 国家 rows', () => {
  assert.deepEqual(parseGeocodingResults({
    results: [
      {
        name: '东京',
        admin1: '东京都',
        country: '日本',
        latitude: 35.68,
        longitude: 139.69
      },
      {
        name: '东京',
        admin1: '',
        country: '日本',
        latitude: '35.7',
        longitude: '139.7'
      },
      { name: '', admin1: '东京都', country: '日本', latitude: 35.68, longitude: 139.69 },
      { name: '越界', admin1: '', country: '日本', latitude: 100, longitude: 139.69 },
      null
    ]
  }), [
    {
      name: '东京',
      admin1: '东京都',
      country: '日本',
      latitude: 35.68,
      longitude: 139.69,
      label: '东京 · 东京都 · 日本'
    },
    {
      name: '东京',
      admin1: '',
      country: '日本',
      latitude: 35.7,
      longitude: 139.7,
      label: '东京 · 日本'
    }
  ]);

  assert.deepEqual(parseGeocodingResults({}), []);
  assert.deepEqual(parseGeocodingResults(null), []);
});

test('weatherCity is normalized on read, write and clear', () => {
  const original = { loginItemInitialized: true };
  const saved = writeWeatherCity(original, {
    name: ' 东京 ',
    latitude: '35.68',
    longitude: 139.69
  });

  assert.deepEqual(original, { loginItemInitialized: true });
  assert.deepEqual(saved, {
    loginItemInitialized: true,
    weatherCity: { name: '东京', latitude: 35.68, longitude: 139.69 }
  });
  assert.deepEqual(readWeatherCity(saved), {
    name: '东京',
    latitude: 35.68,
    longitude: 139.69
  });

  const cleared = writeWeatherCity(saved, null);
  assert.deepEqual(cleared, { loginItemInitialized: true });
  assert.equal('weatherCity' in cleared, false);
  assert.equal(readWeatherCity(cleared), null);

  assert.equal(normalizeWeatherCity({ name: '', latitude: 1, longitude: 2 }), null);
  assert.equal(normalizeWeatherCity({ name: '东京', latitude: 100, longitude: 2 }), null);
  assert.equal(readWeatherCity({ weatherCity: { name: '东京', latitude: '', longitude: 2 } }), null);
  assert.equal(readWeatherCity(null), null);
});

test('manual city wins over IP data and falls back to IP when absent', () => {
  const manual = { name: '东京', latitude: 35.68, longitude: 139.69 };
  const ipData = { success: true, city: '洛杉矶', latitude: 34.05, longitude: -118.24 };

  assert.deepEqual(resolveWeatherLocation(manual, ipData), {
    source: 'manual',
    coordinates: { latitude: 35.68, longitude: 139.69 },
    city: '东京'
  });
  assert.deepEqual(resolveWeatherLocation(null, ipData), {
    source: 'ip',
    coordinates: { latitude: 34.05, longitude: -118.24 },
    city: '洛杉矶'
  });
  assert.deepEqual(resolveWeatherLocation({ name: '东京' }, ipData), {
    source: 'ip',
    coordinates: { latitude: 34.05, longitude: -118.24 },
    city: '洛杉矶'
  });
  assert.equal(resolveWeatherLocation(null, { success: false }), null);
});

test('weather location log text names the source and city', () => {
  assert.equal(
    describeWeatherLocation({ source: 'manual', city: '东京' }),
    '天气位置=手动：东京'
  );
  assert.equal(
    describeWeatherLocation({ source: 'ip', city: 'Los Angeles' }),
    '天气位置=IP：Los Angeles'
  );
  assert.equal(
    describeWeatherLocation({ source: 'ip', city: '' }),
    '天气位置=IP：当前位置'
  );
  assert.equal(
    describeWeatherLocation({ source: 'manual', city: '' }),
    '天气位置=手动：当前位置'
  );
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

test('weather service uses a manual city without IP or reverse geocoding', async () => {
  let clock = 1000;
  const calls = [];
  const logs = [];
  function fakeFetch(url) {
    calls.push(url);
    if (url.startsWith(IP_LOCATION_URL)) {
      return Promise.resolve(response({
        success: true,
        city: '洛杉矶',
        latitude: 34.05,
        longitude: -118.24
      }));
    }
    if (url.startsWith(REVERSE_GEOCODE_ENDPOINT)) {
      return Promise.reject(new Error('reverse geocode should not be needed'));
    }
    if (url.startsWith(FORECAST_ENDPOINT)) {
      return Promise.resolve(response({
        current: { temperature_2m: 8.2, weather_code: 2 }
      }));
    }
    return Promise.reject(new Error('unexpected URL ' + url));
  }

  const service = createWeatherService({
    fetch: fakeFetch,
    weatherCity: { name: '东京', latitude: 35.68, longitude: 139.69 },
    now: () => clock,
    logger: {
      info: (message) => logs.push('info:' + message),
      warn: (message) => logs.push('warn:' + message)
    }
  });

  const first = await service.get();
  assert.equal(first.text, '东京 · 多云 · 8°C');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith(FORECAST_ENDPOINT));
  assert.ok(calls[0].includes('latitude=35.68'));
  assert.ok(calls[0].includes('longitude=139.69'));
  assert.ok(logs.includes('info:天气位置=手动：东京'));

  const cached = await service.get();
  assert.equal(cached.text, first.text);
  assert.equal(calls.length, 1);

  clock += CACHE_TTL_MS;
  await service.refresh();
  assert.equal(calls.length, 2);

  // Choosing 自动 clears the manual city and goes back to IP.
  service.setCity(null);
  assert.equal(service.getCached(), null);
  const automatic = await service.get();
  assert.equal(automatic.text, '洛杉矶 · 多云 · 8°C');
  assert.equal(calls.length, 4);
  assert.ok(calls[2].startsWith(IP_LOCATION_URL));
  assert.ok(logs.includes('info:天气位置=IP：洛杉矶'));

  // A new manual city clears the IP cache and skips ipwho.is again.
  service.setCity({ name: '巴黎', latitude: 48.86, longitude: 2.35 });
  const paris = await service.get();
  assert.equal(paris.text, '巴黎 · 多云 · 8°C');
  assert.equal(calls.length, 5);
  assert.ok(calls[4].startsWith(FORECAST_ENDPOINT));
  assert.ok(logs.includes('info:天气位置=手动：巴黎'));
});

test('IP weather without a city falls back to reverse geocoding', async () => {
  const calls = [];
  const logs = [];
  function fakeFetch(url) {
    calls.push(url);
    if (url.startsWith(IP_LOCATION_URL)) {
      return Promise.resolve(response({
        success: true,
        latitude: 40.71,
        longitude: -74.01
      }));
    }
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

  const service = createWeatherService({
    fetch: fakeFetch,
    logger: {
      info: (message) => logs.push('info:' + message),
      warn: (message) => logs.push('warn:' + message)
    }
  });

  const result = await service.get();
  assert.equal(result.text, '曼哈顿 · 多云 · 8°C');
  assert.equal(calls.length, 3);
  assert.ok(calls[0].startsWith(IP_LOCATION_URL));
  assert.ok(calls[1].startsWith(REVERSE_GEOCODE_ENDPOINT));
  assert.ok(calls[2].startsWith(FORECAST_ENDPOINT));
  assert.ok(logs.includes('info:天气位置=IP：曼哈顿'));
  assert.ok(!logs.some((line) => line.includes('40.71')));
});

test('city search uses the geocoding endpoint and returns parsed rows', async () => {
  const calls = [];
  const service = createWeatherService({
    fetch: async (url) => {
      calls.push(url);
      return response({
        results: [{
          name: '东京',
          admin1: '东京都',
          country: '日本',
          latitude: 35.68,
          longitude: 139.69
        }]
      });
    }
  });

  const rows = await service.searchCity('东京');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith(GEOCODING_ENDPOINT + '?'));
  assert.deepEqual(rows, [{
    name: '东京',
    admin1: '东京都',
    country: '日本',
    latitude: 35.68,
    longitude: 139.69,
    label: '东京 · 东京都 · 日本'
  }]);

  assert.deepEqual(await service.searchCity('  '), []);
  assert.equal(calls.length, 1);
});

test('weather service caches failures for 30 minutes and logs the reason', async () => {
  let clock = 1000;
  const calls = [];
  const logs = [];
  const service = createWeatherService({
    fetch: async (url) => {
      calls.push(url);
      throw new Error('offline');
    },
    now: () => clock,
    logger: { warn: (message) => logs.push('warn:' + message) }
  });

  assert.deepEqual(await service.get(), { ok: false, text: UNAVAILABLE_TEXT });
  assert.ok(logs.some((line) => line === 'warn:更新失败：offline'));

  assert.deepEqual(await service.get(), { ok: false, text: UNAVAILABLE_TEXT });
  assert.equal(calls.length, 1);

  clock += CACHE_TTL_MS;
  await service.get();
  assert.equal(calls.length, 2);
});
