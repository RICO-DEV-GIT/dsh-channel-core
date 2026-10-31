import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelPickerCard, readModelPickerAction, conversationalModels, providersOf, OPTIONS_PER_PAGE } from '../lib/model-picker-card.js';

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

test('the card offers a provider select and a model select for the current provider', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' } });
  const forms = card.body.elements.filter(element => element.tag === 'form');
  assert.equal(forms.length, 2);
  const providerSelect = forms[0].elements[0];
  assert.equal(providerSelect.name, 'dsh_provider');
  assert.deepEqual(providerSelect.options.map(entry => entry.value), ['opencode-go', 'ark']);
  const modelSelect = forms[1].elements[0];
  assert.equal(modelSelect.name, 'dsh_model');
  assert.deepEqual(modelSelect.options.map(entry => entry.value), ['opencode-go/deepseek-v4.1-flash', 'opencode-go/deepseek-v4-pro']);
  assert.equal(modelSelect.initial_option, 'opencode-go/deepseek-v4.1-flash');
  assert.match(card.body.elements[0].content, /当前模型：\*\*opencode-go \/ deepseek-v4\.1-flash\*\*/);
});

test('choosing another provider lists that provider models', () => {
  const card = buildModelPickerCard({ catalog, selected: { provider: 'opencode-go', model: 'deepseek-v4.1-flash' }, provider: 'ark' });
  const modelSelect = card.body.elements.find(element => element.tag === 'form' && element.name === 'dsh_model_pick').elements[0];
  assert.deepEqual(modelSelect.options.map(entry => entry.value), ['ark/deepseek-v4-flash-260425', 'ark/doubao-snapshot-pro']);
  assert.equal(modelSelect.initial_option, undefined, 'the previous selection is not offered by this provider');
});

test('long provider lists page instead of overflowing the select', () => {
  const many = { groups: [{ id: 'ark', models: Array.from({ length: OPTIONS_PER_PAGE * 2 + 3 }, (_, index) => ({ id: 'model-' + index })) }] };
  const first = buildModelPickerCard({ catalog: many, selected: {} });
  const select = first.body.elements.find(element => element.tag === 'form' && element.name === 'dsh_model_pick');
  assert.equal(select.elements[0].options.length, OPTIONS_PER_PAGE);
  const next = select.elements.find(element => element.name === 'dsh_page_next');
  assert.equal(next.behaviors[0].value.dsh, 'dsh:model:page:1');
  const third = buildModelPickerCard({ catalog: many, selected: {}, page: 2 });
  const thirdSelect = third.body.elements.find(element => element.tag === 'form' && element.name === 'dsh_model_pick');
  assert.equal(thirdSelect.elements[0].options.length, 3);
  assert.equal(thirdSelect.elements.find(element => element.name === 'dsh_page_next'), undefined);
  assert.ok(thirdSelect.elements.find(element => element.name === 'dsh_page_prev'));
});

test('an empty catalog produces no card so the caller can fall back to text', () => {
  assert.equal(buildModelPickerCard({ catalog: { groups: [] } }), null);
  assert.equal(buildModelPickerCard({}), null);
});

test('submissions map back to an intent', () => {
  assert.deepEqual(readModelPickerAction({ token: 'dsh:model:provider', values: { dsh_provider: 'ark' } }), { kind: 'provider', provider: 'ark' });
  assert.deepEqual(
    readModelPickerAction({ token: 'dsh:model:apply', values: { dsh_provider: 'ark', dsh_model: 'ark/x' } }),
    { kind: 'apply', provider: 'ark', model: 'ark/x' },
  );
  assert.deepEqual(readModelPickerAction({ token: 'dsh:model:page:2', values: { dsh_provider: 'ark' } }), { kind: 'page', provider: 'ark', page: 2 });
  assert.equal(readModelPickerAction({ token: 'dsh:answer:1' }), null);
  assert.equal(readModelPickerAction({ token: 'dsh:model:page:not-a-number' }), null);
  assert.equal(readModelPickerAction({}), null);
});
