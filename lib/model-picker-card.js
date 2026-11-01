/**
 * Feishu model-picker card.
 *
 * A phone cannot read a hundred-line model list, so /model renders a card with one
 * select and a switch button.
 *
 * Paging is done with BUTTONS beside the select. Returning 下一页 as a dropdown entry
 * was tried and reverted: a select value is a choice, so Feishu remembered it and the
 * next render showed "→ 下一页" as the selected value while the card still said page 1,
 * and turning a page cost two taps.
 */

/** Options per page: ten fits one phone screen without scrolling the dropdown. */
export const PAGE_SIZE = 10;

/**
 * Temporary: renders a 🔍 测试 button that reports what the platform actually delivered
 * for a tap. It exists to diagnose the paging failure with evidence instead of guesses,
 * and must be switched off once the path is confirmed.
 */
export const INCLUDE_PROBE = false;

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
 * A pager button. It lives OUTSIDE the form (inside a column_set), so it carries no
 * form_action_type: clicking it fires its own callback immediately, with no form
 * validation in the way.
 */
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

  const formElements = [{
    tag: 'select_static',
    name: 'dsh_model',
    // A form field is required by default and a form button does not fire while a
    // required field is empty; without this the buttons are swallowed by validation.
    required: false,
    // Show no initial option: the collapsed box otherwise displays the first row, which
    // reads as a choice nobody made. The header above states the real current model.
    initial_index: 0,
    placeholder: plain('选择模型（' + pageOptions.length + '/' + options.length + '）'),
    options: pageOptions.map(option => ({ text: plain(option.text), value: option.value })),
  }];
  formElements.push(button('dsh_model_apply', '切换', token + ':apply', 'primary'));

  const elements = [
    { tag: 'markdown', content: current ? '当前模型：**' + current + '**' : '当前尚未选择模型' },
  ];
  if (notice) elements.push({ tag: 'markdown', content: String(notice), text_size: 'notation' });
  elements.push({ tag: 'form', name: 'dsh_model_form', elements: formElements });

  /**
   * Paging sits on ONE row, outside the form: `column_set` lays columns out horizontally,
   * and a button outside a form fires its own callback without form validation. The form
   * only ever contains the select and 切换, which is the shape this tenant has rendered.
   *
   * First page has no 上一页, last page has no 下一页 — the button that would go nowhere
   * is not rendered at all, instead of being rendered disabled.
   */
  const pager = [];
  if (safePage > 0) pager.push(pageButton('dsh_page_prev', '← 上一页', token + ':page:' + (safePage - 1)));
  if (safePage + 1 < pages) pager.push(pageButton('dsh_page_next', '下一页 →', token + ':page:' + (safePage + 1)));
  if (pager.length === 1) {
    elements.push({ tag: 'column_set', flex_mode: 'bisect', columns: [
      { tag: 'column', width: 'weighted', weight: 1, elements: [pager[0]] },
      { tag: 'column', width: 'weighted', weight: 1, elements: [] },
    ] });
  } else if (pager.length === 2) {
    elements.push({ tag: 'column_set', flex_mode: 'bisect', columns: [
      { tag: 'column', width: 'weighted', weight: 1, elements: [pager[0]] },
      { tag: 'column', width: 'weighted', weight: 1, elements: [pager[1]] },
    ] });
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
    // update_multi lets the card be replaced by the callback response; without it an
    // interaction cannot change what the sender already sees.
    config: { wide_screen_mode: true, update_multi: true },
    header: { template: 'blue', title: plain('切换模型') },
    body: { elements },
  };
}

/** Read a submission back into an intent: page turn or model switch. */
export function readModelPickerAction(input = {}) {
  const token = String(input.token ?? '');
  const parts = token.split(':');
  if (parts[0] !== 'dsh' || parts[1] !== 'model') return null;
  const values = input.values ?? {};
  const model = String(values.dsh_model ?? input.model ?? '');
  const provider = model.includes('/') ? model.slice(0, model.indexOf('/')) : '';
  if (parts[2] === 'apply') return { kind: 'apply', model, provider };
  if (parts[2] === 'page') {
    // Digits only: '1.5' or '-1' must not be silently read as page 1.
    if (!/^\d+$/.test(parts[3] ?? '')) return null;
    const page = Number.parseInt(parts[3], 10);
    if (!Number.isSafeInteger(page)) return null;
    return { kind: 'page', page, provider };
  }
  return null;
}
