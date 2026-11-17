'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const CSS = fs.readFileSync(
  path.join(__dirname, '..', 'electron', 'renderer', 'calendar.css'),
  'utf8'
).replace(/\/\*[\s\S]*?\*\//g, '');

const HIDDEN = ['#almanac-customize', '#clock-edit', '.weather-change'];
const SHOWN = [
  '.almanac-card:hover #almanac-customize',
  '.almanac-card:focus-within #almanac-customize',
  '.world-clock-card:hover #clock-edit',
  '.world-clock-card:focus-within #clock-edit',
  '.weather-card:hover .weather-change',
  '.weather-card:focus-visible .weather-change'
];

function rules() {
  return [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selectorText, body]) => ({
    selectors: selectorText
      .split(',')
      .map((selector) => selector.trim().replace(/\s+/g, ' '))
      .filter(Boolean),
    body: body.trim()
  }));
}

const allRules = rules();

function findRule(predicate) {
  const matches = allRules.filter(predicate);
  assert.equal(matches.length, 1, 'expected exactly one matching CSS rule');
  return matches[0];
}

test('card entries are hidden by default without changing layout', () => {
  const hidden = findRule(
    (rule) =>
      /(?:^|;)\s*opacity:\s*0(?:;|$)/.test(rule.body) &&
      /(?:^|;)\s*pointer-events:\s*none(?:;|$)/.test(rule.body)
  );

  assert.deepEqual([...hidden.selectors].sort(), [...HIDDEN].sort());
  assert.match(hidden.body, /transition:\s*opacity\s+120ms/);
  assert.equal(/display:\s*none/.test(hidden.body), false);
  assert.equal(/visibility:\s*hidden/.test(hidden.body), false);
});

test('each card reveals only its own entry on hover or focus', () => {
  const shown = findRule(
    (rule) =>
      /(?:^|;)\s*opacity:\s*1(?:;|$)/.test(rule.body) &&
      /(?:^|;)\s*pointer-events:\s*auto(?:;|$)/.test(rule.body)
  );

  assert.deepEqual([...shown.selectors].sort(), [...SHOWN].sort());
});

test('footer 检查更新 stays visible and outside the hide rule', () => {
  const hidden = findRule(
    (rule) =>
      /(?:^|;)\s*opacity:\s*0(?:;|$)/.test(rule.body) &&
      /(?:^|;)\s*pointer-events:\s*none(?:;|$)/.test(rule.body)
  );

  assert.equal(hidden.selectors.some((selector) => selector.includes('.pane-check-update')), false);
  assert.equal(
    allRules.some(
      (rule) =>
        rule.selectors.some((selector) => selector.includes('.pane-check-update')) &&
        /opacity:\s*0(?:[;\s]|$)/.test(rule.body)
    ),
    false
  );
});
