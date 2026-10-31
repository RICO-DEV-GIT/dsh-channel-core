# 飞书多账号（多 bot）详细设计

> 状态：**待评审**（未开始实现）
> 基线：`v0.8.0`（`ef6c9df`）
> 目标读者：本仓库维护者

## 1. 目标与非目标

### 目标

1. 一个 DSH 实例可同时连接**任意数量**的飞书机器人，每个 bot 有独立的 appId / 密钥 / 工作区 / 接收范围 / 主人。
2. 账号可以**新增（扫码）**与**删除**；删除是唯一的下线方式，删除时该账号的历史数据一并清理（见 §7）。
3. 每个账号的会话、绑定、回执、主人**完全隔离**，不允许串号。
4. 每个账号的**工作区必须独立、互不重叠**（父目录/子目录也算重叠）。
5. 从 v0.8.0 的单账号配置**无损自动迁移**，失败可回滚。

### 非目标（本期不做）

- 跨账号共享同一个飞书应用（同一个 appId 连两次）。
- 账号级别的限流/配额策略。
- 账号之间迁移会话（历史绑定不跨号复用）。
- **账号级"禁用/启用"动作**：临时停连沿用账号表单里的「连接渠道」开关（`enabled`），不做独立按钮。
- **删除时保留历史**：删除即清理，不提供保留选项。
- Discord 多账号（本次只改飞书；Discord 结构保持不变，但接口允许以后扩展）。

## 2. 与 OpenClaw 的对应关系

| 维度 | OpenClaw | 本设计 |
|---|---|---|
| 账号容器 | `channels.feishu.accounts.<id>` 映射 + 隐式默认账号 | `accounts.<id>` 映射 + `defaultAccount`；迁移时把顶层提升为 `accounts.default` |
| 数量 | 无上限 | **无上限** |
| 继承 | 根配置为默认值，账号字段覆盖 | `shared` 为默认值，账号字段覆盖 |
| 添加 | `channels add` / 向导 | 设置页「新增账号」→ 复用现有扫码流程 |
| 删除 | `channels remove`（默认禁用，`--delete` 才删） | **一步删除**（配置 + 凭证 + 历史），需二次确认 |
| 停止运行时 | `channels remove` 先让 Gateway 停账号 | 删除前 `runtime.close()`，走同一串行队列 |
| 隔离 | 按 accountId 的绑定与凭证 | 已具备：`store` 全部按 `(provider, account_id)` 建键 |
| 工作区 | 每账号独立（不校验重叠） | **额外要求：全局校验不重叠** |

## 3. 数据模型

### 3.1 config v2

```jsonc
{
  "schemaVersion": 2,
  "defaultAccount": "default",          // 可选；缺省取第一个启用的账号，再缺省取字典第一个
  "accounts": {
    "default": {
      "name": "工作号",
      "enabled": true,
      "appId": "cli_xxx",
      "appSecretRef": "FEISHU_APP_SECRET",
      "domain": "feishu",
      "workspacePath": "G:\\DSWork",
      "agentPreset": "",
      "rolePreset": "",
      "memoryNamespace": "private",
      "ownerMode": "first-dm",
      "ownerUserId": "",
      "allowedUsers": [],
      "allowGroups": false,
      "autoCollectGroups": false,
      "allowedGroups": [],
      "requireMention": true,
      "inputMode": "inherit",
      "identityLinks": [],
      "attachments": true,
      "maxAttachmentMB": 10
    },
    "second": { "name": "私人号", "enabled": false, "appId": "", "appSecretRef": "FEISHU_APP_SECRET_2", "workspacePath": "G:\\DSWork-private" }
  },
  "shared": {
    "streaming": { "mode": "progress", "progress": { }, "footer": { }, "cardEngine": "cardkit", "finalFormat": "auto" },
    "throttleMs": 750
  }
}
```

规则：
- `accounts` 至少 1 项，键为 `accountId`（`^[A-Za-z0-9_-]{1,64}$`，不得重复）；
- `shared` 只放"与连接无关、可共享"的显示/节流项：`streaming.*`、`throttleMs`；
- 每账号的 `appSecretRef` 必须唯一（不同账号不能指向同一个凭证名）；
- `workspacePath`：多账号时**必须非空**且互不重叠（见 §4）。

### 3.2 迁移 v1 → v2

输入：v0.8.0 的单对象配置。

```
1. 读到旧对象 → 写备份 config.json.v1.bak（同目录，权限 0600）
2. 新对象：
   accounts.default = { 旧对象里除 streaming/throttleMs 外的所有字段 }
   accounts.default.name = 旧 accountId（若为 "default" 则省略）
   shared = { streaming: 旧.streaming, throttleMs: 旧.throttleMs }
   defaultAccount = "default"
   schemaVersion = 2
3. 保留旧字段？删除。字段读取只认 v2，避免双写歧义。
4. 若迁移后校验失败（例如工作区非法、accountId 冲突）→ 不落盘，回滚使用备份，并在页面显示原因。
```

幂等：`schemaVersion === 2` 时直接按 v2 读取；出现 v1 + v2 混合字段 → 拒绝加载并提示运行迁移。

## 4. 工作区隔离（新要求）

**定义「重叠」**（Windows 大小写不敏感）：
设 `a = path.resolve(workspacePath).toLowerCase()`，`b` 同理，重叠当且仅当：

```
a === b
|| a + '\\' 是 b + '\\' 的前缀   // a 是 b 的父目录
|| b + '\\' 是 a + '\\' 的前缀   // b 是 a 的父目录
```

**校验点**：

| 时机 | 行为 |
|---|---|
| **新增账号** | 必须先选择/填写工作区；**留空则拒绝创建**，提示「请先为该账号选择工作区」 |
| **添加机器人（扫码）** | 绑定前再校验一次：工作区为空 → 拒绝并提示；与其它账号重叠 → 拒绝并提示具体账号 |
| 保存账号配置 | 与其它账号比较；冲突则拒绝保存，提示「与账号「工作号」的工作区重叠（父/子目录）」 |
| 只有一个账号 | 允许留空（跟随 DSH 默认工作区）——保持与现在一致 |
| 两个及以上账号 | 每个都必需显式路径；任何账号为空 → **不允许新增/绑定**，提示「多账号下每个账号都必须指定独立工作区」 |

实现位置：`lib/workspace-scope.js`（新）导出 `workspaceOverlap(a, b)` 与 `assertWorkspacesDisjoint(accounts, selfId)`，纯函数、可单测（Windows/Linux 路径都覆盖）。

## 5. 运行时架构

### 5.1 关键切口：每账号一个配置视图

`ChannelRuntime` 只用 `settings.configFile` 的 4 个能力（`value` / `subscribe` / `snapshot` / `save`）。新增 `lib/channel-plugin-settings/account-view.js`：

```js
export function accountConfigView(configFile, accountId) {
  return {
    get value()            // 深冻结的 accounts[id] + shared 合并结果
    subscribe(fn)          // 文件级订阅，仅当本账号切片变化时回调
    snapshot()             // { value, revision, accountId }
    save(value, revision)  // 只写 accounts[id]；revision 是整文件修订号
    get accounts()         // 只读账号概览（id/name/enabled/appId 尾号）
  };
}
```

- `save` 未传 revision 视为冲突（与现有 `ConfigFile.save` 一致）；
- 视图对 `value` 做 `Object.freeze`，防止运行时意外改到别的账号；
- 视图不暴露 `shared` 写入（`shared` 由独立页面/接口维护）。

### 5.2 装配

`lib/channel-components.js`：

```js
for (const accountId of configFile.value.accounts.keys()) {
  const view = accountConfigView(configFile, accountId);
  const settings = new PluginConfig(ctx, { /* 同一个服务 */ accountId, view, schema, ... });
  const runtime = new ChannelRuntime(ctx, { configFile: view }, { provider:'feishu', accountId, ... });
}
```

- **服务名仍然是 `feishuChannelSettings`**，方法带 `accountId` 参数（避免 N 个服务名、N 个设置页）；
- 账号增减时重建实例：监听整文件变化 → 比对账号集合 → 新增的创建、删除的 `close()`；
- 每个账号独立 `abort`/`generation`，互不影响。

### 5.3 会话/绑定隔离（已具备）

`store` 的 `bindings`、`channel_owners`、`receipts`、`aliases` 均以 `(provider, account_id, …)` 为键；`ChannelRuntime` 的 `configure()` 已把 `config.accountId` 传给 `store.setOwner` 与 `bridge.register`。因此**每账号的消息只会进它自己的绑定**，串号在结构上就不会发生。新增一条不变量测试：两账号交叉投递，断言各自的 receipt/binding 不串。

## 6. RPC 设计

沿用现有服务 `feishuChannelSettings`，新增/调整如下（参数名即 descriptor 字段，必须与客户端一致）：

| 方法 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `getConfig` | `accountId` | `{ revision, value, details, accounts }` | 该账号视图 + 账号列表 |
| `setConfig` | `value, revision, accountId` | 同上 | 保存该账号 |
| `accountsList` | – | `[{ id, name, enabled, appIdMasked, workspacePath, connected }]` | 列表/状态（`enabled` 即「连接渠道」开关，只读展示） |
| `accountCreate` | `accountId, name` | `{ accountId }` | 建空账号（随后扫码或手填） |
| `accountRemove` | `accountId` | `{ removed:true }` | 一步删除：停运行时 + 删配置 + 删凭证 + 清历史 |
| `botCard` | `accountId` | 名片 | |
| `registrationBegin/Poll/Apply` | `accountId`（Apply 另含 `appId, openId, domain`） | 同上 | 扫码写入到指定账号 |
| `directoryCheck/Create` | `path` | 同上 | 不变 |

错误码：`account-not-found`、`account-duplicate`、`workspace-overlap`、`workspace-required`、`last-account`、`account-busy`。

（已删除 `accountDisable` / `accountEnable` 与 `keepHistory` 参数：临时停连用账号表单的「连接渠道」开关，删除一律清理历史。）

## 7. 删除语义

删除是唯一的下线动作，**不可逆**；**历史与会话记录不保留**。确认框：

```
删除账号「私人号」（cli_a1b2…c9）？
该账号的机器人绑定、会话记录、回执、主人记录与凭证将一并删除，此操作无法撤销。

[取消]  [删除]
```

执行顺序（任一步失败即中止，并把已改动的项回滚，不留半删状态）：

```
1. runtime.close()                                   // 先断开长连接
2. 清理该 (provider, accountId) 的渠道记录：
   bindings / receipts / channel_owners / aliases / aliases_config / interactions
3. 清理该账号建过的 DSH 会话（sessionController 若提供删除能力；见下）
4. accounts 移除该条目（带当前 revision 保存）
5. 删除 appSecretRef 指向的凭证（仅当没有其它账号引用它）
6. defaultAccount 指向它时 → 改为第一个剩余账号
7. 账号总数为 0 → 拒绝（last-account）
```

> **关于第 3 步的现状**：当前插件只用 `ctx.sessionController` 的
> `create / prompt / cancel / projections / modelCatalog / selectModel`，
> 没有删除方法。M3 会先探测该服务是否暴露 `delete`/`remove`：
> 有则逐个删除该账号的会话文件；**没有则删除后如实报告**「渠道记录已清理，
> N 个 DSH 会话文件仍在客户端会话列表中，需要手动删除」，不假装已清理。

## 8. UI 设计（设置页 · 飞书标签）

```
┌ 飞书机器人 ─────────────────────────────────────────────────┐
│ 账号  [工作号 ▾]   ●已连接            [+ 新增账号]          │
├─────────────────────────────────────────────────────────────┤
│ 首次使用还差这几项（当前账号）                              │
│  ⚠️ 已指定工作区目录   [选择目录…] [手动填写]                │
│                                                             │
│ （以下与现有单账号界面一致：扫码卡片 / 健康检查 / 清单 / 表单）│
├─────────────────────────────────────────────────────────────┤
│ 账号管理                                                    │
│  工作号     cli_aa8d…  G:\DSWork       ●已连接   [删除]      │
│  私人号     —          G:\DSWork-pv    ○未绑定   [添加机器人] [删除] │
└─────────────────────────────────────────────────────────────┘
```

每行操作规则：

| 账号状态 | 按钮 |
|---|---|
| **未绑定机器人**（`appId` 为空） | `[添加机器人]` → 切到该账号并直接生成扫码二维码；`[删除]` |
| **已绑定**（有 `appId`） | 该行只显示状态与 `[删除]`；更换机器人走该账号面板里的「扫码添加 / 切换机器人」 |
| 任意状态 | 顶部 `[+ 新增账号]` |

行为约定：

- **新增账号必须先有工作区**：点「+ 新增账号」先弹「选择目录…」，留空则不能创建并提示「请先为该账号选择工作区」；
- 「添加机器人」前再校验一次：工作区为空或与其它账号重叠 → 拒绝并说明原因，不出二维码；
- 切换账号只切视图，不影响其它账号的连接；
- 「删除」弹出 §7 的确认框（一步删除，无禁用、无保留选项）；
- 临时停连用该账号表单里的「连接渠道」开关，不额外提供按钮；
- 账号列表只在 ≥2 个账号时显示（单账号时界面与现在完全一致，避免干扰）；
- **账号显示名允许重名**，列表以 `名称 (accountId)` 区分，例如 `私人号 (account-2)`。

## 9. 迁移与回滚

| 项 | 方案 |
|---|---|
| 迁移前 | 复制为 `config.json.v1.bak`（同目录，0600） |
| 迁移失败 | 不写新文件；页面显示原因；继续以 v1 读取（只读模式提示需迁移） |
| 回滚 | 把 `.v1.bak` 覆盖回 `config.json` 并重启；`v0.8.0` 标签可回退代码 |
| 数据 | `state.sqlite` 不动（key 已含 accountId） |

## 10. 安全

- 凭证按账号独立命名（`FEISHU_APP_SECRET`, `_2`…），删除账号只删自己引用的 ref，且先检查是否被他人引用；
- 账号列表只显示 `appId` 掩码；密钥永不出现在列表；
- 所有新 RPC 走现有 loopback 网关，权限模型不变；
- 删除是破坏性且不可逆的操作，必须二次确认，确认框明确写出会一并删除历史与凭证。

## 11. 测试计划

| 组 | 用例 |
|---|---|
| 迁移 | v1→v2 字段完整；备份生成；非法迁移不落盘；重复迁移幂等 |
| 工作区 | 相等/父子/兄弟目录判定；大小写与斜杠差异；多账号空路径拒绝；单账号空路径允许 |
| 隔离 | 两账号交叉投递，receipt/binding/owner 互不可见；`accountId` 不匹配时 RPC 报错 |
| 生命周期 | 删除时先 close；删除最后一账号被拒；删除后运行时不再接收事件 |
| 删除 | 配置、凭证、历史三类数据都被清理；凭证被他人引用时不删；`defaultAccount` 自动改指向 |
| UI 契约 | 账号列表渲染、删除确认文案、单账号时不显示列表 |
| 回归 | 现有 328 + 120 全绿 |

预计新增 22–28 个用例，改造约 20 个既有用例（它们构造单份配置）。

## 12. 工作量与里程碑（按"直接删除、不保留历史"重估）

| 里程碑 | 内容 | 估算行数 | 验证 |
|---|---|---|---|
| M1 配置层 | v2 schema、迁移、`workspace-scope.js`、校验、单测 | 260–320 | 全量回归绿，不接 UI |
| M2 运行时 | `account-view.js`、多实例装配（无禁用/启用编排） | 170–210 | 两账号同时在线（手工） |
| M3 RPC | 带 accountId 的方法 + `accountsList`/`accountCreate`/`accountRemove` + 删除编排 | 150–190 | 客户端可用 |
| M4 UI | 账号列表/切换/新增/删除确认（无禁用按钮、无保留勾选） | 200–250 | 重启后界面验证 |
| 合计 | | **≈ 780–970 行** | 3 个验证循环 |

风险与缓解：

| 风险 | 缓解 |
|---|---|
| 迁移丢配置 | 备份 + 失败不落盘 + 三种旧形态测试 |
| 视图串号 | view 冻结 + accountId 断言 + 交叉投递测试 |
| 删除半途失败 | 顺序化、任一步失败中止并回滚已改项 |
| UI 复杂化 | 单账号时不显示账号列表，界面与现在一致 |

## 13. 已确认的决策（2026-11-01）

1. **删除即清理**，不提供禁用，不提供"保留历史"选项。
2. **多账号下工作区不能留空**：留空则无法新增账号 / 添加机器人，并提示用户先选目录。
3. **账号显示名允许重名**，列表用 `名称 (accountId)` 区分。
4. **删除后不保留会话记录**：渠道记录全部清理；DSH 原生会话文件在服务支持删除时一并删除，否则如实报告剩余数量（见 §7 注）。
5. 账号数量不限。

## 14. 仍未定（可选，不阻塞）

1. 是否需要"复制账号"（以现有账号为模板新建）？本期不做，除非你要求。
2. 删除确认框里是否列出"将被删除的会话数量"（需要在删除前统计）？建议显示，只多一行。
