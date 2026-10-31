/**
 * Feishu model-picker card.
 *
 * The plain-text `/model` answer becomes unreadable on a phone once a profile
 * has ~100 models (ark alone), so the command renders a card instead: a provider
 * select, a model select for that provider, and a submit. Everything is a tap —
 * the operator never types a provider/model id.
 *
 * Selects in a Feishu card cannot repopulate themselves, so the card is stateless
 * and re-rendered on every choice:
 *   provider submit  -> same card, model list for the chosen provider
 *   model submit     -> applies the choice
 * Each render stays under the select-option budget by paging long provider lists.
 */

/** Feishu cards accept a limited number of select options; page beyond this. */
export const OPTIONS_PER_PAGE = 18;

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

function option(value, text) {
  return { text: { tag: 'plain_text', content: String(text).slice(0, 75) }, value: String(value).slice(0, 255) };
}

function selectField(name, label, options, initial, page) {
  const pageOptions = options.slice(page * OPTIONS_PER_PAGE, (page + 1) * OPTIONS_PER_PAGE);
  const element = {
    tag: 'select_static',
    name,
    placeholder: { tag: 'plain_text', content: label },
    options: pageOptions.map(entry => option(entry.value, entry.text)),
    ...(initial && pageOptions.some(entry => entry.value === initial) ? { initial_option: initial } : {}),
  };
  return element;
}

/**
 * Build the card.
 * @param {object} params
 * @param {object} params.catalog      Host model catalog ({groups:[{id,models:[{id,name}]}]})
 * @param {{provider?:string,model?:string}} params.selected  Current selection
 * @param {string} [params.provider]   Provider being browsed (defaults to selected)
 * @param {number} [params.page]       Page inside that provider's model list
 * @param {string} [params.notice]     One line of feedback (switch done, page changed…)
 * @param {string} [params.token]      Callback token prefix, kept short
 */
export function buildModelPickerCard({ catalog, selected = {}, provider, page = 0, notice = '', token = 'dsh:model' } = {}) {
  const providers = providersOf(catalog);
  if (!providers.length) return null;
  const currentProvider = String(provider || selected.provider || providers[0].id);
  const active = providers.find(entry => entry.id === currentProvider) ?? providers[0];
  const pages = Math.max(1, Math.ceil(active.models.length / OPTIONS_PER_PAGE));
  const safePage = Math.min(Math.max(0, page), pages - 1);
  const modelOptions = active.models.map(entry => ({
    value: `${active.id}/${entry.id}`,
    text: `${entry.id}${entry.name && entry.name !== entry.id ? ' · ' + entry.name : ''}`,
  }));
  const currentValue = selected.provider && selected.model ? `${selected.provider}/${selected.model}` : '';

  const elements = [
    { tag: 'markdown', content: selected.provider ? `当前模型：**${selected.provider} / ${selected.model}**` : '当前尚未选择模型' },
  ];
  if (notice) elements.push({ tag: 'markdown', content: notice, text_size: 'notation' });

  elements.push({
    tag: 'form',
    name: 'dsh_model_form',
    elements: [
      selectField('dsh_provider', '提供方', providers.map(entry => ({ value: entry.id, text: entry.id })), active.id, 0),
      {
        tag: 'button',
        name: 'dsh_provider_apply',
        type: 'default',
        form_action_type: 'submit',
        text: { tag: 'plain_text', content: '查看该提供方的模型' },
        behaviors: [{ type: 'callback', value: { dsh: `${token}:provider` } }],
      },
    ],
  });

  elements.push({
    tag: 'form',
    name: 'dsh_model_pick',
    elements: [
      selectField('dsh_model', `${active.id} 的模型`, modelOptions, currentValue, safePage),
      {
        tag: 'button',
        name: 'dsh_model_apply',
        type: 'primary',
        form_action_type: 'submit',
        text: { tag: 'plain_text', content: '切换' },
        behaviors: [{ type: 'callback', value: { dsh: `${token}:apply` } }],
      },
      ...(safePage > 0 ? [{
        tag: 'button', name: 'dsh_page_prev', type: 'default', form_action_type: 'submit',
        text: { tag: 'plain_text', content: '上一页' },
        behaviors: [{ type: 'callback', value: { dsh: `${token}:page:${safePage - 1}` } }],
      }] : []),
      ...(safePage + 1 < pages ? [{
        tag: 'button', name: 'dsh_page_next', type: 'default', form_action_type: 'submit',
        text: { tag: 'plain_text', content: '下一页' },
        behaviors: [{ type: 'callback', value: { dsh: `${token}:page:${safePage + 1}` } }],
      }] : []),
    ],
  });

  elements.push({
    tag: 'markdown',
    text_size: 'notation',
    content: `共 ${providers.length} 个提供方 · 本提供方 ${active.models.length} 个可对话模型` +
      (pages > 1 ? `（第 ${safePage + 1}/${pages} 页）` : '') +
      ' · 已自动过滤 embedding / 生图 / 生视频类模型',
  });

  return {
    schema: '2.0',
    header: { template: 'blue', title: { tag: 'plain_text', content: '切换模型' } },
    body: { elements },
  };
}

/**
 * Read a submission back into an intent.
 * @param {{token?:string, values?:object, provider?:string, model?:string}} input
 */
export function readModelPickerAction(input = {}) {
  const token = String(input.token ?? '');
  const parts = token.split(':');
  if (parts[0] !== 'dsh' || parts[1] !== 'model') return null;
  const action = parts[2] ?? '';
  const values = input.values ?? {};
  const provider = String(values.dsh_provider ?? input.provider ?? '');
  const model = String(values.dsh_model ?? input.model ?? '');
  if (action === 'provider') return { kind: 'provider', provider };
  if (action === 'apply') return { kind: 'apply', provider, model };
  if (action === 'page') {
    const page = Number.parseInt(parts[3] ?? '', 10);
    if (!Number.isSafeInteger(page) || page < 0) return null;
    return { kind: 'page', provider, page };
  }
  return null;
}
