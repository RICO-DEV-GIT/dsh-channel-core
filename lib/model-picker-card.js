/**
 * Feishu model-picker card.
 *
 * A phone cannot read a hundred-line model list, so /model renders a card with one
 * select and a switch button. Everything the operator can pick lives in that one
 * select: no page buttons, because each tap costs a card update and Feishu answers
 * rapid callbacks with "操作太繁忙" — paging inside a dropdown was both clunky and
 * the source of that error.
 */

/** Upper bound on options in one select, so the card JSON stays small. */
export const MAX_OPTIONS = 100;

const NON_CHAT = /embedding|rerank|tts|asr|seedream|seedance|seaweed|vision|wan2|i2v|t2v|flf2v|t2i|ui-?tars|character/i;

/** Models that can plausibly hold a conversation, best-effort ordering preserved. */
export function conversationalModels(models) {
  const list = Array.isArray(models) ? models : [];
  const chat = list.filter(entry => !NON_CHAT.test(String(entry.id ?? '')) && !NON_CHAT.test(String(entry.name ?? '')));
  return chat.length ? chat : list;
}

export function providersOf(catalog) {
  const groups = Array.isArray(catalog?.groups) ? catalog.groups : [];
  return groups
    .map(group => ({ id: String(group.id), models: conversationalModels(group.models) }))
    .filter(group => group.models.length > 0);
}

/** Every conversational model, flattened with its provider. */
export function modelOptionsOf(catalog) {
  return providersOf(catalog).flatMap(group => group.models.map(entry => ({
    value: group.id + '/' + entry.id,
    text: group.id + ' / ' + (entry.name && entry.name !== entry.id ? entry.id + ' · ' + entry.name : entry.id),
  })));
}

const plain = content => ({ tag: 'plain_text', content: String(content).slice(0, 75) });

function button(name, label, value, style = 'default') {
  return {
    tag: 'button',
    name,
    type: style,
    form_action_type: 'submit',
    text: plain(label),
    behaviors: [{ type: 'callback', value: { dsh: value } }],
  };
}

/**
 * Build the card.
 * @param {object} params
 * @param {object} params.catalog   Host model catalog ({groups:[{id,models:[{id,name}]}]})
 * @param {{provider?:string,model?:string}} params.selected
 * @param {string} [params.notice]
 * @param {string} [params.token]   Callback token prefix
 */
export function buildModelPickerCard({ catalog, selected = {}, notice = '', token = 'dsh:model' } = {}) {
  const all = modelOptionsOf(catalog);
  if (!all.length) return null;
  // The current model must always be offered, even when the list is trimmed.
  const current = selected.provider && selected.model ? selected.provider + '/' + selected.model : '';
  let options = all.slice(0, MAX_OPTIONS);
  if (current && !options.some(option => option.value === current)) {
    const currentOption = all.find(option => option.value === current);
    if (currentOption) options = [currentOption, ...options.slice(0, MAX_OPTIONS - 1)];
  }

  const elements = [
    { tag: 'markdown', content: current ? '当前模型：**' + current + '**' : '当前尚未选择模型' },
  ];
  if (notice) elements.push({ tag: 'markdown', content: String(notice), text_size: 'notation' });

  elements.push({
    tag: 'form',
    name: 'dsh_model_form',
    elements: [
      {
        tag: 'select_static',
        name: 'dsh_model',
        placeholder: plain('选择模型（' + options.length + '）'),
        options: options.map(option => ({ text: plain(option.text), value: option.value })),
        ...(current && options.some(option => option.value === current) ? { initial_option: current } : {}),
      },
      button('dsh_model_apply', '切换', token + ':apply', 'primary'),
    ],
  });

  const hidden = all.length - options.length;
  elements.push({
    tag: 'markdown',
    text_size: 'notation',
    content: '共 ' + all.length + ' 个可对话模型' +
      (hidden > 0 ? '，下拉内显示 ' + options.length + ' 个；其余用 /model 提供方/模型ID 切换' : '') +
      '，已过滤 embedding / 生图 / 生视频类模型。',
  });

  return {
    schema: '2.0',
    header: { template: 'blue', title: plain('切换模型') },
    body: { elements },
  };
}

/** Read a submission back into an intent: apply only (there is no paging). */
export function readModelPickerAction(input = {}) {
  const token = String(input.token ?? '');
  const parts = token.split(':');
  if (parts[0] !== 'dsh' || parts[1] !== 'model') return null;
  const values = input.values ?? {};
  const model = String(values.dsh_model ?? input.model ?? '');
  const provider = model.includes('/') ? model.slice(0, model.indexOf('/')) : '';
  if (parts[2] === 'apply') return { kind: 'apply', model, provider };
  return null;
}
