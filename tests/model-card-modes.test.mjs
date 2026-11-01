import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelPickerCard, readModelPickerAction, PAGE_SIZE } from '../lib/model-picker-card.js';

/**
 * The two card layouts live side by side on this branch:
 *   dropdown — the earlier single-select layout (paging entries inside the list);
 *   checker  — no dropdown at all, one tickable row per model, pager on one row.
 */

const catalog = { groups: [{ id: 'p', models: Array.from({ length: 30 }, (_, i) => ({ id: 'm-' + i, name: 'M' + i })) }] };
const checkerRows = card => card.body.elements.filter(element => element.tag === 'checker');
const formOf = card => card.body.elements.find(element => element.tag === 'form');
const bodyTags = card => card.body.elements.map(element => element.tag);

test('the dropdown layout is still available', () => {
  const card = buildModelPickerCard({ catalog, mode: 'dropdown', page: 0 });
  const form = formOf(card);
  assert.equal(form.elements.some(element => element.tag === 'select_static'), true, 'the dropdown select is inside the form');
  assert.equal(checkerRows(card).length, 0);
});

test('the checker layout has no dropdown and one tickable row per model', () => {
  const card = buildModelPickerCard({ catalog, mode: 'checker', page: 0 });
  assert.equal(card.body.elements.some(element => element.tag === 'select_static'), false, 'no dropdown to cover the pager');
  assert.equal(card.body.elements.some(element => element.tag === 'table'), false);
  assert.equal(checkerRows(card).length, 6);
  for (const row of checkerRows(card)) {
    assert.equal(row.behaviors[0].type, 'callback');
    assert.equal(typeof row.behaviors[0].value.model, 'string');
    assert.equal(typeof row.checked, 'boolean');
  }
});

test('the pager sits on one row inside the form, next to 切换', () => {
  const card = buildModelPickerCard({ catalog, mode: 'checker', page: 1 });
  const form = formOf(card);
  assert.deepEqual(form.elements.map(element => element.tag), ['column_set', 'button']);
  const pager = form.elements[0].columns.flatMap(column => column.elements);
  assert.deepEqual(pager.map(node => node.text.content), ['← 上一页', '下一页 →']);
  assert.equal(form.elements[0].flex_mode, 'bisect', 'two buttons share one row');
  assert.equal(form.elements[1].text.content, '切换');
});

test('first page has no 上一页 and the last page no 下一页', () => {
  const labels = card => (formOf(card).elements[0]?.columns ?? []).flatMap(column => column.elements).map(node => node.text.content);
  assert.deepEqual(labels(buildModelPickerCard({ catalog, mode: 'checker', page: 0 })), ['下一页 →']);
  assert.deepEqual(labels(buildModelPickerCard({ catalog, mode: 'checker', page: 4 })), ['← 上一页']);
});

test('a ticked model is shown, counted and confirmed before it is replaced', () => {
  const card = buildModelPickerCard({ catalog, mode: 'checker', page: 0, picked: 'p/m-1' });
  assert.match(card.body.elements[1].content, /已选模型：\*\*p\/m-1\*\*/);
  assert.equal(checkerRows(card).filter(row => row.checked).length, 1, 'exactly one row is ticked');
  assert.equal(checkerRows(card).find(row => row.checked).behaviors[0].value.model, 'p/m-1');
  // Every other row asks before replacing the tick.
  assert.equal(checkerRows(card).filter(row => row.confirm).length, checkerRows(card).length - 1);
  assert.match(checkerRows(card).find(row => row.confirm).confirm.text.content, /当前已选 p\/m-1，确定改选/);
});

test('a tick on another page is still reported with its page number', () => {
  const card = buildModelPickerCard({ catalog, mode: 'checker', page: 3, picked: 'p/m-1' });
  assert.match(card.body.elements[1].content, /（第 1\/5 页）/);
  assert.equal(checkerRows(card).filter(row => row.checked).length, 0, 'not on this page');
});

test('page size is configurable and clamped to 4..10', () => {
  assert.equal(checkerRows(buildModelPickerCard({ catalog, mode: 'checker', pageSize: 4 })).length, 4);
  assert.equal(checkerRows(buildModelPickerCard({ catalog, mode: 'checker', pageSize: 10 })).length, 10);
  assert.equal(checkerRows(buildModelPickerCard({ catalog, mode: 'checker', pageSize: 2 })).length, 4, 'below the floor');
  assert.equal(checkerRows(buildModelPickerCard({ catalog, mode: 'checker', pageSize: 99 })).length, 10, 'above the ceiling');
  assert.equal(checkerRows(buildModelPickerCard({ catalog, mode: 'checker' })).length, PAGE_SIZE);
});

test('a checker tap reads as a pick with its model', () => {
  const card = buildModelPickerCard({ catalog, mode: 'checker', page: 0 });
  const row = checkerRows(card)[2];
  const action = readModelPickerAction({ token: row.behaviors[0].value.dsh, value: row.behaviors[0].value, checked: true });
  assert.deepEqual(action, { kind: 'pick', model: 'p/m-2', provider: 'p', checked: true });
  const untick = readModelPickerAction({ token: row.behaviors[0].value.dsh, value: row.behaviors[0].value, checked: false });
  assert.equal(untick.checked, false);
  assert.equal(readModelPickerAction({ token: 'dsh:model:pick', value: {} }), null, 'a pick without a model is refused');
});

test('the pager buttons still read as page intents in checker mode', () => {
  const card = buildModelPickerCard({ catalog, mode: 'checker', page: 1 });
  const pager = formOf(card).elements[0].columns.flatMap(column => column.elements);
  const next = readModelPickerAction({ token: pager[1].behaviors[0].value.dsh });
  assert.deepEqual(next, { kind: 'page', page: 2, provider: '' });
});
