import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelPickerCard, readModelPickerAction, conversationalModels, providersOf, modelOptionsOf, pageCountOf, PAGE_SIZE } from '../lib/model-picker-card.js';

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

const formOf = card => card.body.elements.find(element => element.tag === 'form');
// The pager lives in its own `action` block, outside the form.
const pageButtons = card => (card.body.elements.find(element => element.tag === 'action')?.actions ?? []);

test('non-chat models are filtered out of the picker', () => {
  const ark = providersOf(catalog).find(group => group.id === 'ark');
  assert.deepEqual(ark.models.map(entry => entry.id), ['deepseek-v4-flash-260425', 'doubao-snapshot-pro']);
  assert.equal(conversationalModels([{ id: 'doubao-embedding' }]).length, 1);
});

test('one page is one form with one select and a switch button', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } });
  assert.equal(card.body.elements.filter(element => element.tag === 'form').length, 1);
  const select = formOf(card).elements[0];
  assert.equal(select.tag, 'select_static');
  assert.equal(select.name, 'dsh_model');
  assert.equal(select.options.length, 4, 'all four conversational models fit on one page');
  assert.equal(select.initial_option, 'opencode-go/deepseek-v4.1-flash');
  assert.equal(pageButtons(card).length, 0, 'no paging when everything fits');
  assert.match(card.body.elements.at(-1).content, /共 4 个可对话模型/);
});

test('every model is reachable across pages', () => {
  const values = modelOptionsOf(catalog).map(option => option.value);
  assert(values.includes('ark/doubao-snapshot-pro'));
  assert(values.includes('opencode-go/deepseek-v4-pro'));
});

test('a long list pages twenty at a time', () => {
  const many = { groups: [{ id: 'ark', models: Array.from({ length: 45 }, (_, index) => ({ id: 'model-' + index })) }] };
  assert.equal(pageCountOf(many), 3);
  const first = buildModelPickerCard({ catalog: many });
  assert.equal(formOf(first).elements[0].options.length, PAGE_SIZE);
  assert.deepEqual(pageButtons(first).map(element => element.name), ['dsh_page_next'], 'first page has no 上一页');
  const middle = buildModelPickerCard({ catalog: many, page: 1 });
  assert.deepEqual(pageButtons(middle).map(element => element.name), ['dsh_page_prev', 'dsh_page_next']);
  const last = buildModelPickerCard({ catalog: many, page: 2 });
  assert.equal(formOf(last).elements[0].options.length, 5, 'the last page holds the remainder');
  assert.deepEqual(pageButtons(last).map(element => element.name), ['dsh_page_prev'], 'last page has no 下一页');
});

test('paging never loses a model and does not preselect one from another page', () => {
  const many = { groups: [{ id: 'ark', models: Array.from({ length: 45 }, (_, index) => ({ id: 'model-' + index })) }] };
  const seen = new Set();
  for (let page = 0; page < pageCountOf(many); page += 1) {
    for (const option of formOf(buildModelPickerCard({ catalog: many, page })).elements[0].options) seen.add(option.value);
  }
  assert.equal(seen.size, 45, 'every model appears exactly once across the pages');
  const card = buildModelPickerCard({ catalog: many, page: 0, selected: { provider: 'ark', model: 'model-40' } });
  assert.equal(formOf(card).elements[0].initial_option, undefined, 'a model on another page is not preselected here');
  assert.match(card.body.elements[0].content, /model-40/, 'but the header still names the current model');
});

test('page intent carries the page number; apply carries the model', () => {
  assert.deepEqual(readModelPickerAction({ token: 'dsh:model:page:2' }), { kind: 'page', page: 2, provider: '' });
  assert.deepEqual(
    readModelPickerAction({ token: 'dsh:model:apply', values: { dsh_model: 'ark/doubao-snapshot-pro' } }),
    { kind: 'apply', model: 'ark/doubao-snapshot-pro', provider: 'ark' },
  );
  assert.equal(readModelPickerAction({ token: 'dsh:model:page:not-a-number' }), null);
  assert.equal(readModelPickerAction({ token: 'dsh:answer:1' }), null);
  assert.equal(readModelPickerAction({}), null);
});

test('the switch button posts the chosen model back as a callback', () => {
  const card = buildModelPickerCard({ catalog, selected: {} });
  const apply = formOf(card).elements.find(element => element.name === 'dsh_model_apply');
  assert.equal(apply.form_action_type, 'submit');
  assert.equal(apply.behaviors[0].value.dsh, 'dsh:model:apply');
});

test('an empty catalog produces no card so the caller can fall back to text', () => {
  assert.equal(buildModelPickerCard({ catalog: { groups: [] } }), null);
  assert.equal(buildModelPickerCard({}), null);
});
