/**
 * Feishu model-picker card.
 *
 * A phone cannot read a hundred-line model list, so /model renders a card with one
 * select and a switch button.
 *
 * Paging lives beside the select, not inside it: `select_static` is a static option
 * array with no paging or lazy-loading parameter, so an open dropdown cannot load
 * more. The card therefore shows one page of PAGE_SIZE options and offers
 * 上一页 / 下一页 only when there is more than one page.
 */

/** Options per page. Small enough to scroll on a phone, large enough to browse. */
export const PAGE_SIZE = 20;

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

/** A pager button: no form_action_type, so it never triggers form validation. */
function pageButton(name, label, value) {
  return {
    tag: 'button',
    name,
    type: 'default',
    text: plain(label),
    behaviors: [{ type: 'callback', value: { dsh: value } }],
  };
}

export function pageCountOf(catalog) {
  const total = modelOptionsOf(catalog).length;
  return total ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 0;
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

  const elements = [
    { tag: 'markdown', content: current ? '当前模型：**' + current + '**' : '当前尚未选择模型' },
  ];
  if (notice) elements.push({ tag: 'markdown', content: String(notice), text_size: 'notation' });

  // Only the select and 切换 live in the form: a form button validates the form, and
  // a submit-type pager would be blocked ("请选择模型") before the callback ever ran.
  elements.push({
    tag: 'form',
    name: 'dsh_model_form',
    elements: [
      {
        tag: 'select_static',
        name: 'dsh_model',
        placeholder: plain('选择模型（' + pageOptions.length + '/' + options.length + '）'),
        options: pageOptions.map(option => ({ text: plain(option.text), value: option.value })),
        ...(current && pageOptions.some(option => option.value === current) ? { initial_option: current } : {}),
      },
      button('dsh_model_apply', '切换', token + ':apply', 'primary'),
    ],
  });

  // Paging sits outside the form, so it fires without validating anything.
  if (pages > 1) {
    const pager = [];
    if (safePage > 0) pager.push(pageButton('dsh_page_prev', '上一页', token + ':page:' + (safePage - 1)));
    if (safePage + 1 < pages) pager.push(pageButton('dsh_page_next', '下一页', token + ':page:' + (safePage + 1)));
    elements.push({ tag: 'action', actions: pager });
  }

  elements.push({
    tag: 'markdown',
    text_size: 'notation',
    content: '共 ' + options.length + ' 个可对话模型' +
      (pages > 1 ? '，第 ' + (safePage + 1) + '/' + pages + ' 页' : '') +
      '，已过滤 embedding / 生图 / 生视频类模型。',
  });

  return {
    schema: '2.0',
    header: { template: 'blue', title: plain('切换模型') },
    body: { elements },
  };
}

/** Read a submission back into an intent: apply, or page. */
export function readModelPickerAction(input = {}) {
  const token = String(input.token ?? '');
  const parts = token.split(':');
  if (parts[0] !== 'dsh' || parts[1] !== 'model') return null;
  const values = input.values ?? {};
  const model = String(values.dsh_model ?? input.model ?? '');
  const provider = model.includes('/') ? model.slice(0, model.indexOf('/')) : '';
  if (parts[2] === 'apply') return { kind: 'apply', model, provider };
  if (parts[2] === 'page') {
    const page = Number.parseInt(parts[3] ?? '', 10);
    if (!Number.isSafeInteger(page) || page < 0) return null;
    return { kind: 'page', page, provider };
  }
  return null;
}
