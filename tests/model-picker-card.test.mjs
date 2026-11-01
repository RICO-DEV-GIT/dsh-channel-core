import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelPickerCard, readModelPickerAction, conversationalModels, providersOf,
  modelOptionsOf, pageCountOf, pageOfModel, PAGE_SIZE, PAGE_PREFIX,
} from '../lib/model-picker-card.js';

const catalog = {
  groups: [
    { id: 'opencode-go', models: [{ id: 'deepseek-v4.1-flash', name: 'deepseek-v4.1-flash' }, { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro' }] },
    {
      id: 'ark',
      models: [
        { id: 'deepseek-v4-flash-260425', name: 'deepseek-v4-flash' },
        { id: 'doubao-embedding-text-240515', name: 'doubao-embedding' },
        { id: 'doubao-seedream-3-0-t2i', name: 'doubao-seedream' },
        { id: 'doubao-snapshot-pro', name: 'doubao-pro' },
      ],
    },
  ],
};

const many = { groups: [{ id: 'ark', models: Array.from({ length: 45 }, (_, index) => ({ id: 'model-' + index })) }] };
const LAST_PAGE = pageCountOf(many) - 1;

const formOf = card => card.body.elements.find(element => element.tag === 'form');
const tableOf = card => card.body.elements.find(element => element.tag === 'table');
const selectOf = card => formOf(card).elements.find(element => element.tag === 'select_static');
const formButtons = card => formOf(card).elements.filter(element => element.tag === 'button');
/**
 * Pager entries inside the dropdown: their text, in list order. There is no pager outside
 * the form — a button under an open dropdown is dismissed by the tap that closes the list.
 */
const pagerOf = card => selectOf(card).options
  .filter(option => option.value.startsWith(PAGE_PREFIX))
  .map(option => option.text.content);

test('non-chat models are filtered out of the picker', () => {
  const ark = providersOf(catalog).find(group => group.id === 'ark');
  assert.deepEqual(ark.models.map(entry => entry.id), ['deepseek-v4-flash-260425', 'doubao-snapshot-pro']);
  assert.equal(conversationalModels([{ id: 'doubao-embedding' }]).length, 1);
});

test('every model is reachable across pages', () => {
  const values = modelOptionsOf(catalog).map(option => option.value);
  assert(values.includes('ark/doubao-snapshot-pro'));
  assert(values.includes('opencode-go/deepseek-v4-pro'));
});

test('the card asks to be updatable and carries no diagnostics', () => {
  const card = buildModelPickerCard({ catalog: many });
  // Only documented 2.0 config keys: wide_screen_mode belongs to JSON 1.0.
  assert.deepEqual(card.config, { update_multi: true });
  assert.equal(JSON.stringify(card).includes('测试'), false, 'the probe is gone');
});

test('the list is a root-level table of six rows with # and 模型 columns', () => {
  assert.equal(PAGE_SIZE, 6);
  const card = buildModelPickerCard({ catalog: many });
  const table = tableOf(card);
  assert.deepEqual(card.body.elements.map(element => element.tag).slice(0, 2), ['markdown', 'table'], 'the table sits at the card root, before the form');
  assert.equal(table.page_size, 6);
  assert.equal(table.row_height, 'auto', 'long names wrap instead of being clipped');
  assert.deepEqual(table.columns.map(column => column.name), ['index', 'model']);
  assert.equal(table.rows.length, 6);
  assert.deepEqual(table.rows[0], { index: '1', model: 'ark/model-0' });
  assert.deepEqual(table.rows[5], { index: '6', model: 'ark/model-5' });
});

test('the table keeps numbering continuous across pages', () => {
  const second = tableOf(buildModelPickerCard({ catalog: many, page: 1 }));
  assert.deepEqual(second.rows[0], { index: '7', model: 'ark/model-6' });
  const last = tableOf(buildModelPickerCard({ catalog: many, page: LAST_PAGE }));
  assert.equal(last.rows[0].index, String(LAST_PAGE * PAGE_SIZE + 1));
});

test('one page keeps a single form: select + 切换, no pager when it all fits', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } });
  assert.equal(card.body.elements.filter(element => element.tag === 'form').length, 1);
  assert.deepEqual(formButtons(card).map(button => button.text.content), ['切换']);
  assert.equal(selectOf(card).options.length, 4);
  assert.equal(pagerOf(card).length, 0);
  assert.match(card.body.elements[0].content, /当前模型：\*\*opencode-go\/deepseek-v4\.1-flash\*\*/);
});

test('the select holds the table rows plus the pager entries, and shows no initial option', () => {
  const card = buildModelPickerCard({ catalog: many });
  const table = tableOf(card);
  const options = selectOf(card).options;
  assert.deepEqual(options.slice(0, table.rows.length).map(option => option.value), table.rows.map(row => row.model), 'models first, matching the table');
  assert.deepEqual(options.slice(table.rows.length).map(option => option.value), [PAGE_PREFIX + '1'], 'then the pager entries');
  assert.equal(selectOf(card).initial_index, 0);
  assert.equal(selectOf(card).required, false);
});

test('the current model is listed first on its page', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'ark', model: 'doubao-snapshot-pro' } });
  assert.equal(selectOf(card).options[0].value, 'ark/doubao-snapshot-pro');
  assert.equal(selectOf(card).options.filter(option => !option.value.startsWith(PAGE_PREFIX)).length, 4, 'reordering must not duplicate it');
  assert.match(card.body.elements[0].content, /\*\*ark\/doubao-snapshot-pro\*\*/);
});

test('paging is an entry inside the dropdown — nothing outside it', () => {
  const first = buildModelPickerCard({ catalog: many });
  assert.equal(first.body.elements.filter(element => element.tag === 'button').length, 0, 'no button outside the form');
  assert.equal(first.body.elements.filter(element => element.tag === 'column_set').length, 0, 'no pager row');
  assert.equal(first.body.elements.filter(element => element.tag === 'form').length, 1, 'one form: select + 切换');
  assert.equal(formButtons(first).length, 1);
  assert.deepEqual(pagerOf(first), ['▶ 下一页（第 2/8 页）'], JSON.stringify(pagerOf(first)));

  const middle = buildModelPickerCard({ catalog: many, page: 1 });
  assert.deepEqual(pagerOf(middle), ['▶ 下一页（第 3/8 页）', '◀ 上一页（第 1/8 页）'], JSON.stringify(pagerOf(middle)));

  const last = buildModelPickerCard({ catalog: many, page: LAST_PAGE });
  assert.deepEqual(pagerOf(last), ['◀ 上一页（第 7/8 页）'], JSON.stringify(pagerOf(last)));
  assert.equal(pagerOf(last).some(label => /下一页/.test(label)), false, 'a page that leads nowhere is not offered');
});

test('picking a pager entry reads as a page turn, not a model', () => {
  const middle = buildModelPickerCard({ catalog: many, page: 1 });
  const pagerValue = selectOf(middle).options.find(option => option.value.startsWith(PAGE_PREFIX) && /下一页/.test(option.text.content)).value;
  assert.deepEqual(
    readModelPickerAction({ token: 'dsh:model:apply', values: { dsh_model: pagerValue } }),
    { kind: 'page', page: 2, provider: '' },
  );
});

test('paging never loses a model', () => {
  assert.equal(pageCountOf(many), Math.ceil(45 / PAGE_SIZE));
  const seen = new Set();
  for (let page = 0; page < pageCountOf(many); page += 1) {
    for (const option of selectOf(buildModelPickerCard({ catalog: many, page })).options) {
      if (!option.value.startsWith(PAGE_PREFIX)) seen.add(option.value);
    }
  }
  assert.equal(seen.size, 45, 'every model appears exactly once');
  assert.equal(tableOf(buildModelPickerCard({ catalog: many, page: LAST_PAGE })).rows.length, 45 - LAST_PAGE * PAGE_SIZE);
});

test('page tokens must be digits', () => {
  assert.deepEqual(readModelPickerAction({ token: 'dsh:model:page:2' }), { kind: 'page', page: 2, provider: '' });
  for (const token of ['dsh:model:page:-1', 'dsh:model:page:x', 'dsh:model:page:1.5', 'dsh:model:page:', 'dsh:model:page']) {
    assert.equal(readModelPickerAction({ token }), null, token);
  }
});

test('a switch lands on the page holding the chosen model', () => {
  assert.equal(pageOfModel(many, 'ark/model-0'), 0);
  assert.equal(pageOfModel(many, 'ark/model-25'), 4);
  assert.equal(pageOfModel(many, 'ark/model-44'), 7);
  assert.equal(pageOfModel(many, 'ark/missing'), 0);
});

test('applying a model is recognised from the submitted value', () => {
  assert.deepEqual(
    readModelPickerAction({ token: 'dsh:model:apply', values: { dsh_model: 'ark/doubao-snapshot-pro' } }),
    { kind: 'apply', model: 'ark/doubao-snapshot-pro', provider: 'ark' },
  );
  assert.equal(readModelPickerAction({ token: 'dsh:answer:1' }), null);
  assert.equal(readModelPickerAction({}), null);
});

test('an empty catalog produces no card so the caller can fall back to text', () => {
  assert.equal(buildModelPickerCard({ catalog: { groups: [] } }), null);
  assert.equal(buildModelPickerCard({}), null);
});
