'use strict';

// Offline quick city list for the weather picker. The packaged JSON groups
// cities by ISO 3166-1 alpha-2 country code and carries the Chinese country
// name returned by Open-Meteo geocoding. `findQuickCities` also accepts the
// English country name / country_code returned by ipwho.is so the picker can
// resolve the current IP country without another lookup table.
//
// This module is pure (only reads its packaged JSON) and can be required by
// `node --test` directly.

const fs = require('node:fs');
const path = require('node:path');

const QUICK_CITIES_PATH = path.join(__dirname, 'data', 'quick-cities.json');

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
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

function loadQuickCities() {
  try {
    const parsed = JSON.parse(fs.readFileSync(QUICK_CITIES_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch {
    return {};
  }
}

const QUICK_CITIES = loadQuickCities();

function normalizeCountryValue(value) {
  return textValue(value).toLowerCase();
}

function findCountryCode(country) {
  const needle = normalizeCountryValue(country);
  if (!needle) return '';

  for (const [code, group] of Object.entries(QUICK_CITIES)) {
    if (!group || typeof group !== 'object') continue;
    if (code.toLowerCase() === needle) return code;
    if (normalizeCountryValue(group.country) === needle) return code;
    const aliases = Array.isArray(group.aliases) ? group.aliases : [];
    if (aliases.some((alias) => normalizeCountryValue(alias) === needle)) {
      return code;
    }
  }
  return '';
}

function normalizeQuickCity(value, country) {
  if (!value || typeof value !== 'object') return null;
  const name = textValue(value.name);
  const latitude = finiteNumber(value.latitude);
  const longitude = finiteNumber(value.longitude);
  if (!name || latitude === null || longitude === null) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (longitude < -180 || longitude > 180) return null;

  const normalized = {
    name,
    latitude,
    longitude,
    country: textValue(value.country) || country
  };
  const admin1 = textValue(value.admin1);
  if (admin1) normalized.admin1 = admin1;
  return normalized;
}

// Returns `{ code, country, cities }` for a country code, Chinese country name
// or ipwho.is country name, or null when the country is not in the list.
function findQuickCities(country) {
  const code = findCountryCode(country);
  if (!code) return null;

  const group = QUICK_CITIES[code];
  const countryName = textValue(group.country);
  const cities = (Array.isArray(group.cities) ? group.cities : [])
    .map((city) => normalizeQuickCity(city, countryName))
    .filter(Boolean);

  return { code, country: countryName, cities };
}

function cityBaseName(value) {
  const name = textValue(value);
  return name.endsWith('市') ? name.slice(0, -1) : name;
}

// A saved city came from Open-Meteo, so its name is usually identical. Keep a
// small tolerance for names such as 北京市 and coordinates from the same city.
function sameCity(left, right) {
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  const leftName = textValue(left.name);
  const rightName = textValue(right.name);
  if (leftName && rightName) {
    if (leftName === rightName) return true;
    if (cityBaseName(leftName) === cityBaseName(rightName)) return true;
  }

  const leftLatitude = finiteNumber(left.latitude);
  const leftLongitude = finiteNumber(left.longitude);
  const rightLatitude = finiteNumber(right.latitude);
  const rightLongitude = finiteNumber(right.longitude);
  if (leftLatitude === null || leftLongitude === null ||
      rightLatitude === null || rightLongitude === null) {
    return false;
  }
  return Math.abs(leftLatitude - rightLatitude) < 0.05 &&
    Math.abs(leftLongitude - rightLongitude) < 0.05;
}

module.exports = {
  QUICK_CITIES_PATH,
  loadQuickCities,
  findCountryCode,
  findQuickCities,
  sameCity
};
