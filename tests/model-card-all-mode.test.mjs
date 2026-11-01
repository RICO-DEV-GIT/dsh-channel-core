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
// C 布局：下拉与「切换」并排放在表单内的分栏里。
const selectOf = card => {
  const form = formOf(card);
  if (!form) return undefined;
  const direct = form.elements.find(element => element.tag === 'select_static');
  if (direct) return direct;
  return (form.elements.find(element => element.tag === 'column_set')?.columns ?? [])
    .flatMap(column => column.elements ?? [])
    .find(element => element.tag === 'select_static');
};

test('every model is in one dropdown, with 切换 beside it and no pager', () => {
  const card = buildModelPickerCard({ catalog: catalogOf(135), mode: 'all' });
  const select = selectOf(card);
  assert.ok(select, 'the card holds a dropdown');
  assert.equal(select.options.length, 135, 'all models, no paging');
  assert.equal(card.body.elements.some(element => element.tag === 'checker'), false);
  // 下拉与 切换 并排一行（C 布局），表单里只有一个 column_set。
  assert.deepEqual(formOf(card).elements.map(element => element.tag), ['column_set'], '一行：下拉 + 切换');
  const row = formOf(card).elements[0].columns.flatMap(column => column.elements);
  assert.deepEqual(row.map(element => element.tag), ['select_static', 'button']);
  assert.equal(row[1].text.content, '切换');
  assert.equal(select.required, false, 'required would block the submit button');
  assert.equal(select.initial_index, 0, 'the box must not pretend an option was chosen');
  assert.equal(select.width, 'fill', 'the dropdown takes the column width');
});

test('the card has no title bar and keeps the current-model line and the footer', () => {
  const card = buildModelPickerCard({ catalog: catalogOf(20), mode: 'all', selected: { provider: 'ark', model: 'x' } });
  assert.equal(card.header, undefined, '标题「切换模型」已删除');
  assert.match(card.body.elements[0].content, /当前模型：\*\*ark\/x\*\*/);
  assert.match(card.body.elements.at(-1).content, /共 20 个可对话模型/);
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
