# Changelog · Channel Core

This file holds historical behavior notes formerly embedded in README. For current setup and behavior, start with [README.md](README.md) or [简体中文](README.zh-CN.md).

## 0.9.0-dev · 模型切换卡片

- `/model`（不带参数）在飞书里改为发送一张**选择卡片**：提供方下拉 + 该提供方的模型下拉 + 「切换」按钮，并支持分页。手机上一个 profile 可能有上百个模型，纯文本列表既读不完也记不住；卡片里点选即可，切换后同一张卡片就地更新为「已切换 …，下一次请求生效」。
- 只列出可对话的模型：`embedding / seedream / seedance / tts / vision` 等按名字过滤（某提供方若全部被过滤则原样保留，避免列表变空）。
- 每页 18 个选项，超出显示「上一页 / 下一页」，不撞飞书下拉的选项上限。
- 文本回答保留为降级：卡片构造失败（无 catalog、旧客户端）时仍发原来的 `/model` 文本。
- 卡片回调走 `cardAction` → `host.modelPicker` → `selectModel`，与 Ask User 的回答通道互不影响；卡片失效时提示「请重新发送 /model」。
- 测试：卡片构造 6 个、传输层回调 4 个。

## 0.7.5

- The Feishu page now has **one** bot entry instead of two. `FeishuBotCard` and `FeishuRegistrationCard` are merged into `FeishuBotPanel`, which picks its state from the channel instead of asking the operator to guess which QR to press:
  - **not configured** → one「生成二维码」button (Feishu device-code flow: choose 新建应用 to write App ID / secret / owner automatically), plus an inline「已有 App ID？直接填」form that writes App ID and secret in a single action — no scanning needed;
  - **configured but disconnected** → shows the configured App ID and offers「重新连接」, keeping the same inline form for a wrong credential;
  - **connected** → the bot's chat QR (scan → open the DM) with 复制链接 / 刷新二维码, and the security note that the QR carries only the public `open_id`.
- Note: Feishu does not return an existing app's secret through the scan flow, so the inline form is the only way to enter one — a platform limit, not a missing feature.

## 0.7.4

- Fixed the Feishu **scan-to-add QR** never rendering: the card asked the Channel SDK for `getBotIdentity()`, which the shipped `LarkChannel` does not expose (it only has `setBotIdentity()` and the async `fetchBotIdentity()`), so the lookup was always `undefined` and the page showed「连接成功后即可生成名片」forever. The card now calls `fetchBotIdentity()` (`GET /open-apis/bot/v3/info`) once and caches the identity for the life of the transport.
- Fixed `buildBotCard`'s cache hit dropping `openId`: a second request for the same bot answered without the id, which the deployment page renders as a nameless card.
- New `channels/feishu/tests/bot-card-identity.test.mjs` pins all three cases: no getter → QR from `fetchBotIdentity`, failed lookup → `null` instead of a throw, and a late-resolving identity working on a later call.

## 0.7.3

- Added `streaming.finalFormat` with three values: `auto` (default), `card`, `text`. `auto` sends a private chat's final answer as an ordinary text message — a chat bubble can be long-pressed and its text selected on a phone, while a long card has to be opened first — and keeps the card in groups, where the answer is read by several people and the structure helps. `card` and `text` force one format everywhere, so an existing channel can opt back into the old behaviour. A text delivery recalls the live progress card before sending, and an answer that is empty still fails loudly (`feishu-final-text-empty`) instead of sending a blank message.
- Feishu tests that cover the card pipeline now state `finalFormat: 'card'` explicitly, and two new tests pin the `auto` split: private chat → text, group → card.
- 「Agent 预设 ID」is now a picker (`type: 'preset'`) instead of free text. It lists the presets the Host declares, offers「留空（跟随默认：standard）」, and keeps a saved id the Host does not have as a visible「本机不存在，会自动回退默认」option rather than dropping it. A Host without the preset registry falls back to a plain text field.
- The page-level warning became a warning only: it renders just when the saved id cannot work, since the picker already lists the choices.

## 0.7.2

- Fixed the shipped channel config naming a nonexistent Agent preset (`agentPreset:'agent'`). Every inbound message failed at session creation with `agent-preset/not-found`. The default is now empty, which means "follow the Host default preset"; a saved id this Host does not declare is detected at session time and replaced by the Host default instead of failing, and the status line says so.
- Added a preset hint to both channel pages: the settings page reads the presets the Host actually declares (`presetCatalog` RPC) and lists them above the form, marking a configured id that does not exist in red with the fix ("change it to one of these or leave it blank"). The「Agent 预设 ID」field help says the same.
- Failures now explain themselves instead of printing a raw code. `lib/channel-hints.js` maps the operator-fixable codes (workspace required/invalid, unknown preset, role unavailable, scope mismatch, binding review, receipt conflict, uncertain input, aborted input…) to an instruction plus the original code, and both the channel status line and the failure card use it. An unknown code keeps the previous advice with the code appended.
- Tests: preset catalog/fallback and hint mapping are covered, and the client bundle keeps asserting the rendered hint.

## 0.7.1

- Added **scan to create/connect a Feishu bot** on the Feishu settings page. The Host drives Feishu's official device-code registration endpoint (`accounts.feishu.cn`/`larksuite.com` `/oauth/v1/app/registration`): `begin` renders a QR of the verification page, `poll` follows the scan outcome. A freshly created bot is written into the channel config automatically (App ID always; the operator's `open_id` becomes the owner on a fresh config, or is appended to the allowlist on an existing one) and its App Secret is saved through the standard credential API. Choosing an existing app on the phone ends with Feishu showing copy buttons, so the card then points the operator at the regular secret input — the flow never sees the secret in that path.
- New `registrationBegin` / `registrationPoll` / `registrationApply` RPCs on the plugin settings service, delegated to a channel-supplied registration source. Only Feishu provides one; the Discord tab renders exactly as before, and the device code is never shown in the page.
- The registration module is standalone (`lib/feishu-app-registration.js`) with an injectable fetch, so the endpoint contract is unit-tested offline; `registrationApplyConfig` is a conservative merge that never clobbers an operator-configured bot.
- Note: the accounts endpoint is official but not part of the public open-apis suite; if Feishu changes it, only this flow degrades (manual paste remains).

## 0.7.0

- Added **scan to add the bot** to the Feishu settings page. The Host renders the QR host-side from the applink of the bot `open_id` that the live connection resolved through `bot/v3/info`, so the code always targets the same bot this DSH profile bridges to; a disconnected channel produces no QR and the card offers a copyable link instead of a camera. Scanning grants no extra reach: DM/group admission, owner claim and allowlists are untouched.
- New `botCard` RPC on the plugin settings service. It delegates to the channel transport and returns `null` for channels without a scannable card, so the Discord tab renders exactly as before.
- `qrcode` is a runtime dependency; the client bundle stays dependency-free and only receives a PNG data URL.
- Build hygiene: `tools/build-client.mjs` normalizes CRLF before slicing the shared template (a Windows checkout previously failed the build), the shared settings helper regained the multiline "restore default" editor the shipped bundle already had, and the retired outbound-archive view was dropped from the template so a rebuild reproduces the published bundle instead of resurrecting it.

## 0.6.3

- Every incoming channel message now starts with a local date prefix (`[2026-10-27 周二 11:30] text`), derived from the channel's own timestamp in the machine's time zone. The model has no clock and the Host runtime context carries no time, so it used to infer dates from content and get them wrong. The prefix sits at the front of the newest message only, which leaves the cached prompt prefix untouched; command messages are never stamped and the idempotency payload stays exactly as received.

## 0.6.2

- Removed the Discord `/prompt` slash command. It only existed to send a message without mentioning the bot, and `requireMention` already defaults to off for allowlisted groups, so it was redundant.
- Added `/reason` on both channels to toggle the "show thinking" setting (`streaming.progress.narration`) from chat. It edits the same value the plugin page owns; saving is a connection-level change, so the channel reconnects briefly.
- Discord command registration now syncs instead of only creating: a command removed from the list (such as `/prompt`) is deleted from the application rather than staying visible forever.

## 0.6.1

- Fixed: the Host Session query is asynchronous. Rotation now awaits `observeSession` instead of reading a Promise, which had silently produced an undefined `cwd` and would have created successor Sessions in the wrong workspace. An unreadable header now fails closed and cools the Session down instead of falling back to a default path.
- A `/new` that leaves any task unmigrated no longer switches the binding or archives the old Session; it reports `migration-incomplete` and keeps everything where it was.
- When deleting an old task fails, the newly created copy is removed, because two live tasks would run the same side-effecting script twice. Only an unrecoverable state is reported as duplicate risk.
- `schedule.delete()` results are checked: `deleted:false` is recorded as absent rather than as a successful migration, and a create without a confirmed id is never counted as success.
- `rebindScope` accepts the expected binding revisions and performs a per-row compare-and-set inside the transaction, rolling back the whole move if anything changed concurrently.
- Automatic rotation no longer archives Sessions without a channel binding. A binding-less Session may be a desktop, CLI or third-party Session and the plugin cannot distinguish them, so such Sessions are only reported.

## 0.6.0

- `/new` now migrates the active Scheduler tasks of the old Session to its successor and archives the old Session strictly, instead of leaving the tasks behind and detached. Admission rejects a busy Session, a pending question, an unconfirmed inbound message, or a task firing within 90 seconds; migration creates before deleting so an interruption cannot lose a task; `inactive` tasks are never recreated; an uncertain create stops the run instead of retrying.
- Retired routes are recorded in `route_history`, and outbound delivery falls back to them when a Session no longer owns a binding. The fallback requires an identical `binding_key` and scope and re-runs every existing permission check; it preserves a route, it does not grant a new one.
- Added automatic Session-log rotation driven by file size, with quiet-condition checks, per-Session failure cooldown, and owner DMs left to LCM. Channel Sessions rotate by migrating and archiving; Sessions without a binding get a successor and an archived predecessor.
- Fixed: the Workspace registry is resolved as `workspaceRegistry` (the package name `workspace` is not a service). The previous name made archiving throw after tasks had already migrated, so `/new` reported failure although the binding had already moved.
- `channel_send` now documents `bindingId` as optional and reports a wrong id as "omit it and retry" with the available bindings, instead of "no authorized binding" — that message made a model look for another delivery route.
- Ask User diagnostics gained enumerated `reason`, `stage`, `ageSeconds` and `questionVersion`, and a card that is never published now fails fast instead of leaving the request waiting for the ten-minute timeout.

## 0.5.4

- Record the Discord gateway close code, reason and connection uptime as `channel.discord-close`, and the reconnect gap as `channel.discord-resume`. A Discord-side close (4000/4001/4004) is now distinguishable from a broken transport (1006) without inspecting logs by hand.
- Discord transport now receives the shared `diagnostic` sink (Feishu already did); the user-facing status text only gains the close code.

## 0.4.70 (2026-10-18)

- Generalized proactive outbound archives from a Feishu news-only path to any Session-bound Feishu/Discord send using Channel Core's authorized outbound API.
- Persisted exact text, delivery state, platform message ID and timestamps independently of the native conversation or Dream.
- Added one model-facing read-only tool, `channel_outbound_records`, and a Session-scoped archive viewer. The temporary news-only model tool is not registered.
- Added regressions for multiple sources, Discord, pagination, idempotency, authorization and source integrity; no local news tokens or bindings are published.

## 0.5.3

- Feishu image uploads now name the stored file after its real bytes (WebP, PNG, JPEG, GIF) instead of always writing `image.png`; an explicit Feishu file name still wins.
- A freshly split segment no longer opens a card that only carries the "thinking" status; Ask User keeps its reset snapshot.
- Cards replaced during a Turn are retired when the Turn ends, so a card created just after a cut cannot stay stuck on "thinking" forever.

## 0.5.2

- Freezing the previous card no longer occupies the per-conversation send queue, so the continuation card starts streaming immediately instead of waiting for the old card to close.
- Card freezing is serialized per card id inside the transport, keeping CardKit sequences ordered when two interjections arrive back to back.

## 0.5.1

- Card segments now have a single lifetime record (generation plus last visible payload), bounded to the most recent entries and released once the final answer is delivered; this replaces the two unbounded maps.
- Final delivery slices by the same segment boundary as the live card, so an interjection never repeats text already shown on a frozen card.
- `cutProgress` reports a structured `channel.steer-cut` diagnostic (`state`, `code`, `durationMs`, no message content) with distinct codes for empty, patched, frozen and frozen-unclosed outcomes.

## 0.5.0

- Feishu: a native Steer that claims another input inside the same Turn now freezes the card that was already streaming (marked "已切换至新消息") and continues on a new card anchored to the newest user message; the final answer follows that same anchor.
- Timeline entries carry a monotonic sequence, so a segment cut stays correct after the 60-entry rollover; stream, reasoning and commentary cursors are captured with the cut.
- A CardKit generation guard stops in-flight card updates from landing after a cut, and the frozen card keeps its record when closing the stream fails.
- Discord behaviour is unchanged: steering still updates one progress card and replies once.

## 0.4.89

- Card-level degradation (question-card retirement, CardKit fallbacks, progress-card updates) now records a structured `channel.card-degraded` diagnostic instead of a channel status error, so connection health no longer reports display fallbacks as channel failures.
- `state(message, connected, scope)` gains an optional `scope`; only `channel` scope writes `channel.status-error`. Existing two-argument calls keep their behavior.
- Regression covers both directions: a card notice raises no channel status error, while a channel-level message still does.

## 0.4.88

- Fail invalidated live Ask User callbacks explicitly, release the original pending request, and retire unusable Feishu cards without interpreting old clicks as new answers.
- Feishu callback errors return actionable feedback without falsely marking the channel disconnected. Timeout remains ten minutes.
- Add privacy-safe error reason diagnostics and regression coverage of stale callbacks and timeouts.

## 0.4.66

- **A collected group no longer kills the message that discovered it:** saving the collected chat id fired the settings subscription, which rebuilt the connection and aborted the in-flight signal, so `resolveSessionWorkspace` threw and the first message in a new group produced no session and no reply. Receive-scope edits (`allowedGroups` while auto-collection owns admission) now update the applied snapshot without reconnecting; every other field still rebuilds the connection.
- **Receive scope is read per message:** the transport hands each message the current settings value, so policy edits apply immediately instead of waiting for a reconnect.

## 0.4.65

- **Feishu group auto-collection works with an existing allowlist:** the SDK policy gate dropped every group outside a non-empty `groupAllowlist` before `ChannelRuntime.receive()` could collect it. Feishu now hands the SDK an empty list while auto-collection owns admission, so a second group is remembered the first time the owner speaks in it.
- **Owner-only widening:** auto-collection now requires the sender to be listed in `allowedUsers`; strangers in other groups never extend the allowlist. `requireMention` still gates whether a collected group needs an @.

## Earlier updates

- **Single-package channels:** Discord and Feishu adapters moved into one Channel Core package with shared bridge and separate credentials, settings, and connection lifecycle.
- **Owner recognition:** Optional first-eligible-DM claim or manual owner selection, with per-channel identity verification for private memory.
- **Trusted session rotation:** Native-session handoff checks Dream evidence, identity, workspace, session cursor, and pending messages before changing channel bindings.
- **Discord message continuation:** Ask User continuation de-duplicates only verified previously delivered text and preserves same-line rewrites.
- **Discord interaction delivery:** Component actions parse the actual platform interaction ID and forward verified responses to the native handler.

See Git commit history for exact release-to-release changes. Live Feishu/Discord authentication is a separate integration test and is not guaranteed by CI.

## 公开源代码同步 · 2026-10-11

- 将公开源代码与已验证的本地 Channel Core 当前实现同步，包含 Discord 进度排版、消息积压合并、角色标题、Ask User 衔接、网络代理与正文脚注。
- Discord 最终答复使用原生消息边界区分已提交的阶段性公开文字，将其放入引用块；真正的回复保持正常 Markdown。不会把未提交的文字或私有思考当作过程草稿。
- 飞书增加 CardKit 文本组件更新与兼容回退，优化思考去重、折叠卡标题、段落布局和可选运行脚注。
- 公共 CI 仍以不依赖用户 DSH 宿主的单元测试为准；卡片权限、真实消息投递和用户账号认证需在运行环境验收。

## 2026-10-13 · 主动渠道投递

- 新增 `channel_send` Agent 工具及可信插件调用入口 `sendToBoundSession()`，复用已有 Feishu/Discord 适配器和 SQLite 持久队列。
- 仅允许向当前 DSH Session 已绑定且当前授权有效的目标发送消息；多个渠道绑定需显式选择。私聊授权撤销后不能凭旧绑定继续推送。
- 使用稳定幂等键避免重复发送，发送状态未知时禁止盲目重试，避免向群聊重复推送。
- 新增主动消息回归测试与工具输出格式测试，并区分公共 CI 的纯本地测试、需要宿主依赖的集成测试。飞书 Test 群已由本地 DSH 实机验证；公开 CI 不保证真实平台权限。

## 0.4.57 (2026-10-13)

- Discord now registers independent slash commands; Feishu adds safe `/model`, provider-only shorthand, and `/think`.
- Channel authorization and shared-session ownership are preserved.

## 0.4.62 (2026-10-16)

- Add optional task notifications, verified-owner DM routing, and stable-current-binding resolution; preserve Dream as a standalone plugin.
- Sync verified native owner `/status` dashboard integrations for Discord and Feishu, including their authorization and transport tests.
- Keep notifications disabled by default; live platform acceptance still requires an opt-in end-to-end test.
