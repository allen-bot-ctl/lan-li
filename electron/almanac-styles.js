'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SCHEMA_VERSION = 1;
const VOCABULARY_COUNT = 114;
const DEFAULT_STYLE_ID = 'lunar';

// Display metadata is fixed here so a damaged or unreadable style file can
// still show its own name, badge and colours while falling back to identity
// mapping. `map` is only supplied by the packaged JSON files.
const STYLE_DEFINITIONS = [
  {
    id: 'lunar',
    name: '农历黄历',
    tagline: '传统宜忌，原样呈现',
    badge: '历',
    accent: { light: '#C92A2A', dark: '#FF6B6B' }
  },
  {
    id: 'coder',
    name: '程序猿黄历',
    tagline: '把宜忌翻译成码农日常',
    badge: '码',
    accent: { light: '#7048E8', dark: '#9775FA' }
  },
  {
    id: 'worker',
    name: '打工人黄历',
    tagline: '职场宜忌，摸鱼有据',
    badge: '工',
    accent: { light: '#E67700', dark: '#FFA94D' }
  },
  {
    id: 'student',
    name: '学生党黄历',
    tagline: '自习刷题，看天行事',
    badge: '学',
    accent: { light: '#1971C2', dark: '#4DABF7' }
  },
  {
    id: 'fitness',
    name: '健身党黄历',
    tagline: '练还是歇，黄历说了算',
    badge: '练',
    accent: { light: '#2B8A3E', dark: '#51CF66' }
  }
];

const STYLE_IDS = STYLE_DEFINITIONS.map((style) => style.id);

function isStyleId(value) {
  return typeof value === 'string' && STYLE_IDS.includes(value);
}

function normalizeStyleId(value) {
  return isStyleId(value) ? value : DEFAULT_STYLE_ID;
}

function readAlmanacStyle(preferences) {
  const source = preferences && typeof preferences === 'object' ? preferences : {};
  return normalizeStyleId(source.almanacStyle);
}

function styleDefinition(id) {
  const styleId = normalizeStyleId(id);
  return STYLE_DEFINITIONS.find((style) => style.id === styleId);
}

function warn(logger, message) {
  if (logger && typeof logger.warn === 'function') {
    logger.warn(message);
  }
}

function readStyleMap(style, directory, logger) {
  if (style.id === 'lunar') return {};

  const file = path.join(directory, `${style.id}.json`);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || parsed.schemaVersion !== SCHEMA_VERSION) {
      warn(logger, `[栏历] 黄历风格 ${style.id}：schemaVersion 不是 ${SCHEMA_VERSION}，按原词显示。`);
      return {};
    }
    if (parsed.id !== style.id) {
      warn(logger, `[栏历] 黄历风格 ${style.id}：文件 id 与文件名不符，按原词显示。`);
      return {};
    }
    return parsed.map && typeof parsed.map === 'object' && !Array.isArray(parsed.map)
      ? parsed.map
      : {};
  } catch (error) {
    const reason = error && error.message ? error.message : String(error);
    warn(logger, `[栏历] 黄历风格 ${style.id}：读取失败（${reason}），按原词显示。`);
    return {};
  }
}

// Reads all five styles once at startup. A style that cannot be loaded keeps
// its constant metadata and uses the lunar identity map.
function createStyleCatalog(options = {}) {
  const directory = typeof options.directory === 'string' && options.directory
    ? options.directory
    : path.join(__dirname, 'data', 'almanac-styles');
  const logger = options.logger;

  const styles = new Map();
  for (const definition of STYLE_DEFINITIONS) {
    styles.set(definition.id, {
      definition,
      map: readStyleMap(definition, directory, logger)
    });
  }

  return {
    get(id) {
      return styles.get(normalizeStyleId(id));
    },
    list(selectedId) {
      const selected = normalizeStyleId(selectedId);
      return STYLE_DEFINITIONS.map((definition) => ({
        id: definition.id,
        name: definition.name,
        tagline: definition.tagline,
        badge: definition.badge,
        accentLight: definition.accent.light,
        accentDark: definition.accent.dark,
        selected: definition.id === selected
      }));
    }
  };
}

// Resolves one term through a style map. Missing keys and non-string/empty
// values fall back to the original term.
function mapTerm(term, map) {
  const table = map && typeof map === 'object' ? map : {};
  const mapped = Object.prototype.hasOwnProperty.call(table, term) ? table[term] : undefined;
  return typeof mapped === 'string' && mapped.length > 0 ? mapped : term;
}

// Maps each term, then de-duplicates by mapped text, keeping first occurrence.
// `labels` pairs every kept display text with its original term, while `title`
// joins those pairs for the legacy full-list tooltip. `items` holds display
// text only for the card's compact fields.
function mapAlmanacTerms(terms, map) {
  const source = Array.isArray(terms) ? terms : [];
  const seen = new Set();
  const items = [];
  const labels = [];

  for (const term of source) {
    const text = mapTerm(term, map);
    if (seen.has(text)) continue;
    seen.add(text);
    items.push(text);
    labels.push(`${text}（${term}）`);
  }

  return { items, labels, title: labels.join(' ') };
}

module.exports = {
  SCHEMA_VERSION,
  VOCABULARY_COUNT,
  DEFAULT_STYLE_ID,
  STYLE_DEFINITIONS,
  STYLE_IDS,
  isStyleId,
  normalizeStyleId,
  readAlmanacStyle,
  styleDefinition,
  createStyleCatalog,
  mapTerm,
  mapAlmanacTerms
};
