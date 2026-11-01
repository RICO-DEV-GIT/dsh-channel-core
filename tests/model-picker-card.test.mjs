import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelPickerCard, readModelPickerAction, conversationalModels, providersOf, modelOptionsOf, MAX_OPTIONS } from '../lib/model-picker-card.js';

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

test('non-chat models are filtered out of the picker', () => {
  const ark = providersOf(catalog).find(group => group.id === 'ark');
  assert.deepEqual(ark.models.map(entry => entry.id), ['deepseek-v4-flash-260425', 'doubao-snapshot-pro']);
  // A provider with only non-chat models keeps them rather than disappearing.
  assert.equal(conversationalModels([{ id: 'doubao-embedding' }]).length, 1);
});

test('the card is one form with one select holding every conversational model', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } });
  const forms = card.body.elements.filter(element => element.tag === 'form');
  assert.equal(forms.length, 1, 'a single form keeps the card simple');
  const select = forms[0].elements[0];
  assert.equal(select.tag, 'select_static');
  assert.equal(select.name, 'dsh_model');
  assert.deepEqual(select.options.map(option => option.value), [
    'opencode-go/deepseek-v4.1-flash',
    'opencode-go/deepseek-v4-pro',
    'ark/deepseek-v4-flash-260425',
    'ark/doubao-snapshot-pro',
  ]);
  assert.equal(select.initial_option, 'opencode-go/deepseek-v4.1-flash');
  assert.match(card.body.elements[0].content, /当前模型：\*\*opencode-go\/deepseek-v4\.1-flash\*\*/);
  assert.match(card.body.elements.at(-1).content, /共 4 个可对话模型/);
});

test('every model is listed, not just the first provider', () => {
  const values = modelOptionsOf(catalog).map(option => option.value);
  assert(values.includes('ark/doubao-snapshot-pro'));
  assert(values.includes('opencode-go/deepseek-v4-pro'));
});

test('a long list stays in the one select, with no page buttons', () => {
  const many = { groups: [{ id: 'ark', models: Array.from({ length: 40 }, (_, index) => ({ id: 'model-' + index })) }] };
  const card = buildModelPickerCard({ catalog: many, selected: {} });
  const form = card.body.elements.find(element => element.tag === 'form');
  assert.equal(form.elements[0].options.length, 40, 'every model is offered in the dropdown');
  assert.equal(form.elements.filter(element => element.name?.startsWith('dsh_page')).length, 0, 'paging was the source of "操作太繁忙"');
});

test('beyond the option cap the list is trimmed but the current model stays', () => {
  const many = { groups: [{ id: 'ark', models: Array.from({ length: MAX_OPTIONS + 20 }, (_, index) => ({ id: 'model-' + index })) }] };
  const last = 'ark/model-' + (MAX_OPTIONS + 10);
  const card = buildModelPickerCard({ catalog: many, selected: { provider: 'ark', model: 'model-' + (MAX_OPTIONS + 10) } });
  const form = card.body.elements.find(element => element.tag === 'form');
  assert.equal(form.elements[0].options.length, MAX_OPTIONS);
  assert.ok(form.elements[0].options.some(option => option.value === last), 'the current model is never dropped');
  assert.match(card.body.elements.at(-1).content, /其余用 \/model 提供方\/模型ID 切换/);
});

test('the switch button posts the chosen model back as a callback', () => {
  const card = buildModelPickerCard({ catalog, selected: {} });
  const form = card.body.elements.find(element => element.tag === 'form');
  const apply = form.elements.find(element => element.name === 'dsh_model_apply');
  assert.equal(apply.form_action_type, 'submit');
  assert.equal(apply.behaviors[0].value.dsh, 'dsh:model:apply');
});

test('an empty catalog produces no card so the caller can fall back to text', () => {
  assert.equal(buildModelPickerCard({ catalog: { groups: [] } }), null);
  assert.equal(buildModelPickerCard({}), null);
});

test('submissions map back to an intent', () => {
  assert.deepEqual(
    readModelPickerAction({ token: 'dsh:model:apply', values: { dsh_model: 'ark/doubao-snapshot-pro' } }),
    { kind: 'apply', model: 'ark/doubao-snapshot-pro', provider: 'ark' },
  );
  assert.equal(readModelPickerAction({ token: 'dsh:model:page:2', values: {} }), null, 'paging no longer exists');
  assert.equal(readModelPickerAction({ token: 'dsh:answer:1' }), null);
  assert.equal(readModelPickerAction({}), null);
});
