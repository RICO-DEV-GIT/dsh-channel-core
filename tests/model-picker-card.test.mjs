import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelPickerCard, readModelPickerAction, conversationalModels, providersOf,
  modelOptionsOf, pageCountOf, pageOfModel, PAGE_SIZE, INCLUDE_PROBE,
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
const selectOf = card => formOf(card).elements.find(element => element.tag === 'select_static');
const formButtons = card => formOf(card).elements.filter(element => element.tag === 'button');
const pagerOf = card => (card.body.elements.find(element => element.tag === 'column_set')?.columns ?? [])
  .flatMap(column => column.elements ?? []);

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

test('the probe is off and the card asks to be updatable', () => {
  assert.equal(INCLUDE_PROBE, false, 'diagnostics are done');
  const card = buildModelPickerCard({ catalog: many });
  assert.deepEqual(card.config, { wide_screen_mode: true, update_multi: true });
});

test('one page keeps a single form: select + 切换, no pager when it all fits', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } });
  assert.equal(card.body.elements.filter(element => element.tag === 'form').length, 1);
  assert.deepEqual(formButtons(card).map(button => button.text.content), ['切换']);
  assert.equal(selectOf(card).options.length, 4);
  assert.equal(pagerOf(card).length, 0);
  assert.match(card.body.elements[0].content, /当前模型：\*\*opencode-go\/deepseek-v4\.1-flash\*\*/);
});

test('the select shows no initial option; the header states the real model', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'ark', model: 'doubao-snapshot-pro' } });
  assert.equal(selectOf(card).initial_index, 0);
  assert.equal(selectOf(card).required, false);
  assert.match(card.body.elements[0].content, /\*\*ark\/doubao-snapshot-pro\*\*/);
  assert.equal(selectOf(card).options[0].value, 'ark/doubao-snapshot-pro', 'the current model is listed first');
});

test('paging is one row of buttons outside the form; first page has no 上一页, last none 下一页', () => {
  const first = buildModelPickerCard({ catalog: many });
  assert.deepEqual(pagerOf(first).map(button => button.text.content), ['下一页 →']);
  assert.equal(formButtons(first).length, 1, 'the form still only holds 切换');

  const middle = buildModelPickerCard({ catalog: many, page: 1 });
  assert.deepEqual(pagerOf(middle).map(button => button.text.content), ['← 上一页', '下一页 →']);
  const columns = middle.body.elements.find(element => element.tag === 'column_set').columns;
  assert.equal(columns.length, 2, 'both buttons share one row');
  assert.deepEqual(columns.map(column => column.elements.length), [1, 1]);

  const last = buildModelPickerCard({ catalog: many, page: LAST_PAGE });
  assert.deepEqual(pagerOf(last).map(button => button.text.content), ['← 上一页']);
  assert.equal(pagerOf(last).some(button => /下一页/.test(button.text.content)), false, 'a button that leads nowhere is not rendered');
});

test('pager buttons carry the page and are not form submits', () => {
  const middle = buildModelPickerCard({ catalog: many, page: 1 });
  const tokens = pagerOf(middle).map(button => button.behaviors[0].value.dsh);
  assert.deepEqual(tokens, ['dsh:model:page:0', 'dsh:model:page:2']);
  for (const button of pagerOf(middle)) {
    assert.equal(button.form_action_type, undefined, 'outside the form, so no submit behaviour');
    assert.equal(button.behaviors[0].type, 'callback');
  }
});

test('a long list pages ten at a time and never loses a model', () => {
  assert.equal(PAGE_SIZE, 10);
  assert.equal(pageCountOf(many), Math.ceil(45 / PAGE_SIZE));
  const seen = new Set();
  for (let page = 0; page < pageCountOf(many); page += 1) {
    for (const option of selectOf(buildModelPickerCard({ catalog: many, page })).options) seen.add(option.value);
  }
  assert.equal(seen.size, 45, 'every model appears exactly once');
  assert.equal(selectOf(buildModelPickerCard({ catalog: many, page: LAST_PAGE })).options.length, 45 - LAST_PAGE * PAGE_SIZE);
});

test('page tokens must be digits', () => {
  assert.deepEqual(readModelPickerAction({ token: 'dsh:model:page:2' }), { kind: 'page', page: 2, provider: '' });
  for (const token of ['dsh:model:page:-1', 'dsh:model:page:x', 'dsh:model:page:1.5', 'dsh:model:page:', 'dsh:model:page']) {
    assert.equal(readModelPickerAction({ token }), null, token);
  }
});

test('a switch lands on the page holding the chosen model', () => {
  assert.equal(pageOfModel(many, 'ark/model-0'), 0);
  assert.equal(pageOfModel(many, 'ark/model-25'), 2);
  assert.equal(pageOfModel(many, 'ark/model-44'), 4);
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
