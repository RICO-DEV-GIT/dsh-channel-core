import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelPickerCard, readModelPickerAction, MODEL_CARD_JSON_LIMIT } from '../lib/model-picker-card.js';

/**
 * 全量下拉：every model in one searchable list, no paging, 切换 kept so a stray tap
 * cannot change the Session.
 */

const catalogOf = count => ({
  groups: [
    { id: 'deepseek-account', models: Array.from({ length: Math.min(count, 12) }, (_, i) => ({ id: 'deepseek-v4-pro-' + i })) },
    { id: 'ark', models: Array.from({ length: Math.max(0, count - Math.min(count, 12)) }, (_, i) => ({ id: 'doubao-1-5-pro-256k-250115-' + String(i).padStart(3, '0') })) },
  ],
});

const formOf = card => card.body.elements.find(element => element.tag === 'form');
const selectOf = card => formOf(card)?.elements?.find?.(element => element.tag === 'select_static');

test('every model is in one dropdown, with 切换 and no pager', () => {
  const card = buildModelPickerCard({ catalog: catalogOf(135), mode: 'all' });
  const select = selectOf(card);
  assert.ok(select, 'the card holds a dropdown');
  assert.equal(select.options.length, 135, 'all models, no paging');
  assert.equal(card.body.elements.some(element => element.tag === 'checker'), false);
  assert.equal(card.body.elements.some(element => element.tag === 'column_set'), false, 'no pager row');
  assert.deepEqual(formOf(card).elements.map(element => element.tag), ['select_static', 'button']);
  assert.equal(formOf(card).elements[1].text.content, '切换');
  assert.equal(select.required, false, 'required would block the submit button');
  assert.equal(select.initial_index, 0, 'the box must not pretend an option was chosen');
});

test('the dropdown says how many models it holds', () => {
  const card = buildModelPickerCard({ catalog: catalogOf(135), mode: 'all' });
  assert.match(selectOf(card).placeholder.content, /135 个，可搜索/);
});

test('a picked model reads as an apply intent', () => {
  const card = buildModelPickerCard({ catalog: catalogOf(20), mode: 'all' });
  const value = selectOf(card).options[3].value;
  const action = readModelPickerAction({ token: 'dsh:model:apply', values: { dsh_model: value } });
  assert.equal(action.kind, 'apply');
  // The intent keeps the full "provider/model" string; the caller splits it once.
  assert.equal(action.model, value);
  assert.equal(action.provider, value.slice(0, value.indexOf('/')));
});

test('the card stays under the platform JSON limit, and falls back when it cannot', () => {
  const fits = buildModelPickerCard({ catalog: catalogOf(200), mode: 'all' });
  assert.ok(selectOf(fits), '200 models still fit');
  assert.ok(Buffer.byteLength(JSON.stringify(fits), 'utf8') < MODEL_CARD_JSON_LIMIT);

  const overflow = buildModelPickerCard({ catalog: catalogOf(400), mode: 'all' });
  assert.equal(selectOf(overflow), undefined, 'too large: falls back to the paged checker layout');
  assert.ok(overflow.body.elements.some(element => element.tag === 'checker'), 'checker rows instead');
  assert.ok(Buffer.byteLength(JSON.stringify(overflow), 'utf8') < MODEL_CARD_JSON_LIMIT);
});

test('the other two layouts are still reachable', () => {
  const paged = buildModelPickerCard({ catalog: catalogOf(30), mode: 'dropdown' });
  assert.ok(selectOf(paged).options.some(option => option.value.startsWith('__dsh_page:')), 'paged dropdown keeps its pager entries');
  const checker = buildModelPickerCard({ catalog: catalogOf(30), mode: 'checker' });
  assert.equal(checker.body.elements.filter(element => element.tag === 'checker').length, 6);
});
