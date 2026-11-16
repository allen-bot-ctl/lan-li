'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { formatVersionLabel } = require('../electron/app-version');

test('formatVersionLabel adds a single lowercase v prefix', () => {
  assert.equal(formatVersionLabel('0.1.5'), 'v0.1.5');
});

test('formatVersionLabel normalizes an existing v/V prefix without duplicating it', () => {
  assert.equal(formatVersionLabel('v0.1.5'), 'v0.1.5');
  assert.equal(formatVersionLabel('V0.1.5'), 'v0.1.5');
});

test('formatVersionLabel trims surrounding whitespace', () => {
  assert.equal(formatVersionLabel(' 0.1.5 '), 'v0.1.5');
  assert.equal(formatVersionLabel('\t v0.1.5 \n'), 'v0.1.5');
});

test('formatVersionLabel degrades to an empty string for empty or invalid input', () => {
  assert.equal(formatVersionLabel(''), '');
  assert.equal(formatVersionLabel('   '), '');
  assert.equal(formatVersionLabel(null), '');
  assert.equal(formatVersionLabel(undefined), '');
  assert.equal(formatVersionLabel(0), '');
  assert.equal(formatVersionLabel({}), '');
  assert.equal(formatVersionLabel('版本'), '');
  assert.equal(formatVersionLabel('v'), '');
});

test('formatVersionLabel never throws', () => {
  const inputs = [null, undefined, 0, {}, [], () => {}, Symbol('v0.1.5')];
  for (const input of inputs) {
    assert.doesNotThrow(() => formatVersionLabel(input), String(input));
  }
});
