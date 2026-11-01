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
const formOf = card => card.body.elements.find(element => element.tag === 'form');
const selectOf = card => formOf(card).elements.find(element => element.tag === 'select_static');
const buttonsOf = card => formOf(card).elements.filter(element => element.tag === 'button');
const pagerOf = card => selectOf(card).options.filter(option => option.value.startsWith(PAGE_PREFIX));

test('non-chat models are filtered out of the picker', () => {
  const ark = providersOf(catalog).find(group => group.id === 'ark');
  assert.deepEqual(ark.models.map(entry => entry.id), ['deepseek-v4-flash-260425', 'doubao-snapshot-pro']);
  assert.equal(conversationalModels([{ id: 'doubao-embedding' }]).length, 1);
});

test('one page is one form: one select, one button, no paging when it all fits', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } });
  assert.equal(card.body.elements.filter(element => element.tag === 'form').length, 1);
  assert.deepEqual(buttonsOf(card).map(button => button.text.content), ['切换']);
  assert.equal(selectOf(card).options.length, 4);
  assert.equal(pagerOf(card).length, 0, 'no pager options on a single page');
  assert.match(card.body.elements[0].content, /当前模型：\*\*opencode-go\/deepseek-v4\.1-flash\*\*/);
});

test('the current model is listed first, because the phone collapses the dropdown onto it', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'ark', model: 'doubao-snapshot-pro' } });
  assert.equal(selectOf(card).options[0].value, 'ark/doubao-snapshot-pro');
  assert.equal(selectOf(card).options.length, 4, 'reordering must not duplicate it');
});

test('paging lives inside the dropdown, as the last options', () => {
  const first = buildModelPickerCard({ catalog: many });
  assert.deepEqual(pagerOf(first).map(option => option.value), [PAGE_PREFIX + '1'], 'first page offers only 下一页');
  assert.match(pagerOf(first)[0].text.content, /下一页/);
  const middle = buildModelPickerCard({ catalog: many, page: 1 });
  assert.deepEqual(pagerOf(middle).map(option => option.value), [PAGE_PREFIX + '2', PAGE_PREFIX + '0'], 'next, then previous');
  const last = buildModelPickerCard({ catalog: many, page: 2 });
  assert.deepEqual(pagerOf(last).map(option => option.value), [PAGE_PREFIX + '1'], 'last page offers only 上一页');
  assert.equal(selectOf(first).options.length, PAGE_SIZE + 1, '20 models plus the pager entry');
});

test('a long list pages twenty at a time and never loses a model', () => {
  assert.equal(pageCountOf(many), 3);
  assert.equal(selectOf(buildModelPickerCard({ catalog: many })).options.filter(o => !o.value.startsWith(PAGE_PREFIX)).length, PAGE_SIZE);
  const seen = new Set();
  for (let page = 0; page < pageCountOf(many); page += 1) {
    for (const option of selectOf(buildModelPickerCard({ catalog: many, page })).options) {
      if (!option.value.startsWith(PAGE_PREFIX)) seen.add(option.value);
    }
  }
  assert.equal(seen.size, 45, 'every model appears exactly once');
  assert.equal(selectOf(buildModelPickerCard({ catalog: many, page: 2 })).options.filter(o => !o.value.startsWith(PAGE_PREFIX)).length, 5);
});

test('a pager option turns the page instead of switching a model', () => {
  assert.deepEqual(readModelPickerAction({ token: 'dsh:model:apply', values: { dsh_model: PAGE_PREFIX + '2' } }), { kind: 'page', page: 2, provider: '' });
  assert.deepEqual(
    readModelPickerAction({ token: 'dsh:model:apply', values: { dsh_model: 'ark/doubao-snapshot-pro' } }),
    { kind: 'apply', model: 'ark/doubao-snapshot-pro', provider: 'ark' },
  );
  assert.equal(readModelPickerAction({ values: { dsh_model: PAGE_PREFIX + '-1' } }), null, 'a negative page is refused');
  assert.equal(readModelPickerAction({ values: { dsh_model: PAGE_PREFIX + 'x' } }), null);
  assert.equal(readModelPickerAction({ token: 'dsh:answer:1' }), null);
});

test('a switch lands on the page holding the chosen model', () => {
  assert.equal(pageOfModel(many, 'ark/model-0'), 0);
  assert.equal(pageOfModel(many, 'ark/model-25'), 1);
  assert.equal(pageOfModel(many, 'ark/model-44'), 2);
  assert.equal(pageOfModel(many, 'ark/missing'), 0);
});

test('an empty catalog produces no card so the caller can fall back to text', () => {
  assert.equal(buildModelPickerCard({ catalog: { groups: [] } }), null);
  assert.equal(buildModelPickerCard({}), null);
});
