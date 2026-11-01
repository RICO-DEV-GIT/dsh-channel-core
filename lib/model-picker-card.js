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

/** Rows per page: six table rows plus the pager fit a phone without scrolling. */
export const PAGE_SIZE = 6;
/** Feishu rejects a card JSON over 30 KB; keep a margin for the envelope. */
export const MODEL_CARD_JSON_LIMIT = 28 * 1024;
/** Dropdown option values that turn the page instead of switching a model. */
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

/**
 * A pager button. It lives OUTSIDE the form (inside a column_set), so it carries no
 * form_action_type: clicking it fires its own callback immediately, with no form
 * validation in the way.
 */
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
export function buildModelPickerCard(params = {}) {
  const mode = params.mode === 'checker' || params.mode === 'all' ? params.mode : 'dropdown';
  if (mode === 'checker') return buildCheckerCard(params);
  if (mode === 'all') return buildAllCard(params);
  return buildDropdownCard(params);
}

/**
 * Full-catalog dropdown: every model in one `select_static`, no paging at all.
 *
 * The dropdown carries the client's own search box, so 200 models stay findable without
 * pages; 切换 is kept, so a stray tap in the list cannot switch the Session by itself.
 * Feishu caps a card at 30 KB, and the page is only possible when every option fits, so a
 * catalog that would overflow falls back to the paged checker layout.
 */
export function buildAllCard({ catalog, selected = {}, notice = '', token = 'dsh:model', limit = MODEL_CARD_JSON_LIMIT } = {}) {
  const options = modelOptionsOf(catalog);
  if (!options.length) return null;
  const current = selected.provider && selected.model ? selected.provider + '/' + selected.model : '';

  const card = {
    schema: '2.0',
    config: { update_multi: true },
    // No header: the card reads as one short block (当前模型 / 选择 + 切换 / 说明).
    body: { elements: [
      { tag: 'markdown', content: current ? '当前模型：**' + current + '**' : '当前尚未选择模型' },
      ...(notice ? [{ tag: 'markdown', content: String(notice), text_size: 'notation' }] : []),
      {
        tag: 'form',
        name: 'dsh_model_form',
        // The dropdown and 切换 share one row through a column_set — the same nesting the
        // official form example uses for its 提交/取消 pair.
        elements: [{
          tag: 'column_set',
          columns: [
            {
              tag: 'column',
              width: 'weighted',
              weight: 3,
              elements: [{
                tag: 'select_static',
                name: 'dsh_model',
                // Required would block the submit button while nothing is picked.
                required: false,
                initial_index: 0,
                width: 'fill',
                placeholder: plain('选择模型（' + options.length + ' 个，可搜索）'),
                options: options.map(option => ({ text: plain(option.text), value: option.value })),
              }],
            },
            {
              tag: 'column',
              width: 'weighted',
              weight: 1,
              vertical_align: 'center',
              elements: [button('dsh_model_apply', '切换', token + ':apply', 'primary')],
            },
          ],
        }],
      },
      {
        tag: 'markdown',
        text_size: 'notation',
        content: '共 ' + options.length + ' 个可对话模型，在列表里搜索后点「切换」生效，已过滤 embedding / 生图 / 生视频类模型。',
      },
    ] },
  };

  // 30 KB is a hard platform limit; measure the real payload rather than guess.
  if (Buffer.byteLength(JSON.stringify(card), 'utf8') > limit) return buildCheckerCard({ catalog, selected, notice, token });
  return card;
}

/**
 * Checker variant: no dropdown at all, so nothing can cover the paging buttons.
 *
 * Each model is a `checker` row (documented interactive component, click fires a callback
 * immediately). Paging and 切换 sit in one form, with the two pager buttons in a
 * `column_set` — the exact shape the official form example uses for its 提交/取消 pair.
 *
 * @param {object} params
 * @param {object} params.catalog
 * @param {{provider?:string,model?:string}} [params.selected]  the model the Session uses now
 * @param {string} [params.picked]   the model the operator has ticked but not applied yet
 * @param {number} [params.page]
 * @param {number} [params.pageSize] 4..10 rows per page
 * @param {string} [params.notice]
 * @param {string} [params.token]
 */
export function buildCheckerCard({ catalog, selected = {}, picked = '', page = 0, pageSize = PAGE_SIZE, notice = '', token = 'dsh:model' } = {}) {
  const options = modelOptionsOf(catalog);
  if (!options.length) return null;
  const size = Math.min(10, Math.max(4, Number.isFinite(Number(pageSize)) ? Number(pageSize) : PAGE_SIZE));
  const pages = Math.max(1, Math.ceil(options.length / size));
  const safePage = Math.min(Math.max(0, Number(page) || 0), pages - 1);
  const start = safePage * size;
  const pageOptions = options.slice(start, start + size);
  const current = selected.provider && selected.model ? selected.provider + '/' + selected.model : '';
  const pickedIndex = options.findIndex(option => option.value === picked);
  const pickedPage = pickedIndex < 0 ? -1 : Math.floor(pickedIndex / size);

  const elements = [
    { tag: 'markdown', content: current ? '当前模型：**' + current + '**' : '当前尚未选择模型' },
    {
      tag: 'markdown',
      content: picked
        ? '已选模型：**' + picked + '**' + (pickedPage === safePage ? '' : '（第 ' + (pickedPage + 1) + '/' + pages + ' 页）')
        : '已选模型：尚未选择',
    },
  ];
  if (notice) elements.push({ tag: 'markdown', content: String(notice), text_size: 'notation' });

  for (const [offset, option] of pageOptions.entries()) {
    const isPicked = picked === option.value;
    // Replacing a ticked model asks first: confirm 否 keeps the old choice untouched
    // (documented: the behaviours only run after 确定).
    const replaceConfirm = picked && !isPicked
      ? { confirm: { title: plain('更换已选模型？'), text: plain('当前已选 ' + picked + '，确定改选 ' + option.value + ' 吗？') } }
      : {};
    elements.push({
      tag: 'checker',
      name: 'dsh_pick_' + (start + offset + 1),
      checked: isPicked,
      text: plain(option.text),
      overall_checkable: true,
      behaviors: [{ type: 'callback', value: { dsh: token + ':pick', model: option.value } }],
      ...replaceConfirm,
    });
  }

  const pager = [];
  if (safePage > 0) pager.push(button('dsh_page_prev', '← 上一页', token + ':page:' + (safePage - 1)));
  if (safePage + 1 < pages) pager.push(button('dsh_page_next', '下一页 →', token + ':page:' + (safePage + 1)));
  const formElements = [];
  if (pager.length) {
    formElements.push({
      tag: 'column_set',
      flex_mode: pager.length === 2 ? 'bisect' : undefined,
      columns: pager.map(node => ({ tag: 'column', width: 'weighted', weight: 1, elements: [node] })),
    });
  }
  formElements.push(button('dsh_model_apply', '切换', token + ':apply', 'primary'));
  elements.push({ tag: 'form', name: 'dsh_model_form', elements: formElements });

  elements.push({
    tag: 'markdown',
    text_size: 'notation',
    content: '第 ' + (safePage + 1) + '/' + pages + ' 页 · 共 ' + options.length + ' 个可对话模型' +
      (picked ? ' · 已选 ' + picked : '') + '，已过滤 embedding / 生图 / 生视频类模型。',
  });

  return {
    schema: '2.0',
    config: { update_multi: true },
    header: { template: 'blue', title: plain('切换模型') },
    body: { elements },
  };
}

function buildDropdownCard({ catalog, selected = {}, page = 0, notice = '', token = 'dsh:model' } = {}) {
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

  // Paging entries live INSIDE the dropdown: this client renders a dropdown as a full
  // overlay, so a button outside it is either covered or dismissed by the first tap.
  // Picking a pager entry and pressing 切换 is the only way to page from inside the list.
  const pageOptionsList = pageOptions.map(option => ({ text: plain(option.text), value: option.value }));
  if (safePage + 1 < pages) {
    pageOptionsList.push({ text: plain('▶ 下一页（第 ' + (safePage + 2) + '/' + pages + ' 页）'), value: PAGE_PREFIX + (safePage + 1) });
  }
  if (safePage > 0) {
    pageOptionsList.push({ text: plain('◀ 上一页（第 ' + safePage + '/' + pages + ' 页）'), value: PAGE_PREFIX + (safePage - 1) });
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
    options: pageOptionsList,
  }];
  formElements.push(button('dsh_model_apply', '切换', token + ':apply', 'primary'));

  const elements = [
    { tag: 'markdown', content: current ? '当前模型：**' + current + '**' : '当前尚未选择模型' },
  ];
  if (notice) elements.push({ tag: 'markdown', content: String(notice), text_size: 'notation' });

  /**
   * The list is a root-level `table`: the client renders it with its own row layout and
   * `row_height: auto` wraps long names, which a select cannot do. Table cells are not
   * clickable, so the select below remains the way to choose — it holds the same six
   * models so what you see is what you pick.
   *
   * A table may only sit at the card root (documented nesting rule), so it goes before
   * the form, never inside it.
   */
  elements.push({
    tag: 'table',
    page_size: PAGE_SIZE,
    row_height: 'auto',
    header_style: { text_size: 'normal', text_color: 'grey', background_style: 'none', bold: true, lines: 1 },
    columns: [
      // Documented range: auto, a percentage, or 80–600px. '30px' is out of range and made
      // Feishu reject the whole card with format_error, which is why /model fell back to text.
      { name: 'index', display_name: '#', data_type: 'text', width: 'auto', horizontal_align: 'center' },
      { name: 'model', display_name: '模型', data_type: 'text', width: 'auto', horizontal_align: 'left' },
    ],
    rows: pageOptions.map((option, offset) => ({
      index: String(start + offset + 1),
      model: option.value,
    })),
  });

  elements.push({ tag: 'form', name: 'dsh_model_form', elements: formElements });

  // No pager outside the form: this client renders the dropdown as a full overlay, so an
  // outside button is covered or consumed by the tap that dismisses the list. Paging is an
  // option inside the dropdown (see pageOptionsList) executed by 切换.

  elements.push({
    tag: 'markdown',
    text_size: 'notation',
    content: '共 ' + options.length + ' 个可对话模型' +
      (pages > 1 ? '，第 ' + (safePage + 1) + '/' + pages + ' 页（翻页在列表末尾）' : '') +
      '，已过滤 embedding / 生图 / 生视频类模型。',
  });

  return {
    schema: '2.0',
    // `update_multi` is the only documented 2.0 config field this card needs: it lets the
    // callback response replace what the sender sees. `wide_screen_mode` belongs to card
    // JSON 1.0 and is not a valid 2.0 key — the compliance test rejects it.
    config: { update_multi: true },
    header: { template: 'blue', title: plain('切换模型') },
    body: { elements },
  };
}

/** Read a submission back into an intent: page turn, tick, or model switch. */
export function readModelPickerAction(input = {}) {
  const token = String(input.token ?? '');
  const parts = token.split(':');
  if (parts[0] !== 'dsh' || parts[1] !== 'model') return null;
  const values = input.values ?? {};
  const value = input.value ?? {};
  // A checker row: the model rides on the component's own callback value.
  if (parts[2] === 'pick') {
    const model = String(value.model ?? '');
    if (!model) return null;
    const provider = model.includes('/') ? model.slice(0, model.indexOf('/')) : '';
    return { kind: 'pick', model, provider, checked: input.checked !== false };
  }
  const model = String(values.dsh_model ?? input.model ?? '');
  const provider = model.includes('/') ? model.slice(0, model.indexOf('/')) : '';
  // A pager entry picked inside the dropdown: the submitted value is the page, not a model.
  if (model.startsWith(PAGE_PREFIX)) {
    const digits = model.slice(PAGE_PREFIX.length);
    if (!/^\d+$/.test(digits)) return null;
    const page = Number.parseInt(digits, 10);
    if (!Number.isSafeInteger(page)) return null;
    return { kind: 'page', page, provider: '' };
  }
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
