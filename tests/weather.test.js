'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  IP_LOCATION_URL,
  ITBOY_ENDPOINT,
  WTTR_ENDPOINT,
  GEOCODING_ENDPOINT,
  CACHE_TTL_MS,
  UNAVAILABLE_TEXT,
  describeWeatherLocation,
  pickIpCity,
  normalizeCoordinates,
  parseIpLocation,
  countryFromIpData,
  normalizeWeatherCity,
  readWeatherCity,
  writeWeatherCity,
  resolveWeatherLocation,
  resolveChinaCode,
  matchChinaCity,
  matchChinaCityExact,
  formatTemperature,
  weatherEmoji,
  formatWeatherResult,
  buildItboyUrl,
  buildWttrUrl,
  buildGeocodingUrl,
  parseGeocodingResults,
  parseItboyWeather,
  parseWttrWeather,
  createWeatherService
} = require('../electron/weather');

function response(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body
  };
}

function itboyBody(wendu, type) {
  return {
    time: '2026-11-17 10:00',
    cityInfo: { city: '上海', cityId: '101020100' },
    data: { wendu, forecast: [{ type, notice: '注意保暖' }] }
  };
}

function wttrBody(tempC, zhValue, descValue) {
  const current = { temp_C: tempC };
  if (zhValue !== undefined) {
    current.lang_zh = [{ value: zhValue }];
  }
  if (descValue !== undefined) {
    current.weatherDesc = [{ value: descValue }];
  }
  return { current_condition: [current] };
}

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
    parseIpLocation({
      success: true,
      city: '上海',
      country_code: 'CN',
      latitude: 31.23,
      longitude: 121.47
    }),
    {
      coordinates: { latitude: 31.23, longitude: 121.47 },
      city: '上海',
      isChina: true
    }
  );
  assert.equal(parseIpLocation({ success: false, latitude: 40.7, longitude: -74 }), null);
});

test('itboy and wttr.in URLs carry their inputs', () => {
  assert.equal(buildItboyUrl('101020100'), ITBOY_ENDPOINT + '101020100');
  assert.equal(buildItboyUrl('  '), '');

  const wttr = buildWttrUrl(40.71, -74.01);
  assert.ok(wttr.startsWith(WTTR_ENDPOINT));
  assert.ok(wttr.includes('40.71,-74.01'));
  assert.ok(wttr.includes('format=j1'));
  assert.ok(wttr.includes('lang=zh'));
  assert.equal(buildWttrUrl(100, 0), '');

  const geocoding = buildGeocodingUrl(' 东京 ');
  assert.ok(geocoding.startsWith(GEOCODING_ENDPOINT + '?'));
  assert.ok(geocoding.includes('name=%E4%B8%9C%E4%BA%AC'));
  assert.ok(geocoding.includes('count=8'));
  assert.ok(geocoding.includes('language=zh'));
  assert.ok(geocoding.includes('format=json'));
  assert.equal(buildGeocodingUrl('   '), '');
});

test('itboy response is parsed from data.wendu and forecast[0].type', () => {
  assert.deepEqual(parseItboyWeather(itboyBody('8', '多云')), {
    temperature: 8,
    weather: '多云',
    low: null,
    high: null
  });
  assert.deepEqual(parseItboyWeather(itboyBody('-3.4', '小雪')), {
    temperature: -3.4,
    weather: '小雪',
    low: null,
    high: null
  });
  assert.equal(parseItboyWeather({ data: { forecast: [{ type: '晴' }] } }), null);
  assert.equal(parseItboyWeather({ data: { wendu: '' } }), null);
  assert.equal(parseItboyWeather({}), null);
  assert.equal(parseItboyWeather(null), null);
});

test('wttr.in response prefers lang_zh and falls back to weatherDesc', () => {
  assert.deepEqual(parseWttrWeather(wttrBody('8', '多云')), {
    temperature: 8,
    weather: '多云',
    low: null,
    high: null
  });
  assert.deepEqual(parseWttrWeather(wttrBody('9', '', 'Cloudy')), {
    temperature: 9,
    weather: 'Cloudy',
    low: null,
    high: null
  });
  assert.deepEqual(parseWttrWeather(wttrBody('7', undefined, 'Sunny')), {
    temperature: 7,
    weather: 'Sunny',
    low: null,
    high: null
  });
  assert.equal(parseWttrWeather({ current_condition: [] }), null);
  assert.equal(parseWttrWeather({ current_condition: [{}] }), null);
  assert.equal(parseWttrWeather({}), null);
  assert.equal(parseWttrWeather(null), null);
});

test('china city codes match exact, suffixed, stripped and admin1 names', () => {
  assert.deepEqual(matchChinaCity('上海'), { city: '上海', code: '101020100' });
  assert.deepEqual(matchChinaCity('上饶'), { city: '上饶市', code: '101240301' });
  assert.deepEqual(matchChinaCity('闵行区'), { city: '闵行区', code: '101020200' });
  assert.deepEqual(matchChinaCity('上海市'), { city: '上海', code: '101020100' });
  // Neither 浦东 nor its suffixed/stripped forms exist; admin1 上海 does.
  assert.deepEqual(matchChinaCity('浦东', '上海'), { city: '上海', code: '101020100' });
  assert.equal(matchChinaCity('东京'), null);
  assert.equal(matchChinaCity('亚特兰大'), null);
  assert.equal(matchChinaCity(''), null);
});

test('legacy weatherCity without country only matches the table exactly', () => {
  assert.deepEqual(matchChinaCityExact('上海'), { city: '上海', code: '101020100' });
  assert.equal(matchChinaCityExact('上饶'), null);
  assert.equal(matchChinaCityExact(''), null);

  assert.deepEqual(
    resolveChinaCode({ source: 'manual', city: '上海', country: '', admin1: '' }),
    { city: '上海', code: '101020100' }
  );
  assert.equal(
    resolveChinaCode({ source: 'manual', city: '上饶', country: '', admin1: '' }),
    null
  );
  assert.deepEqual(
    resolveChinaCode({ source: 'manual', city: '上饶', country: 'CN', admin1: '江西省' }),
    { city: '上饶市', code: '101240301' }
  );
  assert.equal(
    resolveChinaCode({ source: 'manual', city: '上海', country: 'JP', admin1: '' }),
    null
  );
  assert.deepEqual(
    resolveChinaCode({ source: 'ip', city: '上海', isChina: true }),
    { city: '上海', code: '101020100' }
  );
  assert.equal(
    resolveChinaCode({ source: 'ip', city: 'Los Angeles', isChina: false }),
    null
  );
});

test('weatherCity keeps optional country and admin1 on write and read', () => {
  const original = { loginItemInitialized: true };
  const saved = writeWeatherCity(original, {
    name: ' 上海市 ',
    latitude: '31.23',
    longitude: 121.47,
    country: 'CN',
    admin1: '上海'
  });

  assert.deepEqual(original, { loginItemInitialized: true });
  assert.deepEqual(saved, {
    loginItemInitialized: true,
    weatherCity: {
      name: '上海市',
      latitude: 31.23,
      longitude: 121.47,
      country: 'CN',
      admin1: '上海'
    }
  });
  assert.deepEqual(readWeatherCity(saved), {
    name: '上海市',
    latitude: 31.23,
    longitude: 121.47,
    country: 'CN',
    admin1: '上海'
  });

  // Writing without country/admin1 drops them again.
  const plain = writeWeatherCity(saved, { name: '东京', latitude: 35.68, longitude: 139.69 });
  assert.deepEqual(plain.weatherCity, {
    name: '东京',
    latitude: 35.68,
    longitude: 139.69
  });
  // Legacy stored data without the new fields still reads back fine.
  assert.deepEqual(readWeatherCity({
    weatherCity: { name: '东京', latitude: 35.68, longitude: 139.69 }
  }), { name: '东京', latitude: 35.68, longitude: 139.69 });

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
  const manual = {
    name: '上海',
    latitude: 31.23,
    longitude: 121.47,
    country: 'CN',
    admin1: '上海'
  };
  const ipData = {
    success: true,
    city: 'Los Angeles',
    country_code: 'US',
    latitude: 34.05,
    longitude: -118.24
  };

  assert.deepEqual(resolveWeatherLocation(manual, ipData), {
    source: 'manual',
    coordinates: { latitude: 31.23, longitude: 121.47 },
    city: '上海',
    country: 'CN',
    admin1: '上海'
  });
  assert.deepEqual(resolveWeatherLocation(null, ipData), {
    source: 'ip',
    coordinates: { latitude: 34.05, longitude: -118.24 },
    city: 'Los Angeles',
    isChina: false
  });
  assert.deepEqual(resolveWeatherLocation({ name: '东京' }, ipData), {
    source: 'ip',
    coordinates: { latitude: 34.05, longitude: -118.24 },
    city: 'Los Angeles',
    isChina: false
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
    formatWeatherResult({ city: '纽约', temperature: 8.2, weather: '多云' }),
    {
      ok: true,
      city: '纽约',
      weather: '多云',
      temperature: 8,
      temperatureText: '8°C',
      low: null,
      high: null,
      rangeText: '',
      emoji: '⛅️',
      text: '纽约 · 多云 · 8°C'
    }
  );

  const noCity = formatWeatherResult({ temperature: 0, weather: '晴' });
  assert.equal(noCity.text, '当前位置 · 晴 · 0°C');

  const noWeather = formatWeatherResult({ city: '纽约', temperature: 8 });
  assert.equal(noWeather.weather, '未知');
  assert.equal(noWeather.text, '纽约 · 未知 · 8°C');
  assert.equal(noWeather.emoji, '🌡️');

  assert.deepEqual(
    formatWeatherResult({ city: '纽约', weather: '多云' }),
    { ok: false, text: UNAVAILABLE_TEXT, emoji: '🌡️' }
  );
});

test('C4 两个天气源的今日气温区间', () => {
  assert.deepEqual(
    parseItboyWeather({
      data: {
        wendu: '8',
        forecast: [{ high: '高温 15℃', low: '低温 6℃', type: '多云' }]
      }
    }),
    { temperature: 8, weather: '多云', low: 6, high: 15 }
  );

  assert.deepEqual(
    parseWttrWeather({
      current_condition: [{ temp_C: '-5', lang_zh: [{ value: '小雪' }] }],
      weather: [{ mintempC: '-12', maxtempC: '-3' }]
    }),
    { temperature: -5, weather: '小雪', low: -12, high: -3 }
  );

  assert.equal(
    formatWeatherResult({
      city: '北京',
      weather: '多云',
      temperature: 8,
      low: 6,
      high: 15
    }).rangeText,
    '6°~15°'
  );
  assert.equal(
    formatWeatherResult({
      city: '北京',
      weather: '小雪',
      temperature: -5,
      low: -12,
      high: -3
    }).rangeText,
    '-12°~-3°'
  );

  const noRange = formatWeatherResult({ city: '北京', weather: '多云', temperature: 8 });
  assert.equal(noRange.rangeText, '');
  assert.equal(noRange.low, null);
  assert.equal(noRange.high, null);
  assert.equal(noRange.temperature, 8);
});

test('weather text maps to a card emoji with 雷/雪/雨 precedence', () => {
  assert.equal(weatherEmoji('晴'), '☀️');
  assert.equal(weatherEmoji('多云'), '⛅️');
  assert.equal(weatherEmoji('阴'), '☁️');
  assert.equal(weatherEmoji('小雨'), '🌧️');
  assert.equal(weatherEmoji('雷阵雨'), '⛈️');
  assert.equal(weatherEmoji('小雪'), '❄️');
  assert.equal(weatherEmoji('雾'), '🌫️');
  assert.equal(weatherEmoji('浮尘'), '🌡️');
  assert.equal(weatherEmoji(''), '🌡️');
  assert.equal(weatherEmoji(null), '🌡️');
});

test('china city weather uses itboy with the matched table code', async () => {
  const calls = [];
  const logs = [];
  const service = createWeatherService({
    fetch: async (url) => {
      calls.push(url);
      return response(itboyBody('8', '多云'));
    },
    weatherCity: {
      name: '上海',
      latitude: 31.23,
      longitude: 121.47,
      country: 'CN',
      admin1: '上海'
    },
    logger: {
      info: (message) => logs.push('info:' + message),
      warn: (message) => logs.push('warn:' + message)
    }
  });

  const result = await service.get();
  assert.equal(result.text, '上海 · 多云 · 8°C');
  assert.equal(calls.length, 1);
  assert.equal(calls[0], ITBOY_ENDPOINT + '101020100');
  assert.ok(logs.includes('info:天气位置=手动：上海'));
  assert.ok(logs.includes('info:天气来源=itboy（上海 101020100）'));
});

test('a failed itboy request falls back to wttr.in', async () => {
  const calls = [];
  const logs = [];
  const service = createWeatherService({
    fetch: async (url) => {
      calls.push(url);
      if (url.startsWith(ITBOY_ENDPOINT)) throw new Error('aborted');
      return response(wttrBody('9', undefined, 'Sunny'));
    },
    weatherCity: {
      name: '上海',
      latitude: 31.23,
      longitude: 121.47,
      country: 'CN',
      admin1: '上海'
    },
    logger: {
      info: (message) => logs.push('info:' + message),
      warn: (message) => logs.push('warn:' + message)
    }
  });

  const result = await service.get();
  assert.equal(result.text, '上海 · Sunny · 9°C');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].startsWith(ITBOY_ENDPOINT));
  assert.ok(calls[1].startsWith(WTTR_ENDPOINT));
  assert.ok(calls[1].includes('31.23,121.47'));
  assert.ok(logs.includes('warn:itboy 请求失败：aborted'));
  assert.ok(logs.includes('info:天气来源=wttr.in'));
});

test('non-china cities go straight to wttr.in', async () => {
  const calls = [];
  const service = createWeatherService({
    fetch: async (url) => {
      calls.push(url);
      if (url.startsWith(ITBOY_ENDPOINT)) throw new Error('itboy should not be called');
      return response(wttrBody('12', '晴'));
    },
    weatherCity: {
      name: '东京',
      latitude: 35.68,
      longitude: 139.69,
      country: '日本',
      admin1: '东京都'
    },
    logger: {}
  });

  const result = await service.get();
  assert.equal(result.text, '东京 · 晴 · 12°C');
  assert.equal(calls.length, 1);
  assert.ok(calls[0].startsWith(WTTR_ENDPOINT));
});

test('legacy weatherCity without country uses itboy only on an exact hit', async () => {
  const exact = createWeatherService({
    fetch: async (url) => {
      assert.ok(url.startsWith(ITBOY_ENDPOINT));
      return response(itboyBody('8', '多云'));
    },
    weatherCity: { name: '上海', latitude: 31.23, longitude: 121.47 },
    logger: {}
  });
  assert.equal((await exact.get()).text, '上海 · 多云 · 8°C');

  const misses = createWeatherService({
    fetch: async (url) => {
      assert.ok(url.startsWith(WTTR_ENDPOINT));
      return response(wttrBody('10', '阴'));
    },
    weatherCity: { name: '上饶', latitude: 28.45, longitude: 117.94 },
    logger: {}
  });
  assert.equal((await misses.get()).text, '上饶 · 阴 · 10°C');
});

test('IP weather uses ipwho.is city directly and picks the source by country', async () => {
  const calls = [];
  const logs = [];
  const service = createWeatherService({
    fetch: async (url) => {
      calls.push(url);
      if (url.startsWith(IP_LOCATION_URL)) {
        return response({
          success: true,
          city: '上海',
          country_code: 'CN',
          latitude: 31.23,
          longitude: 121.47
        });
      }
      return response(itboyBody('8', '多云'));
    },
    logger: {
      info: (message) => logs.push('info:' + message),
      warn: (message) => logs.push('warn:' + message)
    }
  });

  const result = await service.get();
  assert.equal(result.text, '上海 · 多云 · 8°C');
  assert.equal(calls.length, 2);
  assert.ok(calls[0].startsWith(IP_LOCATION_URL));
  assert.ok(calls[1].startsWith(ITBOY_ENDPOINT));
  assert.ok(logs.includes('info:天气位置=IP：上海'));
  assert.ok(logs.includes('info:天气来源=itboy（上海 101020100）'));

  // Choosing 自动 clears the manual city and goes back to IP.
  service.setCity({ name: '巴黎', latitude: 48.86, longitude: 2.35 });
  service.setCity(null);
  assert.equal(service.getCached(), null);
});

test('IP weather outside China uses wttr.in', async () => {
  const calls = [];
  const logs = [];
  const service = createWeatherService({
    fetch: async (url) => {
      calls.push(url);
      if (url.startsWith(IP_LOCATION_URL)) {
        return response({
          success: true,
          city: 'Los Angeles',
          country_code: 'US',
          latitude: 34.05,
          longitude: -118.24
        });
      }
      return response(wttrBody('18', undefined, 'Clear'));
    },
    logger: {
      info: (message) => logs.push('info:' + message),
      warn: (message) => logs.push('warn:' + message)
    }
  });

  const result = await service.get();
  assert.equal(result.text, 'Los Angeles · Clear · 18°C');
  assert.equal(calls.length, 2);
  assert.ok(calls[1].startsWith(WTTR_ENDPOINT));
  assert.ok(calls[1].includes('34.05,-118.24'));
  assert.ok(logs.includes('info:天气位置=IP：Los Angeles'));
  assert.ok(logs.includes('info:天气来源=wttr.in'));
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

test('weather service caches results and failures for 30 minutes', async () => {
  let clock = 1000;
  const calls = [];
  const logs = [];
  const failing = createWeatherService({
    fetch: async (url) => {
      calls.push(url);
      if (url.startsWith(ITBOY_ENDPOINT)) throw new Error('aborted');
      throw new Error('offline');
    },
    weatherCity: {
      name: '上海',
      latitude: 31.23,
      longitude: 121.47,
      country: 'CN',
      admin1: '上海'
    },
    now: () => clock,
    logger: { warn: (message) => logs.push('warn:' + message) }
  });

  assert.deepEqual(await failing.get(), {
    ok: false,
    text: UNAVAILABLE_TEXT,
    emoji: '🌡️'
  });
  assert.ok(logs.some((line) => line === 'warn:更新失败：offline'));

  assert.deepEqual(await failing.get(), {
    ok: false,
    text: UNAVAILABLE_TEXT,
    emoji: '🌡️'
  });
  assert.equal(calls.length, 2);

  clock += CACHE_TTL_MS;
  await failing.get();
  assert.equal(calls.length, 4);

  const succeeding = createWeatherService({
    fetch: async () => response(itboyBody('8', '多云')),
    weatherCity: {
      name: '上海',
      latitude: 31.23,
      longitude: 121.47,
      country: 'CN',
      admin1: '上海'
    },
    now: () => clock,
    logger: {}
  });
  const first = await succeeding.get();
  const cached = await succeeding.get();
  assert.equal(cached.text, first.text);
  assert.deepEqual(await succeeding.refresh(), first);
});

test('weather service exposes the manual or IP country for quick cities', async () => {
  assert.deepEqual(
    countryFromIpData({ success: true, country: 'China', country_code: 'cn' }),
    { country: 'China', countryCode: 'CN' }
  );
  assert.deepEqual(countryFromIpData({ success: false }), {
    country: '',
    countryCode: ''
  });
  assert.deepEqual(countryFromIpData(null), { country: '', countryCode: '' });

  const manual = createWeatherService({
    fetch: async () => {
      throw new Error('manual city must not request IP');
    },
    weatherCity: {
      name: '东京',
      latitude: 35.68,
      longitude: 139.69,
      country: '日本',
      admin1: '东京都'
    },
    logger: {}
  });
  assert.deepEqual(await manual.getCountry(), { country: '日本', countryCode: '' });

  const calls = [];
  const automatic = createWeatherService({
    fetch: async (url) => {
      calls.push(url);
      assert.ok(url.startsWith(IP_LOCATION_URL));
      return response({
        success: true,
        city: '上海',
        country: 'China',
        country_code: 'CN',
        latitude: 31.23,
        longitude: 121.47
      });
    },
    logger: {}
  });
  assert.deepEqual(await automatic.getCountry(), {
    country: 'China',
    countryCode: 'CN'
  });
  // The resolved IP country is kept, so opening the picker again does not
  // trigger another ipwho.is request.
  assert.deepEqual(await automatic.getCountry(), {
    country: 'China',
    countryCode: 'CN'
  });
  assert.equal(calls.length, 1);

  const offline = createWeatherService({
    fetch: async () => {
      throw new Error('offline');
    },
    logger: {}
  });
  assert.deepEqual(await offline.getCountry(), { country: '', countryCode: '' });
});
