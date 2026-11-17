'use strict';

// Weather helpers and the main-process service. The pure helpers (city-code
// table matching, source parsing, city selection, coordinate validation and
// result formatting) can be required directly by `node --test`. All network
// access goes through an injected `fetch`; tests never touch the real network.
//
// Data sources: China cities use the free itboy city API (matched against the
// packaged code table in electron/data/china-city-codes.json); everything else
// (and any itboy failure) falls back to wttr.in. City search still uses the
// Open-Meteo geocoding endpoint, which is reachable where its forecast API is
// not.

const fs = require('node:fs');
const path = require('node:path');

const IP_LOCATION_URL = 'https://ipwho.is/';
const ITBOY_ENDPOINT = 'http://t.weather.itboy.net/api/weather/city/';
const WTTR_ENDPOINT = 'https://wttr.in/';
const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';
const CITY_CODES_PATH = path.join(__dirname, 'data', 'china-city-codes.json');

const USER_AGENT = 'LanLi (+https://allen-bot-ctl.github.io/lan-li/)';
const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const UNAVAILABLE_TEXT = '天气暂不可用';
const CITY_SUFFIXES = ['市', '区', '县'];

function unavailableWeather() {
  return { ok: false, text: UNAVAILABLE_TEXT, emoji: '🌡️' };
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function loadChinaCityCodes() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CITY_CODES_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

const CHINA_CITY_CODES = loadChinaCityCodes();

// Order: exact name → name plus 市/区/县 → name minus those suffixes.
function matchCityCodeInTable(codes, name) {
  const base = textValue(name);
  if (!base) return null;
  if (codes[base]) return { city: base, code: codes[base] };
  for (const suffix of CITY_SUFFIXES) {
    const withSuffix = base + suffix;
    if (codes[withSuffix]) return { city: withSuffix, code: codes[withSuffix] };
  }
  for (const suffix of CITY_SUFFIXES) {
    if (!base.endsWith(suffix)) continue;
    const stripped = base.slice(0, -suffix.length);
    if (stripped && codes[stripped]) {
      return { city: stripped, code: codes[stripped] };
    }
    break;
  }
  return null;
}

function matchChinaCity(name, admin1) {
  return matchCityCodeInTable(CHINA_CITY_CODES, name) ||
    matchCityCodeInTable(CHINA_CITY_CODES, admin1) ||
    null;
}

// Legacy weatherCity entries carry no country; only an exact table hit may
// route them to itboy.
function matchChinaCityExact(name) {
  const base = textValue(name);
  return base && CHINA_CITY_CODES[base]
    ? { city: base, code: CHINA_CITY_CODES[base] }
    : null;
}

function resolveChinaCode(location) {
  if (!location || typeof location !== 'object') return null;
  if (location.source === 'ip') {
    if (!location.isChina) return null;
    return matchChinaCity(location.city, '');
  }
  if (location.country === 'CN' || location.country === '中国') {
    return matchChinaCity(location.city, location.admin1);
  }
  if (!textValue(location.country)) {
    return matchChinaCityExact(location.city);
  }
  return null;
}

function pickIpCity(data) {
  if (!data || typeof data !== 'object' || data.success === false) return '';
  return textValue(data.city);
}

function finiteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeCoordinates(value) {
  if (!value || typeof value !== 'object') return null;
  const latitude = finiteNumber(value.latitude);
  const longitude = finiteNumber(value.longitude);
  if (latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function parseIpLocation(data) {
  if (!data || typeof data !== 'object' || data.success === false) return null;
  const coordinates = normalizeCoordinates(data);
  if (!coordinates) return null;
  return {
    coordinates,
    city: pickIpCity(data),
    isChina: data.country_code === 'CN'
  };
}

// ipwho.is returns both the localized/English country name and the country
// code. Keep both so quick-city matching can prefer the stable code.
function countryFromIpData(data) {
  if (!data || typeof data !== 'object' || data.success === false) {
    return { country: '', countryCode: '' };
  }
  return {
    country: textValue(data.country),
    countryCode: textValue(data.country_code).toUpperCase()
  };
}

function normalizeWeatherCity(value) {
  if (!value || typeof value !== 'object') return null;
  const name = textValue(value.name);
  const coordinates = normalizeCoordinates(value);
  if (!name || !coordinates) return null;
  const normalized = {
    name,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude
  };
  const country = textValue(value.country);
  const admin1 = textValue(value.admin1);
  if (country) normalized.country = country;
  if (admin1) normalized.admin1 = admin1;
  return normalized;
}

function readWeatherCity(preferences) {
  if (!preferences || typeof preferences !== 'object') return null;
  return normalizeWeatherCity(preferences.weatherCity);
}

function writeWeatherCity(preferences, city) {
  const next = preferences && typeof preferences === 'object'
    ? { ...preferences }
    : {};
  const normalized = normalizeWeatherCity(city);
  if (normalized) {
    next.weatherCity = normalized;
  } else {
    delete next.weatherCity;
  }
  return next;
}

// A saved city always wins over IP data, so a manual choice never triggers an
// ipwho.is request.
function resolveWeatherLocation(manualCity, ipData) {
  const manual = normalizeWeatherCity(manualCity);
  if (manual) {
    return {
      source: 'manual',
      coordinates: {
        latitude: manual.latitude,
        longitude: manual.longitude
      },
      city: manual.name,
      country: manual.country || '',
      admin1: manual.admin1 || ''
    };
  }

  const ip = parseIpLocation(ipData);
  if (!ip) return null;
  return { source: 'ip', coordinates: ip.coordinates, city: ip.city, isChina: ip.isChina };
}

function describeWeatherLocation(location) {
  const source = location && location.source === 'manual' ? 'manual' : 'ip';
  const city = location && textValue(location.city);
  const label = city || '当前位置';
  return source === 'manual'
    ? `天气位置=手动：${label}`
    : `天气位置=IP：${label}`;
}

function buildGeocodingUrl(query) {
  const name = textValue(query);
  if (!name) return '';
  return `${GEOCODING_ENDPOINT}` +
    `?name=${encodeURIComponent(name)}` +
    '&count=8&language=zh&format=json';
}

function parseGeocodingResults(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) {
    return [];
  }

  const rows = [];
  for (const item of data.results) {
    if (!item || typeof item !== 'object') continue;
    const name = textValue(item.name);
    const coordinates = normalizeCoordinates(item);
    if (!name || !coordinates) continue;

    const admin1 = textValue(item.admin1);
    const country = textValue(item.country);
    rows.push({
      name,
      admin1,
      country,
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
      label: [name, admin1, country].filter(Boolean).join(' · ')
    });
  }
  return rows;
}

function formatTemperature(value) {
  const temperature = finiteNumber(value);
  if (temperature === null) return '';
  return `${Math.round(temperature)}°C`;
}

// Weather text comes from itboy/wttr.in in Chinese. Match the broader
// phenomena first so 雷阵雨 / 小雨 / 多云转晴 pick the right glyph. Unknown
// text falls back to the thermometer.
const WEATHER_EMOJI = Object.freeze([
  { match: '雷', emoji: '⛈️' },
  { match: '雪', emoji: '❄️' },
  { match: '雨', emoji: '🌧️' },
  { match: '雾', emoji: '🌫️' },
  { match: '阴', emoji: '☁️' },
  { match: '多云', emoji: '⛅️' },
  { match: '晴', emoji: '☀️' }
]);

const FALLBACK_WEATHER_EMOJI = '🌡️';

function weatherEmoji(weather) {
  const text = textValue(weather);
  if (!text) return FALLBACK_WEATHER_EMOJI;
  for (const entry of WEATHER_EMOJI) {
    if (text.includes(entry.match)) return entry.emoji;
  }
  return FALLBACK_WEATHER_EMOJI;
}

function formatWeatherResult(input) {
  const source = input && typeof input === 'object' ? input : {};
  const temperature = finiteNumber(source.temperature);
  if (temperature === null) return unavailableWeather();

  const weather = textValue(source.weather) || '未知';
  const city = textValue(source.city) || '当前位置';
  const temperatureText = `${Math.round(temperature)}°C`;

  return {
    ok: true,
    city,
    weather,
    temperature: Math.round(temperature),
    temperatureText,
    emoji: weatherEmoji(weather),
    text: `${city} · ${weather} · ${temperatureText}`
  };
}

function buildItboyUrl(code) {
  const trimmed = textValue(code);
  if (!trimmed) return '';
  return `${ITBOY_ENDPOINT}${encodeURIComponent(trimmed)}`;
}

function buildWttrUrl(latitude, longitude) {
  const coordinates = normalizeCoordinates({ latitude, longitude });
  if (!coordinates) return '';
  return `${WTTR_ENDPOINT}` +
    `${coordinates.latitude},${coordinates.longitude}?format=j1&lang=zh`;
}

// itboy: data.wendu is the current temperature, data.forecast[0].type is the
// Chinese weather text such as 多云.
function parseItboyWeather(data) {
  if (!data || typeof data !== 'object') return null;
  const payload = data.data && typeof data.data === 'object' ? data.data : null;
  if (!payload) return null;
  const temperature = finiteNumber(payload.wendu);
  if (temperature === null) return null;
  const forecast = Array.isArray(payload.forecast) ? payload.forecast : [];
  const weather = forecast[0] && typeof forecast[0] === 'object'
    ? textValue(forecast[0].type)
    : '';
  return { temperature, weather: weather || '未知' };
}

// wttr.in j1: current_condition[0].temp_C plus lang_zh[0].value, falling back
// to weatherDesc[0].value when the localized list is absent.
function parseWttrWeather(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.current_condition)) {
    return null;
  }
  const current = data.current_condition[0];
  if (!current || typeof current !== 'object') return null;
  const temperature = finiteNumber(current.temp_C);
  if (temperature === null) return null;
  const localized = Array.isArray(current.lang_zh) && current.lang_zh[0]
    ? textValue(current.lang_zh[0].value)
    : '';
  const described = Array.isArray(current.weatherDesc) && current.weatherDesc[0]
    ? textValue(current.weatherDesc[0].value)
    : '';
  return { temperature, weather: localized || described || '未知' };
}

function createWeatherService(options = {}) {
  const fetchFn = options.fetch;
  if (typeof fetchFn !== 'function') {
    throw new TypeError('weather service requires a fetch function');
  }

  const logger = options.logger && typeof options.logger === 'object'
    ? options.logger
    : {};
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const setTimer = typeof options.setTimeout === 'function'
    ? options.setTimeout
    : setTimeout;
  const clearTimer = typeof options.clearTimeout === 'function'
    ? options.clearTimeout
    : clearTimeout;
  const cacheTtlMs = Number.isFinite(options.cacheTtlMs) && options.cacheTtlMs > 0
    ? options.cacheTtlMs
    : CACHE_TTL_MS;
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs
    : REQUEST_TIMEOUT_MS;

  let manualCity = normalizeWeatherCity(options.weatherCity);
  let ipCountry = { country: '', countryCode: '' };
  let cache = null; // { at, result }
  let inFlight = null;
  let generation = 0;

  function log(level, message) {
    const write = logger[level];
    if (typeof write === 'function') write(message);
  }

  async function fetchJson(url) {
    const controller = new AbortController();
    const timer = setTimer(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchFn(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json'
        },
        signal: controller.signal
      });
      if (!response || !response.ok) {
        throw new Error('HTTP ' + (response ? response.status : 'no response'));
      }
      return await response.json();
    } finally {
      clearTimer(timer);
    }
  }

  async function locate() {
    if (manualCity) return resolveWeatherLocation(manualCity, null);

    const data = await fetchJson(IP_LOCATION_URL);
    const location = resolveWeatherLocation(null, data);
    ipCountry = countryFromIpData(data);
    if (!location) throw new Error('IP 定位未返回有效坐标');
    return location;
  }

  // Build the ordered source list for one location: itboy first for China
  // cities found in the code table, wttr.in otherwise; a failed primary falls
  // back to wttr.in when a location can use both.
  function weatherAttempts(location) {
    const chinaCode = resolveChinaCode(location);
    const attempts = [];
    if (chinaCode) {
      attempts.push({
        name: 'itboy',
        url: buildItboyUrl(chinaCode.code),
        parse: parseItboyWeather,
        describe: `天气来源=itboy（${chinaCode.city} ${chinaCode.code}）`
      });
    }
    attempts.push({
      name: 'wttr.in',
      url: buildWttrUrl(location.coordinates.latitude, location.coordinates.longitude),
      parse: parseWttrWeather,
      describe: '天气来源=wttr.in'
    });
    return attempts;
  }

  async function load() {
    const requestGeneration = generation;
    const location = await locate();
    if (requestGeneration !== generation) return null;

    const city = textValue(location.city);
    log('info', describeWeatherLocation(location));

    let lastError = null;
    for (const attempt of weatherAttempts(location)) {
      if (!attempt.url) continue;
      try {
        const data = await fetchJson(attempt.url);
        if (requestGeneration !== generation) return null;
        const parsed = attempt.parse(data);
        if (!parsed) throw new Error('天气数据不完整');
        log('info', attempt.describe);
        const result = formatWeatherResult({ city, ...parsed });
        if (!result.ok) throw new Error('天气数据不完整');
        return result;
      } catch (error) {
        lastError = error;
        if (requestGeneration !== generation) return null;
        log('warn', attempt.name + ' 请求失败：' + describeError(error));
      }
    }
    throw lastError || new Error('天气数据不可用');
  }

  function store(result) {
    cache = { at: now(), result };
    return result;
  }

  function isFresh() {
    return Boolean(cache) && now() - cache.at < cacheTtlMs;
  }

  function get() {
    if (isFresh()) return Promise.resolve(cache.result);
    return request();
  }

  function request() {
    if (inFlight) return inFlight;

    const requestGeneration = generation;
    inFlight = load()
      .then((result) => {
        if (requestGeneration !== generation || !result) return null;
        log('info', '更新成功：' + result.text);
        return store(result);
      })
      .catch((error) => {
        if (requestGeneration !== generation) return null;
        log('warn', '更新失败：' + describeError(error));
        return store(unavailableWeather());
      })
      .finally(() => {
        if (requestGeneration === generation) inFlight = null;
      });
    return inFlight;
  }

  function setCity(city) {
    manualCity = normalizeWeatherCity(city);
    generation += 1;
    cache = null;
    inFlight = null;
    return manualCity;
  }

  // The quick-city list follows the same location source as the weather card:
  // a saved manual city or, when automatic, the last IP geolocation result.
  // With automatic mode and no IP data yet, resolve it once so opening the
  // picker can still show the country's cities.
  async function getCountry() {
    if (manualCity) {
      return { country: manualCity.country || '', countryCode: '' };
    }
    if (!ipCountry.country && !ipCountry.countryCode) {
      try {
        await locate();
      } catch {
        // No country is available; the picker hides the quick-city section.
      }
    }
    return { ...ipCountry };
  }

  async function searchCity(query) {
    const url = buildGeocodingUrl(query);
    if (!url) return [];
    const data = await fetchJson(url);
    return parseGeocodingResults(data);
  }

  // Open-window refresh respects the 30-minute cache; the background timer
  // forces one refresh per interval even when the last fetch was slightly
  // newer than the TTL.
  function refresh(options) {
    const force = Boolean(options && options.force);
    if (!force && isFresh()) return Promise.resolve(cache.result);
    return request();
  }

  return {
    get,
    refresh,
    setCity,
    searchCity,
    getCountry,
    getCached() {
      return cache ? cache.result : null;
    }
  };
}

function describeError(error) {
  return error && error.message ? error.message : String(error);
}

module.exports = {
  IP_LOCATION_URL,
  ITBOY_ENDPOINT,
  WTTR_ENDPOINT,
  GEOCODING_ENDPOINT,
  CITY_CODES_PATH,
  USER_AGENT,
  CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  UNAVAILABLE_TEXT,
  WEATHER_EMOJI,
  FALLBACK_WEATHER_EMOJI,
  loadChinaCityCodes,
  matchChinaCity,
  matchChinaCityExact,
  resolveChinaCode,
  unavailableWeather,
  describeWeatherLocation,
  pickIpCity,
  normalizeCoordinates,
  parseIpLocation,
  countryFromIpData,
  normalizeWeatherCity,
  readWeatherCity,
  writeWeatherCity,
  resolveWeatherLocation,
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
};
