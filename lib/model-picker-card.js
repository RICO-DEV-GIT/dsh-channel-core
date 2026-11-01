/**
 * Feishu model-picker card.
 *
 * A phone cannot read a hundred-line model list, so /model renders a card with one
 * select and a switch button.
 *
 * Paging lives INSIDE the dropdown: `select_static` has no lazy-loading parameter, but
 * it is just a list of (text, value) pairs, so the last two entries are 下一页 / 上一页
 * whose values start with PAGE_PREFIX. Choosing one and tapping 切换 turns the page —
 * the same gesture as choosing a model, and only one button on the card.
 */

/** Options per page. Small enough to scroll on a phone, large enough to browse. */
export const PAGE_SIZE = 20;
/** Select values that navigate instead of switching a model. */
export const PAGE_PREFIX = '__dsh_page:';

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

export function pageCountOf(catalog) {
  const total = modelOptionsOf(catalog).length;
  return total ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 0;
}

/** Page holding a given `provider/model`, so a switch lands on the right page. */
export function pageOfModel(catalog, value) {
  const index = modelOptionsOf(catalog).findIndex(option => option.value === value);
  return index < 0 ? 0 : Math.floor(index / PAGE_SIZE);
}

/**
 * Build one page of the card.
 * @param {object} params
 * @param {object} params.catalog   Host model catalog ({groups:[{id,models:[{id,name}]}]})
 * @param {{provider?:string,model?:string}} params.selected
 * @param {number} [params.page]    Zero-based page index
 * @param {string} [params.notice]
 * @param {string} [params.token]   Callback token prefix
 */
export function buildModelPickerCard({ catalog, selected = {}, page = 0, notice = '', token = 'dsh:model' } = {}) {
  const options = modelOptionsOf(catalog);
  if (!options.length) return null;
  const pages = Math.max(1, Math.ceil(options.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const start = safePage * PAGE_SIZE;
  const pageOptions = options.slice(start, start + PAGE_SIZE);
  const current = selected.provider && selected.model ? selected.provider + '/' + selected.model : '';
  // Feishu ignores the select placeholder on a phone and shows the first option, which
  // looked like a selection nobody made. Putting the current model first makes the
  // collapsed box say the truth instead of naming an unrelated model.
  if (current) {
    const at = pageOptions.findIndex(option => option.value === current);
    if (at > 0) pageOptions.unshift(...pageOptions.splice(at, 1));
  }

  // Paging lives INSIDE the dropdown, as two extra options at its end: the phone then
  // has a single 切换 button, and turning a page is the same gesture as choosing a
  // model. An option whose value starts with PAGE_PREFIX is a navigation, not a model.
  const optionList = pageOptions.map(option => ({ text: plain(option.text), value: option.value }));
  if (safePage + 1 < pages) {
    optionList.push({ text: plain('→ 下一页（第 ' + (safePage + 2) + '/' + pages + ' 页）'), value: PAGE_PREFIX + (safePage + 1) });
  }
  if (safePage > 0) {
    optionList.push({ text: plain('← 上一页（第 ' + safePage + '/' + pages + ' 页）'), value: PAGE_PREFIX + (safePage - 1) });
  }

  const elements = [
    { tag: 'markdown', content: current ? '当前模型：**' + current + '**' : '当前尚未选择模型' },
  ];
  if (notice) elements.push({ tag: 'markdown', content: String(notice), text_size: 'notation' });

  // Everything interactive lives in ONE form. A body-level `action` block is not a
  // valid card 2.0 element: Feishu rejected the whole card and /model silently fell
  // back to text. Forms with buttons are proven to render in this tenant.
  elements.push({
    tag: 'form',
    name: 'dsh_model_form',
    elements: [
      {
        tag: 'select_static',
        name: 'dsh_model',
        placeholder: plain('选择模型（' + pageOptions.length + '/' + options.length + '）'),
        options: optionList,
      },
      button('dsh_model_apply', '切换', token + ':apply', 'primary'),
    ],
  });

  elements.push({
    tag: 'markdown',
    text_size: 'notation',
    content: '共 ' + options.length + ' 个可对话模型' +
      (pages > 1 ? '，第 ' + (safePage + 1) + '/' + pages + ' 页（翻页在列表末尾）' : '') +
      '，已过滤 embedding / 生图 / 生视频类模型。',
  });

  return {
    schema: '2.0',
    header: { template: 'blue', title: plain('切换模型') },
    body: { elements },
  };
}

/** Read a submission back into an intent: page (from the dropdown) or apply. */
export function readModelPickerAction(input = {}) {
  const token = String(input.token ?? '');
  const parts = token.split(':');
  if (parts[0] !== 'dsh' || parts[1] !== 'model') return null;
  const values = input.values ?? {};
  const model = String(values.dsh_model ?? input.model ?? '');
  // A pager option chosen from the dropdown: navigate instead of switching.
  if (model.startsWith(PAGE_PREFIX)) {
    const page = Number.parseInt(model.slice(PAGE_PREFIX.length), 10);
    if (!Number.isSafeInteger(page) || page < 0) return null;
    return { kind: 'page', page, provider: '' };
  }
  const provider = model.includes('/') ? model.slice(0, model.indexOf('/')) : '';
  if (parts[2] === 'apply') return { kind: 'apply', model, provider };
  if (parts[2] === 'page') {
    const page = Number.parseInt(parts[3] ?? '', 10);
    if (!Number.isSafeInteger(page) || page < 0) return null;
    return { kind: 'page', page, provider };
  }
  return null;
}
