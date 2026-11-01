import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelPickerCard, PAGE_SIZE } from '../lib/model-picker-card.js';

/**
 * Compliance check for the model card against the documented card JSON 2.0 rules.
 *
 * Every rule below cites where it comes from; this exists because a single out-of-range
 * table column width ('30px', documented range 80–600) made Feishu reject the whole card
 * with `format_error`, and /model silently fell back to text.
 *
 * Docs: 卡片 JSON 2.0 结构 / 组件概述 / 表单容器 / 分栏 / 按钮 / 下拉选择-单选 / 表格.
 */

const CARDS = {
  'single page': { catalog: { groups: [{ id: 'p', models: [{ id: 'a' }, { id: 'b' }] }] }, page: 0 },
  'first page': { catalog: { groups: [{ id: 'p', models: Array.from({ length: 30 }, (_, i) => ({ id: 'm-' + i })) }] }, page: 0 },
  'middle page': { catalog: { groups: [{ id: 'p', models: Array.from({ length: 30 }, (_, i) => ({ id: 'm-' + i })) }] }, page: 2 },
  'last page': { catalog: { groups: [{ id: 'p', models: Array.from({ length: 30 }, (_, i) => ({ id: 'm-' + i })) }] }, page: 4 },
  'mixed providers': {
    catalog: { groups: [
      { id: 'go', models: [{ id: 'flash' }, { id: 'pro' }] },
      { id: 'ark', models: Array.from({ length: 20 }, (_, i) => ({ id: 'k-' + i })) },
    ] },
    page: 1,
  },
  // The checker layout has its own component set (checker rows + a form holding a
  // column_set of pager buttons), so it needs its own compliance fixtures.
  'checker: first page': { catalog: { groups: [{ id: 'p', models: Array.from({ length: 30 }, (_, i) => ({ id: 'm-' + i })) }] }, page: 0, mode: 'checker' },
  'checker: middle page with a tick': { catalog: { groups: [{ id: 'p', models: Array.from({ length: 30 }, (_, i) => ({ id: 'm-' + i })) }] }, page: 1, mode: 'checker', picked: 'p/m-2' },
  'checker: tiny catalog, page size 4': { catalog: { groups: [{ id: 'p', models: [{ id: 'a' }] }] }, page: 0, mode: 'checker', pageSize: 4 },
};

// Documented enums.
const TEMPLATES = ['blue', 'wathet', 'turquoise', 'green', 'yellow', 'orange', 'red', 'carmine', 'violet', 'purple', 'indigo', 'grey', 'default'];
const BUTTON_TYPES = ['default', 'primary', 'danger', 'text', 'primary_text', 'danger_text', 'primary_filled', 'danger_filled', 'laser'];
const BUTTON_SIZES = ['tiny', 'small', 'medium', 'large'];
const FLEX_MODES = ['none', 'stretch', 'flow', 'bisect', 'trisect'];
const DATA_TYPES = ['text', 'lark_md', 'options', 'number', 'persons', 'date', 'markdown'];
const SPACINGS = ['small', 'medium', 'large', 'extra_large'];

const CONFIG_KEYS = ['streaming_mode', 'streaming_config', 'summary', 'locales', 'enable_forward', 'update_multi', 'width_mode', 'use_custom_translation', 'enable_forward_interaction', 'style'];
const TOP_KEYS = ['schema', 'config', 'card_link', 'header', 'body'];
const HEADER_KEYS = ['title', 'subtitle', 'text_tag_list', 'i18n_text_tag_list', 'template', 'icon', 'padding'];
const BODY_KEYS = ['direction', 'padding', 'horizontal_spacing', 'horizontal_align', 'vertical_spacing', 'vertical_align', 'elements'];

const ALLOWED_KEYS = {
  markdown: ['tag', 'element_id', 'margin', 'content', 'text_size', 'text_align', 'icon'],
  table: ['tag', 'element_id', 'margin', 'page_size', 'row_height', 'row_max_height', 'freeze_first_column', 'header_style', 'columns', 'rows'],
  form: ['tag', 'element_id', 'direction', 'margin', 'padding', 'horizontal_spacing', 'horizontal_align', 'vertical_align', 'vertical_spacing', 'name', 'elements'],
  column_set: ['tag', 'element_id', 'margin', 'horizontal_spacing', 'horizontal_align', 'flex_mode', 'background_style', 'columns'],
  column: ['tag', 'element_id', 'background_style', 'width', 'weight', 'horizontal_spacing', 'horizontal_align', 'vertical_align', 'vertical_spacing', 'direction', 'padding', 'margin', 'elements'],
  button: ['tag', 'element_id', 'margin', 'type', 'size', 'width', 'text', 'icon', 'hover_tips', 'disabled', 'disabled_tips', 'confirm', 'behaviors', 'name', 'form_action_type'],
  select_static: ['tag', 'element_id', 'margin', 'type', 'name', 'required', 'disabled', 'initial_option', 'initial_index', 'placeholder', 'width', 'behaviors', 'options', 'confirm'],
  // 勾选器：文档字段见 checker.md（name 仅表单内必填；behaviors 仅支持 callback）。
  checker: ['tag', 'element_id', 'name', 'checked', 'text', 'overall_checkable', 'button_area', 'checked_style', 'margin', 'padding', 'confirm', 'behaviors'],
};

const isPx = (value, min, max) => /^\d+px$/.test(String(value)) && Number.parseInt(value, 10) >= min && Number.parseInt(value, 10) <= max;

/** Count components and text elements: a card allows at most 200. */
function countNodes(elements = []) {
  let total = 0;
  for (const node of elements) {
    total += 1;
    if (node.tag === 'column_set') {
      for (const column of node.columns ?? []) total += 1 + countNodes(column.elements ?? []);
    } else if (Array.isArray(node.elements)) {
      total += countNodes(node.elements);
    }
  }
  return total;
}

function checkCard(card, where) {
  const problems = [];
  const fail = message => problems.push(where + ': ' + message);

  // Top level: 卡片 JSON 2.0 结构.
  assert.equal(card.schema, '2.0', where + ': schema must be 2.0');
  for (const key of Object.keys(card)) if (!TOP_KEYS.includes(key)) fail('unknown top-level key ' + key);

  // config: update_multi is documented; 2.0 only accepts true. width_mode enum.
  for (const key of Object.keys(card.config ?? {})) if (!CONFIG_KEYS.includes(key)) fail('unknown config key ' + key);
  if (card.config?.update_multi !== true) fail('config.update_multi must be true');
  if (card.config?.width_mode !== undefined && !['default', 'compact', 'fill'].includes(card.config.width_mode)) fail('config.width_mode invalid');
  if (card.config?.enable_forward !== undefined && typeof card.config.enable_forward !== 'boolean') fail('config.enable_forward must be boolean');

  // header: title required; template enum.
  for (const key of Object.keys(card.header ?? {})) if (!HEADER_KEYS.includes(key)) fail('unknown header key ' + key);
  if (!card.header?.title) fail('header.title missing');
  if (!['plain_text', 'lark_md'].includes(card.header?.title?.tag)) fail('header.title.tag invalid');
  if (!card.header?.title?.content) fail('header.title.content empty');
  if (!TEMPLATES.includes(card.header?.template)) fail('header.template not in enum: ' + card.header?.template);

  // body: documented keys only, elements array.
  for (const key of Object.keys(card.body ?? {})) if (!BODY_KEYS.includes(key)) fail('unknown body key ' + key);
  if (!Array.isArray(card.body?.elements)) fail('body.elements missing');

  const walk = (elements, path, depth, inForm) => {
    if (!Array.isArray(elements)) return fail(path + ' is not an array');
    if (depth > 5) fail('nesting deeper than 5 levels');
    const names = new Set();
    for (const [index, node] of elements.entries()) {
      const at = path + '[' + index + '](' + node?.tag + ')';
      if (!ALLOWED_KEYS[node?.tag]) { fail(at + ' unknown component'); continue; }
      // Unknown fields are the silent killers: Feishu answers format_error.
      for (const key of Object.keys(node)) if (!ALLOWED_KEYS[node.tag].includes(key)) fail(at + ' unknown field ' + key);
      if (node.element_id !== undefined && !/^[A-Za-z][A-Za-z0-9_]{0,19}$/.test(node.element_id)) fail(at + ' element_id invalid');
      if (inForm && (node.tag === 'table' || node.tag === 'form')) fail(at + ' not allowed inside a form');
      if (inForm && node.name !== undefined) {
        if (names.has(node.name)) fail(at + ' duplicate form name ' + node.name);
        names.add(node.name);
      }

      if (node.tag === 'markdown') {
        if (typeof node.content !== 'string' || !node.content) fail(at + ' markdown content empty');
      } else if (node.tag === 'checker') {
        if (!node.text || !['plain_text', 'lark_md'].includes(node.text.tag)) fail(at + ' checker.text must be plain_text/lark_md');
        if (typeof node.text?.content !== 'string' || !node.text.content) fail(at + ' checker.text.content empty');
        if (node.checked !== undefined && typeof node.checked !== 'boolean') fail(at + ' checker.checked must be boolean');
        if (node.overall_checkable !== undefined && typeof node.overall_checkable !== 'boolean') fail(at + ' overall_checkable must be boolean');
        // 勾选器只支持 callback 交互；未配置 behaviors 时点击仅本地有效。
        if (!Array.isArray(node.behaviors) || !node.behaviors.length) fail(at + ' checker without behaviors');
        for (const behavior of node.behaviors ?? []) {
          if (behavior?.type !== 'callback') fail(at + ' checker only supports callback behaviors');
          if (typeof behavior.value !== 'object' || behavior.value === null) fail(at + ' checker callback value must be an object');
        }
        if (node.confirm !== undefined) {
          if (!node.confirm?.title?.content || !node.confirm?.text?.content) fail(at + ' checker.confirm needs title and text');
        }
      } else if (node.tag === 'button') {
        if (!node.text || node.text.tag !== 'plain_text') fail(at + ' button.text must be plain_text');
        if (String(node.text?.content ?? '').length > 100) fail(at + ' button text over 100 chars');
        if (node.type !== undefined && !BUTTON_TYPES.includes(node.type)) fail(at + ' button.type invalid');
        if (node.size !== undefined && !BUTTON_SIZES.includes(node.size)) fail(at + ' button.size invalid');
        if (node.width !== undefined && !(node.width === 'default' || node.width === 'fill' || isPx(node.width, 100, 10000))) fail(at + ' button.width invalid');
        if (!Array.isArray(node.behaviors) || !node.behaviors.length) fail(at + ' button without behaviors');
        for (const behavior of node.behaviors ?? []) {
          if (!['open_url', 'callback'].includes(behavior?.type)) fail(at + ' behavior.type invalid');
          if (behavior?.type === 'callback' && (typeof behavior.value !== 'object' || behavior.value === null)) fail(at + ' callback value must be an object');
          if (behavior?.type === 'open_url' && !behavior.default_url && !(behavior.pc_url && behavior.ios_url && behavior.android_url)) fail(at + ' open_url needs default_url or all three platform urls');
        }
        if (inForm) {
          if (!node.name) fail(at + ' form button needs name');
          if (!['submit', 'reset'].includes(node.form_action_type)) fail(at + ' form button needs form_action_type');
        } else if (node.form_action_type !== undefined) {
          fail(at + ' form_action_type outside a form');
        }
      } else if (node.tag === 'select_static') {
        if (node.type !== undefined && !['default', 'text'].includes(node.type)) fail(at + ' select.type invalid');
        if (node.width !== undefined && !(node.width === 'default' || node.width === 'fill' || isPx(node.width, 100, 10000))) fail(at + ' select.width invalid');
        if (node.placeholder !== undefined && node.placeholder.tag !== 'plain_text') fail(at + ' select.placeholder must be plain_text');
        if (!Array.isArray(node.options) || !node.options.length) fail(at + ' select.options empty');
        const values = new Set();
        for (const option of node.options ?? []) {
          if (option?.text?.tag !== 'plain_text' || !option.text.content) fail(at + ' option text must be plain_text');
          if (typeof option?.value !== 'string' || !option.value) fail(at + ' option value must be a non-empty string');
          if (values.has(option?.value)) fail(at + ' duplicate option value ' + option?.value);
          values.add(option?.value);
        }
        if (node.initial_option !== undefined && !values.has(node.initial_option)) fail(at + ' initial_option not in options');
        if (node.initial_index !== undefined && (!Number.isInteger(node.initial_index) || node.initial_index < 0)) fail(at + ' initial_index invalid');
        if (inForm && !node.name) fail(at + ' form select needs name');
      } else if (node.tag === 'table') {
        if (depth > 1) fail(at + ' table must be at the card root');
        if (!Number.isInteger(node.page_size) || node.page_size < 1 || node.page_size > 10) fail(at + ' table.page_size must be 1..10');
        const rowHeightOk = ['low', 'middle', 'high', 'auto'].includes(node.row_height) || isPx(node.row_height, 32, 124);
        if (!rowHeightOk) fail(at + ' table.row_height invalid: ' + node.row_height);
        if (node.row_max_height !== undefined && !isPx(node.row_max_height, 32, 999)) fail(at + ' table.row_max_height invalid');
        if (node.freeze_first_column !== undefined && typeof node.freeze_first_column !== 'boolean') fail(at + ' freeze_first_column must be boolean');
        if (!Array.isArray(node.columns) || !node.columns.length) fail(at + ' table.columns empty');
        if ((node.columns ?? []).length > 50) fail(at + ' table.columns over 50');
        const keys = new Set();
        for (const column of node.columns ?? []) {
          for (const key of Object.keys(column)) {
            if (!['name', 'display_name', 'width', 'data_type', 'horizontal_align', 'vertical_align', 'format', 'date_format'].includes(key)) fail(at + ' unknown column field ' + key);
          }
          if (!column?.name) fail(at + ' column without name');
          keys.add(column?.name);
          if (!DATA_TYPES.includes(column?.data_type)) fail(at + ' column.data_type invalid');
          const width = String(column?.width ?? 'auto');
          // Documented: auto | percentage | 80–600px. '30px' is what broke the card.
          if (!(width === 'auto' || /^\d+%$/.test(width) || isPx(width, 80, 600))) fail(at + ' column.width out of range: ' + width);
          if (column?.horizontal_align !== undefined && !['left', 'center', 'right'].includes(column.horizontal_align)) fail(at + ' column.horizontal_align invalid');
        }
        if (!Array.isArray(node.rows)) fail(at + ' table.rows must be an array');
        if ((node.rows ?? []).length > node.page_size) fail(at + ' table rows exceed page_size');
        for (const row of node.rows ?? []) {
          for (const key of Object.keys(row)) if (!keys.has(key)) fail(at + ' row has undeclared column ' + key);
        }
      } else if (node.tag === 'form') {
        if (depth > 1) fail(at + ' form must be at the card root');
        if (!node.name) fail(at + ' form needs name');
        const buttons = (node.elements ?? []).filter(child => child?.tag === 'button');
        if (!buttons.some(button => button.form_action_type === 'submit')) fail(at + ' form needs a submit button');
        walk(node.elements ?? [], at + '.elements', depth + 1, true);
      } else if (node.tag === 'column_set') {
        if (node.flex_mode !== undefined && !FLEX_MODES.includes(node.flex_mode)) fail(at + ' flex_mode invalid');
        if (!Array.isArray(node.columns) || !node.columns.length) fail(at + ' column_set needs columns');
        for (const [ci, column] of (node.columns ?? []).entries()) {
          if (column?.tag !== 'column') fail(at + '.columns[' + ci + '] tag must be column');
          for (const key of Object.keys(column ?? {})) if (!ALLOWED_KEYS.column.includes(key)) fail(at + ' unknown column_set column field ' + key);
          walk(column?.elements ?? [], at + '.columns[' + ci + '].elements', depth + 2, inForm);
        }
      }
    }
  };
  walk(card.body?.elements ?? [], 'body.elements', 1, false);

  // Global limits: 200 elements per card, card JSON well under 30 KB.
  const nodes = countNodes(card.body?.elements ?? []);
  if (nodes > 200) fail('card has ' + nodes + ' elements (limit 200)');
  const bytes = Buffer.byteLength(JSON.stringify(card), 'utf8');
  if (bytes > 30 * 1024) fail('card JSON is ' + bytes + ' bytes (limit 30 KB)');

  return problems;
}

for (const [name, fixture] of Object.entries(CARDS)) {
  test('card is compliant with the platform schema: ' + name, () => {
    const card = buildModelPickerCard({
      catalog: fixture.catalog,
      page: fixture.page,
      selected: { provider: 'p', model: 'a' },
      mode: fixture.mode,
      picked: fixture.picked,
      pageSize: fixture.pageSize,
    });
    assert.ok(card, name + ': card was not built');
    const problems = checkCard(card, name);
    assert.deepEqual(problems, [], problems.join('\n'));
  });
}

test('the rules catch the defect that broke the card', () => {
  const card = buildModelPickerCard({ catalog: CARDS['first page'].catalog });
  card.body.elements.find(element => element.tag === 'table').columns[0].width = '30px';
  assert.match(checkCard(card, 'regression').join('\n'), /column\.width out of range: 30px/);
});

test('the rules catch an unknown config field', () => {
  const card = buildModelPickerCard({ catalog: CARDS['first page'].catalog });
  card.config.wide_screen_mode = true;
  assert.match(checkCard(card, 'regression').join('\n'), /unknown config key wide_screen_mode/);
});

test('the card never mixes more models into one page than the table allows', () => {
  const card = buildModelPickerCard({ catalog: { groups: [{ id: 'p', models: Array.from({ length: 99 }, (_, i) => ({ id: 'm-' + i })) }] } });
  assert.equal(card.body.elements.find(element => element.tag === 'table').rows.length, PAGE_SIZE);
});
