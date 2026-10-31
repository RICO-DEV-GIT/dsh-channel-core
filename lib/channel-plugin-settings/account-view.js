/**
 * Account-scoped view over one config file.
 *
 * `ChannelRuntime` reads `settings.configFile` through four members (`value`,
 * `subscribe`, `snapshot`, `save`) and never cares where the bytes live. This
 * adapter keeps that contract per bot account, so each runtime sees only its own
 * slice plus the shared display options — and `accountId` is injected, which is
 * what keeps bindings, owners and receipts scoped to the right bot.
 *
 * The v1 (single-account) file keeps working unchanged: it is exposed as a view
 * whose `accountId` is the one already in the file (defaults to "default").
 */

export function isMultiAccountConfig(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Boolean(value.accounts);
}

/** Account ids in the file, in declaration order. */
export function accountIdsOf(value) {
  if (!isMultiAccountConfig(value)) return ['default'];
  return Object.keys(value.accounts ?? {});
}

function accountSlice(value) {
  if (!value || typeof value !== 'object') return {};
  const { accountId: _ignored, streaming: _ignoredStreaming, throttleMs: _ignoredThrottle, ...rest } = value;
  return rest;
}

export function accountView(configFile, accountId) {
  const read = () => {
    const current = configFile.value;
    if (!isMultiAccountConfig(current)) {
      // v1: one implicit account that owns the whole object.
      return { ...current, accountId: current?.accountId || accountId };
    }
    const account = current.accounts?.[accountId];
    if (!account) return null;
    return {
      ...account,
      accountId,
      streaming: current.shared?.streaming,
      throttleMs: current.shared?.throttleMs,
    };
  };
  return {
    get value() {
      const value = read();
      return value ? Object.freeze(value) : null;
    },
    snapshot() {
      const base = configFile.snapshot();
      return { ...base, value: read(), accountId };
    },
    subscribe(listener) {
      return configFile.subscribe(() => listener());
    },
    /**
     * Save one account. In v1 the whole object is the account, so it is written
     * as-is; in v2 only `accounts[accountId]` changes and display options go back
     * to `shared`, so accounts can never overwrite each other.
     */
    save(value, revision) {
      const current = configFile.value;
      if (!isMultiAccountConfig(current)) return configFile.save(accountSlice(value), revision);
      const { streaming, throttleMs, ...account } = value ?? {};
      const next = {
        ...current,
        accounts: { ...current.accounts, [accountId]: accountSlice(account) },
        shared: { ...current.shared, ...(streaming === undefined ? {} : { streaming }), ...(throttleMs === undefined ? {} : { throttleMs }) },
      };
      return configFile.save(next, revision);
    },
  };
}
