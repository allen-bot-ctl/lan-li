'use strict';

// Weather helpers and the main-process service. The pure helpers (WMO code
// mapping, city selection, coordinate validation and result formatting) can be
// required directly by `node --test`. All network access goes through an
// injected `fetch`; tests never touch the real network.

const IP_LOCATION_URL = 'https://ipwho.is/';
const REVERSE_GEOCODE_ENDPOINT =
  'https://api.bigdatacloud.net/data/reverse-geocode-client';
const FORECAST_ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
const GEOCODING_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

const USER_AGENT = 'LanLi (+https://allen-bot-ctl.github.io/lan-li/)';
const CACHE_TTL_MS = 30 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const UNAVAILABLE_TEXT = '天气暂不可用';

// WMO weather interpretation codes used by Open-Meteo.
const WEATHER_CODE_TEXT = Object.freeze({
  0: '晴',
  1: '晴间多云',
  2: '多云',
  3: '阴',
  45: '雾',
  48: '雾',
  51: '毛毛雨',
  53: '毛毛雨',
  55: '毛毛雨',
  56: '冻毛毛雨',
  57: '冻毛毛雨',
  61: '小雨',
  63: '中雨',
  65: '大雨',
  66: '冻雨',
  67: '冻雨',
  71: '小雪',
  73: '中雪',
  75: '大雪',
  77: '雪',
  80: '阵雨',
  81: '阵雨',
  82: '强阵雨',
  85: '阵雪',
  86: '阵雪',
  95: '雷暴',
  96: '雷暴冰雹',
  99: '雷暴冰雹'
});

function unavailableWeather() {
  return { ok: false, text: UNAVAILABLE_TEXT };
}

function describeWeatherCode(code) {
  if (code === null || code === undefined || code === '') return '未知';
  const value = Number(code);
  if (!Number.isInteger(value)) return '未知';
  return WEATHER_CODE_TEXT[value] || '未知';
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function pickCityName(data) {
  if (!data || typeof data !== 'object') return '';
  return textValue(data.city) ||
    textValue(data.locality) ||
    textValue(data.principalSubdivision);
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
  return { coordinates, city: pickIpCity(data) };
}

function normalizeWeatherCity(value) {
  if (!value || typeof value !== 'object') return null;
  const name = textValue(value.name);
  const coordinates = normalizeCoordinates(value);
  if (!name || !coordinates) return null;
  return {
    name,
    latitude: coordinates.latitude,
    longitude: coordinates.longitude
  };
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
// ipwho.is request or a reverse-geocode lookup.
function resolveWeatherLocation(manualCity, ipData) {
  const manual = normalizeWeatherCity(manualCity);
  if (manual) {
    return {
      source: 'manual',
      coordinates: {
        latitude: manual.latitude,
        longitude: manual.longitude
      },
      city: manual.name
    };
  }

  const ip = parseIpLocation(ipData);
  if (!ip) return null;
  return { source: 'ip', coordinates: ip.coordinates, city: ip.city };
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

function formatWeatherResult(input) {
  const source = input && typeof input === 'object' ? input : {};
  const temperature = finiteNumber(
    source.temperature !== undefined ? source.temperature : source.temperature_2m
  );
  if (temperature === null) return unavailableWeather();

  const weatherCode =
    source.weatherCode !== undefined ? source.weatherCode : source.weather_code;
  const weather = describeWeatherCode(weatherCode);
  const city = textValue(source.city) || '当前位置';
  const temperatureText = `${Math.round(temperature)}°C`;

  return {
    ok: true,
    city,
    weather,
    temperature: Math.round(temperature),
    temperatureText,
    text: `${city} · ${weather} · ${temperatureText}`
  };
}

function buildReverseGeocodeUrl(latitude, longitude) {
  const coordinates = normalizeCoordinates({ latitude, longitude });
  if (!coordinates) return '';
  return `${REVERSE_GEOCODE_ENDPOINT}` +
    `?latitude=${encodeURIComponent(coordinates.latitude)}` +
    `&longitude=${encodeURIComponent(coordinates.longitude)}` +
    '&localityLanguage=zh';
}

function buildForecastUrl(latitude, longitude) {
  const coordinates = normalizeCoordinates({ latitude, longitude });
  if (!coordinates) return '';
  return `${FORECAST_ENDPOINT}` +
    `?latitude=${encodeURIComponent(coordinates.latitude)}` +
    `&longitude=${encodeURIComponent(coordinates.longitude)}` +
    '&current=temperature_2m,weather_code&timezone=auto';
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
    if (!location) throw new Error('IP 定位未返回有效坐标');
    return location;
  }

  async function lookupCity(coordinates) {
    const url = buildReverseGeocodeUrl(coordinates.latitude, coordinates.longitude);
    if (!url) return '';
    const data = await fetchJson(url);
    return pickCityName(data);
  }

  async function load() {
    const requestGeneration = generation;
    const location = await locate();
    if (requestGeneration !== generation) return null;

    let city = location.city;
    if (!city && location.source === 'ip') {
      try {
        city = await lookupCity(location.coordinates);
      } catch (error) {
        log('warn', '城市名获取失败：' + describeError(error));
      }
      if (requestGeneration !== generation) return null;
    }

    log('info', describeWeatherLocation({ source: location.source, city }));

    const data = await fetchJson(
      buildForecastUrl(location.coordinates.latitude, location.coordinates.longitude)
    );
    if (requestGeneration !== generation) return null;
    const current = data && data.current && typeof data.current === 'object'
      ? data.current
      : {};
    const result = formatWeatherResult({
      city,
      temperature: current.temperature_2m,
      weatherCode: current.weather_code
    });
    if (!result.ok) throw new Error('天气数据不完整');
    return result;
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
  REVERSE_GEOCODE_ENDPOINT,
  FORECAST_ENDPOINT,
  GEOCODING_ENDPOINT,
  USER_AGENT,
  CACHE_TTL_MS,
  REQUEST_TIMEOUT_MS,
  UNAVAILABLE_TEXT,
  WEATHER_CODE_TEXT,
  unavailableWeather,
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
};
