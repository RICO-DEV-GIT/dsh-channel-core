import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildModelPickerCard, readModelPickerAction, conversationalModels, providersOf,
  modelOptionsOf, pageCountOf, pageOfModel, PAGE_SIZE,
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
const labels = card => buttonsOf(card).map(button => button.text.content);

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

test('one page is one form: a select plus 切换, and no pager when it all fits', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } });
  assert.equal(card.body.elements.filter(element => element.tag === 'form').length, 1);
  assert.deepEqual(labels(card), ['切换'], 'no pager on a single page');
  assert.equal(selectOf(card).options.length, 4);
  assert.match(card.body.elements[0].content, /当前模型：\*\*opencode-go\/deepseek-v4\.1-flash\*\*/);
});

test('the current model is listed first, because the phone collapses the dropdown onto it', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'ark', model: 'doubao-snapshot-pro' } });
  assert.equal(selectOf(card).options[0].value, 'ark/doubao-snapshot-pro');
  assert.equal(selectOf(card).options.length, 4, 'reordering must not duplicate it');
});

test('paging is done with buttons, never with dropdown entries', () => {
  const first = buildModelPickerCard({ catalog: many });
  assert.deepEqual(labels(first), ['切换', '下一页'], 'first page offers only 下一页');
  const middle = buildModelPickerCard({ catalog: many, page: 1 });
  assert.deepEqual(labels(middle), ['切换', '上一页', '下一页']);
  const last = buildModelPickerCard({ catalog: many, page: 2 });
  assert.deepEqual(labels(last), ['切换', '上一页'], 'last page offers only 上一页');
  // A dropdown entry comes back as a remembered *selection* on the next render, which is
  // what made the card say page 1 while showing "→ 下一页" as the chosen value.
  for (const card of [first, middle, last]) {
    assert.equal(selectOf(card).options.filter(option => !option.value.includes('/')).length, 0);
  }
});

test('a long list pages twenty at a time and never loses a model', () => {
  assert.equal(pageCountOf(many), 3);
  assert.equal(selectOf(buildModelPickerCard({ catalog: many })).options.length, PAGE_SIZE);
  const seen = new Set();
  for (let page = 0; page < pageCountOf(many); page += 1) {
    for (const option of selectOf(buildModelPickerCard({ catalog: many, page })).options) seen.add(option.value);
  }
  assert.equal(seen.size, 45, 'every model appears exactly once');
  assert.equal(selectOf(buildModelPickerCard({ catalog: many, page: 2 })).options.length, 5, 'the last page holds the remainder');
});

test('the pager buttons carry the page in their token', () => {
  const middle = buildModelPickerCard({ catalog: many, page: 1 });
  const tokens = buttonsOf(middle).map(button => button.behaviors[0].value.dsh);
  assert.deepEqual(tokens, ['dsh:model:apply', 'dsh:model:page:0', 'dsh:model:page:2']);
  assert.deepEqual(readModelPickerAction({ token: 'dsh:model:page:2' }), { kind: 'page', page: 2, provider: '' });
});

test('only digit-only page tokens are accepted', () => {
  for (const token of ['dsh:model:page:-1', 'dsh:model:page:x', 'dsh:model:page:1.5', 'dsh:model:page:', 'dsh:model:page']) {
    assert.equal(readModelPickerAction({ token }), null, token + ' must not be read as a page');
  }
});

test('a switch lands on the page holding the chosen model', () => {
  assert.equal(pageOfModel(many, 'ark/model-0'), 0);
  assert.equal(pageOfModel(many, 'ark/model-25'), 1);
  assert.equal(pageOfModel(many, 'ark/model-44'), 2);
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
