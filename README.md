# 袖珍酒馆 · PocketTavern

一个移动优先、安装即用的 SillyTavern 风格单页 PWA：角色卡聊天、世界书、多后端流式接入、本地插件系统，以及可自托管的创意工坊。
原生 ES2022 + ESM，**开发态免构建**；数据只留在这台设备的 IndexedDB；没有遥测，也不会把内容发去你配置的后端之外。

> 当前版本：`0.4.0` · 演示角色：看板娘「琥珀」 · 演示世界书：琥珀的酒馆 · 创意工坊：AI 生成 / 试穿 / .ptpack 发布 · 0.4：剧情状态 / 好感 / 章节日记 / 剧情导演 / 两套预设世界
> 补丁 A/B：试穿只写 `trials` + contentHash 判重/查重合并；CCv3 内嵌书、挂载优先级与同 key 冲突高亮；群聊 natural_order。
>
> **在线版**：https://leechary337688-sudo.github.io/pocket-tavern/
> **安装包 0.4.0**：https://github.com/leechary337688-sudo/pocket-tavern/releases/tag/v0.4.0
> **旧版 0.3.0**：https://github.com/leechary337688-sudo/pocket-tavern/releases/tag/v0.3.0

---

## 一、30 秒启动

### 方式 A：带本地 mock 后端（推荐先这样看）

```bash
cd 2026-11-23-袖珍酒馆-PocketTavern
node dev/mock-server.mjs
```

打开 `http://127.0.0.1:8788/`。

mock 同时伺服静态文件和 OpenAI 兼容接口，不会联网：

| 设置项 | 值 |
|---|---|
| 接口类型 | OpenAI 兼容 |
| 后端地址 | `http://127.0.0.1:8788` |
| 模型 | `amber-mock`（或 `amber-mock-wild`） |
| API 密钥 | 任意非空字符串，如 `dev-key` |

`amber-mock-wild` 会在 temperature > 1.2 时给出更发散的文本，方便验收 #4。

### 方式 B：接自己的 OpenAI 兼容端点

```bash
# 任意静态服务器都可以；不要用 file:// 打开（ESM 和 SW 会被浏览器拦住）
python -m http.server 8788 --bind 127.0.0.1
```

设置 → 后端连接 → 填 `endpoint`、`model`、`apiKey` → 保存 → 回聊天页发送。

> 浏览器直连第三方 API 会受 CORS 限制；如果服务端不允许跨域，需要自己在同源反代一层。
> 本项目**不内置、不索要、不记录任何真实密钥**。

### 安装到主屏幕

Chrome Android：地址栏右侧菜单 →「添加到主屏幕」/「安装应用」。
需要 `http://localhost` 或 HTTPS；局域网 IP 的 HTTP 页面浏览器不会给 Service Worker 权限。

---

## 二、目录结构

```text
.
├── index.html                 # 应用壳 + 启动屏
├── manifest.webmanifest       # PWA 清单（standalone / 图标 / 快捷方式）
├── sw.js                      # 应用壳 precache + 离线导航回退
├── icons/                     # 512/192/maskable/apple-touch/favicon + logo.svg
├── plugins/
│   ├── index.json             # 本地插件索引（插件市场默认读它）
│   ├── token-counter/         # 示例插件 1：上下文占用面板
│   │   ├── manifest.json
│   │   └── plugin.js
│   ├── dice-log/              # 示例插件 2：骰子记录
│   │   ├── manifest.json
│   │   └── plugin.js
│   ├── story-status/          # 0.4 剧情状态 v2：归属/回合/成员卡/头像角标
│   ├── affection/             # 0.4 好感度：数值/档位/发糖时刻
│   ├── chapter-diary/         # 0.4 章节日记：15 回合摘要 / 48h 前情
│   └── plot-director/         # 0.4 剧情导演：伏笔/节奏/糖分
├── assets/presets/             # 0.4 预设世界 JSON（雾港夜雨 / 凤阙春深）
├── src/
│   ├── main.js                # 路由、启动、主题、引导、设置装配
│   ├── core/                  # 不依赖 UI 的纯逻辑
│   │   ├── api-client.js      # OpenAI/Claude/Gemini/Kobold/Tabby + SSE + 重试
│   │   ├── sse-parser.js      # 按 data: 行解析 SSE
│   │   ├── prompt-builder.js  # 预算、宏、世界书扫描、组装 trace
│   │   ├── mount-resolver.js  # chat>persona>character>global 挂载与同 key 冲突
│   │   ├── group-scheduler.js # 群聊点名/活跃度掷骰/round-robin/director
│   │   ├── chat-engine.js     # 会话状态机、流式、swipe、删除撤销、续写、群聊回合
│   │   ├── card-codec.js      # PNG tEXt / JSON 角色卡
│   │   ├── sampler.js         # 采样默认值与夹取
│   │   ├── tokenizer-lite.js  # 轻量估算（中文按字、拉丁按 4 字符）
│   │   └── dice-engine.js     # /roll 表达式
│   ├── data/
│   │   ├── db.js              # IndexedDB pt-db（v2，含 trials）
│   │   ├── repo.js            # 仓储门面、备份、快照、contentHash/查重合并
│   │   ├── content-hash.js    # 卡/世界书规范化 SHA-256 内容哈希
│   │   └── seed.js            # 内置琥珀卡/世界书/设置
│   ├── ext/
│   │   ├── bus.js             # 事件总线（监听器异常隔离）
│   │   ├── stlite.js          # 插件唯一宿主 API（权限清单制）
│   │   └── loader.js          # manifest 校验、动态 import、启停
│   ├── workshop/
│   │   ├── ai-gen.js          # AI 生成卡/世界书、字段级重生
│   │   ├── packer.js          # 零依赖 store-only .ptpack（zip + manifest）
│   │   ├── registry.js        # 演示源 / 远程源 / 本地发布 / 安装记录
│   │   └── trial-sandbox.js   # 3 条试聊沙盒；转正才写库
│   ├── ui/
│   │   ├── chat-view.js       # 聊天页 + 消息窗口化 + 手势 + 组装预览
│   │   ├── card-library.js    # 卡库网格/列表/搜索/tag/导入导出
│   │   ├── worldbook-view.js  # 世界书与条目编辑
│   │   ├── settings-view.js   # 右侧设置抽屉
│   │   ├── home-view.js       # 首页会话列表
│   │   ├── group-view.js      # 开群聊 / 成员、活跃度、世界书与发言模式
│   │   ├── workshop-view.js   # 工坊瀑布流/搜索/详情/试穿/导入
│   │   ├── gen-view.js        # AI 生成器（卡 / 世界书表格）
│   │   ├── publish-view.js    # 发布三步：打包 → 分级确认 → 上传/导出
│   │   ├── dice.js            # 280×320 骰子弹窗 + 撒花
│   │   ├── sound.js           # Web Audio 程序合成 + TTS
│   │   ├── overlay.js         # 通用弹层/action sheet/confirm/prompt
│   │   ├── toast.js
│   │   ├── icons.js           # 内联 SVG 图标
│   │   └── dom.js             # h()/工具
│   └── styles/app.css         # 深夜酒馆 / 白天小酒馆
└── dev/                       # 仅开发/验收用，不属于运行时
    ├── mock-server.mjs        # 本地静态 + OpenAI 兼容 SSE
    ├── check-*.mjs            # 自动验收脚本
    └── *.png                  # 巡检截图
```

约定：

- `core/` 不 import `ui/`，也不碰 DOM。
- `ui/` 组件统一 `mount(el, ctx) → { unmount }`。
- 插件只能经 `STLite` 访问宿主；不能直接 import 宿主模块。
- 运行时零依赖、零打包；`dev/` 才使用 Node 和 Playwright。

---

## 三、数据与隐私

### IndexedDB：`pt-db`（version 2）

| store | key | 内容 |
|---|---|---|
| `cards` | `id` | 角色卡（name/description/personality/scenario/first_mes/mes_example/creator/tags/avatar…） |
| `chats` | `id` | 会话与消息（索引：cardId、updatedAt；群聊含 kind/memberIds/worldIds/memberState） |
| `worlds` | `id` | 世界书与条目（`scope: library|embedded`、`embeddedFor`、`contentHash`） |
| `settings` | `key` | 单条 `app` 设置（连接、采样、提示词、声音、插件启停、UI 状态） |
| `personas` | `id` | 用户人格 |
| `trials` | `id` | **试穿沙盒**（不写 cards/worlds/chats；索引：contentHash、kind、updatedAt） |
| `extdata` | `id` | 插件命名空间数据 + `__app` 快照（索引：pluginId） |

### localStorage

只存两个 UI 态：

- `pt:theme`：`dark` / `light`
- `pt:lastChat`：最近会话 id

### 密钥与网络

- apiKey 存在本机 `settings`，不写日志、不写备份（默认）、不进插件 API。
- 插件拿到的 `STLite.settings` 是脱敏后的冻结副本；没有明文 apiKey。
- 只有你配置的端点会收到聊天内容；没有分析/遥测/第三方字体/远程图片。
- 跨域 API 响应**不进 Service Worker 缓存**。

### 备份与快照

设置 → 数据与备份：

- 导出 JSON：默认脱敏（`includesKeys=false`），可勾选包含密钥。
- 导入 JSON：覆盖式恢复 cards / chats / worlds / settings / personas / extdata。
- 每日自动快照：保留最近 7 份，可单份恢复。
- 危险区「清空并恢复演示数据」会重建内置内容。

---

## 四、角色卡

支持导入：

- **PNG 角色卡**：读 `tEXt` / `iTXt` / `zTXt` 的 `ccv3` 或 `chara` 块，base64 → UTF-8 JSON。
- **JSON**：SillyTavern V1 扁平结构，或 V2/V3 的 `{ spec, data: {...} }`。
- 兼容字段：`name / description / personality / scenario / first_mes / mes_example / creator / tags / avatar / system_prompt / post_history_instructions / alternate_greetings`。

导出：

- PNG（512×768 卡面，写入 `chara` 文本块）——SillyTavern 可回读。
- JSON。
- 卡库支持网格/列表、tag 过滤、搜索、编辑、删除、开始新聊天。

演示卡「琥珀」在首次启动时自动写入；删除后可从设置的危险区恢复演示数据。

---

## 五、世界书

新建：世界书页右上「+」。默认遵循「**一个世界一本书，角色私设嵌进卡**」——一个会话挂 1 本主世界书；角色自己的设定优先做成卡内嵌书。

条目字段：

```js
{
  uid, key: [], keysecondary: [], comment, content,
  position: 'before' | 'after', order, tokenBudget,
  recursive, selective, constant, probability: 0-100,
  caseSensitive, useRegex, enabled
}
```

扫描规则（`src/core/prompt-builder.js`）：

- 最多 **2 层**：第 1 层用用户输入 + 最近 2 条消息做种子；只有 `recursive: true` 的命中条目内容会进入第 2 层。
- 默认大小写不敏感子串匹配；`useRegex` 时可写正则；`caseSensitive` 生效。
- `selective` + `keysecondary` 需要主键与副键同时命中。
- `constant` 无条件注入（受常量预算限制）。
- `probability` 按百分比随机；`tokenBudget` 是单条上限。
- 同一 `worldId:uid` 在一次组装里只命中一次；顺序按 `order`。
- 命中内容在预览页显示「第几层、命中哪个 key、注入到 before/after、实际 token」。

### 5.1 卡内嵌书与挂载优先级

CCv3 角色卡可以带 `character_book`（卡内嵌世界书）：

- 导入 PNG/JSON 时写入卡对象并同步成一本 `scope:'embedded'` 的世界书，`character_book_id` 指回去。
- 导出时：有内嵌书的卡写 `ccv3` 块（`data.character_book`），没有则仍写 `chara`。
- 内嵌书**只有这张卡在聊天/群聊里时才挂载**；卡不在场，条目不触发。群聊里每位在场角色各带自己的内嵌书，**不占主会话的世界书名额**。
- 卡库 → 卡详情 → 编辑 → 「卡内嵌世界书」可改书名、条目 key/正文；保存会同步 `worlds` 里的嵌入态记录。

组装时的挂载优先级（高 → 低）：

```text
chat 会话显式挂载 > persona 人格 > character 卡内嵌书 > global 全局
```

- 默认一个会话只挂 **1 本**主世界书：单聊点顶栏「更多 → 世界书挂载」选一本；群聊在「群聊成员与规则 → 世界书挂载」里选。需要叠加时打开「启用多本世界书」，最多 8 本。
- 同 key 跨书冲突时，`order` 大的条目后注入；组装预览的「同 key 冲突」会列出双方与生效者，命中条目带红色「同 key 冲突」标记。
- 会话级显式挂载的书压过同 key 的卡内嵌书；内嵌书仍会参与，只是冲突时 order 决定注入顺序。

### 5.2 群聊与 natural_order

卡库顶栏「开一桌群聊」→ 选至少 2 位成员 → 开桌。

- 默认 `natural_order`：用户输入里出现成员全名就**必须**由该成员接话；没有点名时按每位成员的 `talkativeness`（0–1，默认 0.5）掷骰决定谁接，可能没人接（会提示可以点名）。
- 保留 `round_robin`（轮流）、`director`（每轮固定顺序）、`mention`（只回应被点名者）。
- `allow_self_responses` 默认关；开启后同一角色可连续发言。
- 群聊每轮最多 3 个角色发言，消息记录 `speaker`/`cardId`，头像与名字按发言人显示。
- 群聊顶栏「群聊成员与规则」可改标题、成员、活跃度、世界书与发言模式。
- **角色互聊链**：角色回复里整词提到另一位在场成员时，被提到的人会被排到下一棒；仍受最多 3 人限制。测试覆盖「A 被点名先答 → 文本提到 B → B 接话」。
- 中途加人：单聊顶栏「更多 → 邀请角色 · 转为房间」会保留已有消息，把会话升级为房间（`kind=group`），并补一条入座提示。

### 5.3 房间：一本世界书 + 几位角色

首页「开一个房间」是房间的主入口（卡库顶栏的「开一桌群聊」是同一个编辑器的快捷方式）。

- 一个房间 = 1 本主世界书 + 至少 2 位在场角色；主书默认只挂 1 本，需要叠加时在编辑器里显式打开「启用多本世界书」（最多 8 本）。
- 角色卡自己的内嵌书会随角色在场自动激活，**不占**主书名额。
- 房间仍是 `chats` 表里的一条 `kind='group'` 会话，不新增数据库表；因此旧会话、备份、导出全部兼容。
- 房间顶栏显示「房间 · N 位」，菜单里可直接改成员/规则/世界书，或继续邀请角色。
- 单聊也可以先开，再「邀请角色 · 转为房间」；不会丢历史消息。
- 群聊里「角色 A 提到角色 B，B 没接话」在 0.3.0 修复，0.4 继续保留：生成回合结束后会扫描角色文本，按全名匹配尚未发言的成员，插入下一棒；最多 3 人，避免自问自答/死循环。

---

## 六、Prompt 组装与预算

入口：聊天页右上「组装预览」按钮。

分区顺序：

1. 系统提示（角色扮演约束 + 用户自定义 system + 内容分级 + 临时 `/sys`）
2. 世界书常量
3. 角色卡（描述 + 人格 + 场景 + 示例对话）
4. 世界书触发 before
5. 世界书触发 after
6. 最近聊天记录（倒序取，按时间正序发）
7. 用户输入 + EOS

预算比例：系统 10% / 世界书常量 5% / 角色卡 35% / 世界书触发 25% / 聊天记录 20%。

**预算基数的口径**：不是直接拿 `context_window` 乘百分比，而是：

```text
available = max(512, context_window - reserveOutput)
reserveOutput = min(max_tokens, floor(context_window / 2))
```

默认 `context_window=8192`、`max_tokens=2048`，所以可用组装预算为 `6144`；输出预留 `2048`。
这样比直接按 8192 分配更保守，避免请求超窗。

超限时：

- 先逐条丢最旧的聊天记录；
- 仍超限则依次压缩 after → before → 世界书常量 → 角色卡 → 系统提示；
- 组装预览会列出 `dropped` 和每个分区的实际 token。

---

## 七、后端接入

连接配置：

```js
{
  endpoint: 'http://127.0.0.1:8788',
  apiType: 'openai' | 'claude' | 'gemini' | 'kobold' | 'tabby',
  apiKey: '',
  model: 'amber-mock',
  extraHeaders: {}
}
```

| apiType | 聊天请求 | 拉模型 |
|---|---|---|
| `openai` / `tabby` | `POST {endpoint}/v1/chat/completions` (`stream:true`) | `GET {endpoint}/v1/models` |
| `claude` | `POST {endpoint}/v1/messages` | `GET {endpoint}/v1/models` |
| `gemini` | `POST {endpoint}/v1beta/models/{model}:streamGenerateContent?alt=sse` | `GET {endpoint}/v1beta/models` |
| `kobold` | `POST {endpoint}/api/extra/generate/stream` | `GET {endpoint}/api/v1/model` |

- SSE 按 `data:` 行解析；兼容非 SSE 的一次性 JSON。
- 30s 空闲超时；只有在**尚未收到任何 token**时才指数退避重试 2 次（500ms/1000ms + jitter）。
- 采样默认：temperature 0.7 / top_p 0.9 / top_k 40 / min_p 0.05 / rep_pen 1.1 / presence 0 / frequency 0 / seed -1 / max_tokens 2048 / context_window 8192。
- 错误的 `apiKey` / `secret` / `Bearer` 会被 `redact()` 替换，不进入 UI 错误文本。

---

## 八、插件开发

### 8.1 目录与 manifest

```text
plugins/<id>/
├── manifest.json
└── plugin.js
```

```json
{
  "id": "my-plugin",
  "name": "我的插件",
  "version": "1.0.0",
  "author": "you",
  "description": "一句话说明",
  "entry": "plugin.js",
  "minAppVersion": "0.1.0",
  "permissions": ["storage"]
}
```

- 目录名必须等于 `id`；`entry` 相对插件目录。
- 当前所有入口都必须是 ESM；加载器用 `import('/plugins/<id>/<entry>?v=<version>')`，所以升级版本即刷新。
- `permissions` 只能是 `storage` / `network` / `tts`。
- `minAppVersion` 高于当前 `0.1.0` 会拒绝加载。
- 插件要出现在设置里，需要写进 `/plugins/index.json` 的 `plugins` 数组（或由市场索引发现；远程安装尚未实现）。

### 8.2 插件模块

```js
export default {
  async init(STLite) {
    STLite.ui.registerPanel({
      icon: '📊',
      title: '我的面板',
      render(el) {
        el.textContent = `当前 ${STLite.chat.getMessages().length} 条消息`;
      },
    });

    STLite.eventSource.on('chat:messageReceived', ({ message }) => {
      // message 是副本，改它不会改宿主消息
      console.log('收到新回复', message.id);
    });
  },

  unload() {
    // 可选；注册的面板/快捷回复会由宿主清理，定时器/外部监听要自己清
  },
};
```

`init` 抛错只会隔离该插件（toast + 设置里显示错误），不会中断主程序。
每个插件的 `unload`、注册的 panel/quickReply 和 `eventSource` 监听都会在禁用时清理；**插件自己的 `setInterval` / `addEventListener` 必须在 `unload` 里清掉**。

### 8.3 事件清单

| 事件 | payload | 触发时机 |
|---|---|---|
| `app:ready` | `{ version, plugins }` | 启动完成、插件加载后 |
| `chat:promptReady` | `{ chatId, prompt, trace, card }` | 每次请求前；`prompt` 是可直接修改的 messages 数组 |
| `chat:messageSent` | `{ chatId, message }` | 用户消息已写入 |
| `chat:messageReceived` | `{ chatId, message, usage }` | 角色回复完成 |
| `chat:generateAfter` | `{ chatId, message }` | 回复完成、落库后 |
| `chat:messageEdited` | `{ chatId, message }` | 消息编辑保存后 |
| `chat:changed` | `{ chatId, chat }` | 会话结构变化（新增/删除/切换 swipe/fork 等） |

`chat:promptReady` 是唯一允许插件**改请求**的钩子：

```js
STLite.eventSource.on('chat:promptReady', ({ prompt }) => {
  prompt.push({ role: 'system', content: '记得用中文回答。' });
});
```

注意：改坏了由插件自己负责；宿主不会回滚。

### 8.4 宿主 API

| API | 说明 |
|---|---|
| `STLite.eventSource.on/off(event, handler)` | 只接受上表 7 个事件；插件不能 `emit` |
| `STLite.chat.getMessages()` | 当前会话消息的浅拷贝（含 swipes） |
| `STLite.chat.getChatInfo()` | 当前会话元信息 |
| `STLite.chat.getState()` | `idle` / `streaming` / `paused` / `error` |
| `STLite.chat.getLastPromptTrace()` | 最近一次组装 trace 的深冻结副本 |
| `STLite.character` | 当前角色卡只读深冻结副本；无会话时为 `{}` |
| `STLite.settings` | 脱敏设置只读深冻结副本（无 apiKey 明文） |
| `STLite.storage(id?)` | 插件自己的 IndexedDB 命名空间；未声明 `storage` 则全部 reject；不能访问别的插件 |
| `STLite.ui.registerPanel({icon,title,render(el)})` | 注入设置页「插件面板」；返回注销函数 |
| `STLite.ui.registerQuickReply({label,onTap})` | 注入聊天快捷栏；最多显示 4 个，多出归「更多」 |
| `STLite.chat.getMembers()` | 当前会话成员（`id/name/avatar/memberState/talkativeness`）；`memberState` 为 `active/away/dead` |
| `STLite.chat.getMounts()` | 当前组装实际挂载的世界书（用于伏笔扫描） |
| `STLite.chat.setMemberState(id,state)` | 主持人手动改成员在场状态；会触发 `chat:memberChanged` |
| `STLite.llm.complete(messages,{temperature,maxTokens})` | 需 `network` 权限；走当前后端、全局串行、20s 超时、失败静默返回 `null`；不写聊天记录、不进 prompt trace |
| `STLite.ui.registerMemberCard({title,render(el,member)})` | 在角色档案里注入「单角色状态卡」；返回注销函数 |
| `STLite.ui.jumpToMessage(id)` | 滚动到指定消息并闪一下；用于发糖/状态日志回跳 |
| `STLite.ui.registerAvatarDecorator(resolve)` | `resolve({card,message,chat,members})` 返回 `{state,badge,label,title,location,className}`；`state` 可为 `normal/hurt/dead/alert` 或 `{badge,className}` 自定义态；只影响头像外观 |
| `STLite.ui.toast(message)` | 宿主 toast |
| `STLite.dice.roll('1d100+5')` | 与 `/roll` 同一个骰子引擎 |
| `STLite.tokenizer.estimate(text)` | 轻量 token 估算 |
| `STLite.tts.speak(text, opts)` | 需 `tts` 权限；否则抛错 |
| `STLite.net.fetch(...)` | **仅当声明 `network` 时存在**；直通浏览器 fetch，宿主不代理、不加密钥 |

### 8.5 边界与审计

- 这是 **API 层权限清单制，不是 JS 沙箱**。插件代码仍然运行在同源主线程，第三方插件必须自己审计源码。
- 不给插件明文 apiKey；`settings` 是脱敏副本。
- 插件不应该查询/修改宿主其它 DOM 节点；`registerPanel` 的 `el` 是它唯一该渲染的区域。
- 未声明 `network` 时 `STLite.net` 根本不存在；声明了也只受浏览器 CORS 约束。
- 插件不能主动 emit 宿主事件，不能访问别的插件 storage。
- 设置页的「插件市场」默认读本地 `/plugins/index.json`；可填远程索引 URL **只展示条目**，远程安装明确未实现。

### 8.6 示例插件

- `plugins/token-counter/plugin.js`：每 1200ms 读 `chat.getMessages()`、`getLastPromptTrace()`、`settings`，画占用/预算/分区/世界书命中；禁用时清 interval。
- `plugins/dice-log/plugin.js`：用 `storage` 存最近 30 次掷骰；注册快捷栏 `🎲 d20`；面板可掷 d20/d100、清空记录。

这两个插件都只声明 `storage`，不联网。

0.4 内置 4 个剧情插件（都只声明自己需要的权限，不读 apiKey）：

- `plugins/story-status/plugin.js`（剧情状态 v2）：26 种状态；优先解析角色文本里的 `[状态] {"target":"琥珀","add":["流血"],"turns":2}`，target 必须在场；无结构化行时，关键词只归发言者本人，绝不甩给全队。状态按回合掉层/到期，写日志，死亡免疫其它状态；注册头像装饰（多状态按 death>dot>control>buff>emotion 取最高角标）和角色状态卡（可手动移除 / 切在场·暂离·退场）。
- `plugins/affection/plugin.js`：解析 `[好感] {"target":"player","delta":5}`，每对 -100~100，按档位显示；delta≥8 记「发糖时刻」，点记录跳到原消息。
- `plugins/chapter-diary/plugin.js`：每 15 个用户回合用 `STLite.llm.complete` 生成 ≤120 字章节摘要；间隔超过 48 小时回来，会经 `chat:promptReady` 注入最近两章「前情提要」；可改名/删除。
- `plugins/plot-director/plugin.js`：扫当前挂载世界书里带「真相/伏笔/暗线/秘密」的条目，列未回收伏笔（不剧透）；连续 10 条无明显转折时注入节奏提示；糖分密度 0–3 可调。

---

## 九、创意工坊

入口：首页「创意工坊」按钮，或 `#/workshop`（manifest 也有快捷方式）。
生成器：工坊右上 `✦`，或 `#/workshop/gen`。设置抽屉的「创意工坊」卡负责远程源、生成模型/温度/语言。

### 9.1 AI 生成器

走**当前已配置的后端连接**（设置 → 后端连接），不另存密钥；可以只给生成器换一个模型：

- 角色卡：一句想法（≤100 字）→ 严格 JSON（name / description / personality / scenario / first_mes / mes_example / tags）。
- 字段级重生：字段卡左滑，或点字段旁的「重生」；只重写该字段，其他字段不动。
- 世界书：粘贴设定（≤2000 字）→ 5–15 条，表格编辑 comment / key / content；重复或空 key 红色高亮；拖 `⠿` 排序；单条 content 写入前按 200 token 截断。
- 生成温度默认 0.9，可调 0.5–1.2；语言可跟随输入，或固定中文/English。
- 生成结果只是草稿，**不会自动入库**。卡点「转正」才写卡库并建正式会话；世界书点「存入世界书」才写库。
- 草稿会自动存到 IndexedDB（`extdata` 的 `__workshop/drafts`）：输入一句想法、生成一半、返回工坊或刷新页面，再回来会提示「已恢复上次草稿」，可点「清空草稿」。
- 发布成功后会清空旧筛选并自动跳到工坊列表，新作品可见；发布只是「上架」，不是「转正入库」，要正式聊天仍需点作品详情里的「直接导入」或「试穿 → 转正」。

### 9.2 试穿沙盒

工坊详情 →「试穿 · 开 3 条试聊」：

1. 自动放入卡的 `first_mes`；
2. 自动发一条用户试探；
3. 用当前连接生成一条角色回复。

试聊状态只写 IndexedDB 的独立 `trials` store，**不写 cards / chats / worlds**；同一个试穿记录反复切字段/发消息也只更新这一条 trial。
「转正」是唯一实体化入口：先按 `contentHash`（SHA-256 前 16 位）查重——同 hash 直接复用已有卡/书并绑定；同名但不同 hash 会弹「已存在同名世界书《X》」，让你选「复用旧的」或「并存为《X(2)》」。转正按钮幂等，重复点不会重复建卡/书/会话。
「丢弃，零残留」只删 trial 记录，正式库一条不动。

设置 → 数据 →「查重合并」可列出现存同 hash / 同名的世界书，选择保留本后一键把被删记录绑定的会话、卡的 `character_book_id` 与内嵌内容改绑到保留记录。世界书列表每条显示 `#hash`、绑定会话数与「嵌卡/馆藏」。

### 9.3 .ptpack 格式

`.ptpack` 是 **store-only zip**（不压缩、零依赖），内含：

```text
manifest.json
card.json      # type=card|bundle
world.json     # type=world|bundle
```

```json
{
  "format": "ptpack",
  "type": "card | world | bundle",
  "id": "pt-card-...",
  "title": "作品标题",
  "version": "1.0.0",
  "author": "作者",
  "tags": ["tag"],
  "contentRating": "general | mature",
  "changelog": "首个版本。",
  "description": "简介",
  "files": ["manifest.json", "card.json"],
  "createdAt": "2026-11-23T..."
}
```

打包器只写白名单字段；不会带 apiKey、设置、聊天记录。
卡有内嵌书时，`card.json` 会带 `character_book`（name + 条目），导入端重新生成嵌入态世界书；不会带原卡的 `character_book_id`。
读取时拒绝路径穿越、压缩条目和流式 zip 条目。

### 9.4 自托管工坊端点

设置 → 创意工坊 → 自托管端点，例如 `https://workshop.example.com`。
客户端只发作品查询/发布，**不带 API Key、不带账号**（客户端没有账号体系）：

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/list?type=card&q=&sort=new` | `{ items: [...] }`；`sort` 支持 `new` / `hot` / `rating` |
| `GET` | `/api/item/:id` | `{ item: {...} }` |
| `POST` | `/api/publish` | body 是 `.ptpack` 的 `application/zip`；返回 `{ item: {...} }` |

Item 至少包含 `id/type/title/author/tags/version/contentRating/cover?/rating/downloads`；`card` / `world` 可随列表或详情返回。
远程失败（超时、CORS、离线）不会抛到页面：回退到本地缓存 + 内置演示 + 本地发布，并显示离线提示。
关闭「启用远程工坊源」后完全走本地；关掉「显示内置演示源」则只剩缓存/本地发布。

### 9.5 浏览、导入与更新

- 两列瀑布流，搜索标题/作者/描述/tag，按类型、tag、`new/hot/rating` 过滤，18+ 默认隐藏。
- 详情可「直接导入」：卡/世界书写入本地库，并记录 `{id, version}` 到 `__workshop` 的 extdata。
- 再次打开同一作品，若远程版本更高，按钮显示「更新到本地」；版本比较用数值段。
- 详情可「导出 .ptpack」，下载当前作品。

### 9.6 明确边界

- 远程安装的是**作品数据**，不是插件代码；插件安装仍是另一套 `/plugins` 机制。
- 评分/下载量只读展示；客户端没有评分写入口，也不伪造数字。
- 本地发布存 extdata `__workshop/state`，不会自动上传；只有配了远程端点并点「发布到远程工坊」才发网络请求。
- `.ptpack` 只支持 store 模式；第三方压缩工具重新压过的 zip 会被拒绝（明确报错）。

---

## 十、验收结果

自动脚本都在 `dev/`，需要先启动 mock：

```bash
node dev/mock-server.mjs
node dev/check-pwa.mjs
node dev/check-installable.mjs
node dev/check-backup.mjs
node dev/check-resume.mjs
node dev/check-stress.mjs
node dev/check-swipe-delete.mjs
node dev/audit-taps.mjs
node dev/check-workshop.mjs
node dev/check-ws-import.mjs
node dev/check-ws-settings.mjs
node dev/check-ws-320.mjs
node dev/check-gen.mjs
node dev/check-world-gen.mjs
node dev/check-publish-320.mjs
node dev/check-ws-offline.mjs
node dev/check-ws-remote.mjs
node dev/check-patch-v2.mjs
node dev/check-group-ui.mjs
node dev/check-dedupe.mjs
node dev/check-trial-conflict.mjs
node dev/check-trial-discard-streaming.mjs
node dev/check-cardbook-ui.mjs
node dev/check-ptpack-book.mjs
node dev/check-world-hash.mjs
node dev/check-world-mount.mjs
node dev/check-world-create.mjs
node dev/check-preview-mounts.mjs
node dev/check-v3.mjs
node dev/check-04-smoke.mjs
node dev/check-04-status.mjs
node dev/check-04-presets.mjs
node dev/check-04-preset-ui.mjs
node dev/test-04-plugins.mjs
node dev/check-04-member-state.mjs
node dev/check-04-affection-ui.mjs
node dev/check-04-320.mjs
```

| # | 验收项 | 状态 | 证据 |
|---|---|---|---|
| 1 | 添加到主屏后独立窗口、图标、启动页 | ✅ | `check-installable.mjs`：非隐身持久化 profile 下 `installabilityErrors=[]`，manifest 无解析错误；实际「安装」按钮需在浏览器 UI 里人工点一次 |
| 2 | 导入 PNG ccv2，字段/头像完整 | ✅ | `dev/fixtures/test-ccv2.png` 导入后 1→2 张卡，头像/描述/tags/开场白完整 |
| 3 | 本地 OpenAI 兼容端点流式、打字机光标 | ✅ | mock SSE，手动发送完成；`dev/shot-chat.png` 等 |
| 4 | temperature=1.5 发散且重启保留 | ✅ | 设置滑杆改 1.5，reload 后仍 1.5；mock wild 更发散 |
| 5 | key=酒馆 命中，组装预览可见注入 | ✅ | 预览显示「酒馆环境 / 琥珀的酒馆 / 113 tok / 已注入」 |
| 6 | 删除中间消息「含后续」+5s 撤销 | ✅ | 5→1 条，撤销条 5s，撤销 1→5 |
| 7 | swipe 第 3 条切回第 1 条不串 | ✅ | 3/3 → 1/3 → 3/3，文本与最初一致 |
| 8 | token-counter 启停面板出现/消失 | ✅ | 开关停用后面板消失，再启用恢复 |
| 9 | 备份导出再导入一致（密钥可选） | ✅ | `check-backup.mjs` 输出 `BACKUP OK` |
| 10 | 后台 30s 断流回前台续播/提示 | ✅ | `check-resume.mjs` 输出 `RESUME OK`；隐藏态 3 次失败→已暂停→可见后第 4 次补全 |
| 11 | Lighthouse PWA 全过 + 飞行模式刷新 | ✅ | Lighthouse 11.7.1 PWA 得分 100；`check-pwa.mjs` 输出 `PWA OK`，报告 `dev/lighthouse-pwa.json` |
| 12 | 连发 20 条滚动流畅 | ✅（用 120 条压测） | `check-stress.mjs`：p95 帧间隔 7.1ms，窗口化只挂 26 条 |
| 13 | 生成卡 7 字段；重生 first_mes 仅该字段变化 | ✅ | `check-gen.mjs`：`fieldCount=7`、`draftName=失忆的海盗船长`、`changedFields=["first_mes"]` |
| 14 | 试聊 3 条转正入库并开会话；丢弃零残留 | ✅ | `check-workshop.mjs`：丢弃前后均 1 卡/1 聊；转正后 2 卡/2 聊并跳 `#/chat/...` |
| 15 | 发布 .ptpack 后工坊可搜到并试穿；离线可用 | ✅ | `check-gen.mjs` 导出 1733B `.ptpack` 并回读 manifest/card，本地发布后列表可见且可试穿；`check-ws-remote.mjs` 远程发布/列表；`check-ws-offline.mjs` 离线仍显示 3 件演示作品 |
| 16 | 关闭远程源后 AI 生成仍走本地端点 | ✅ | 生成/试穿/发布全程 `workshop.remoteEnabled=false` + 本地 mock；`check-gen.mjs`、`check-workshop.mjs` 均无远程请求错误 |
| 21 | 卡内嵌书随卡导出再导入；A 在场触发、A 不在场不触发 | ✅ | `check-patch-v2.mjs` 10/10：导出 ccv3 → 重导入 `scope=embedded`；A 在场命中「四海阁的私藏」，换卡后不命中 |
| 22 | 群聊点名成员 B，下一条必定 B 发言 | ✅ | `check-patch-v2.mjs`、`check-group-ui.mjs`：`speaker=程墨白`；群聊引擎 natural_order |
| 17 | 工坊草稿自动保存/恢复，刷新不丢 | ✅ | `check-v3.mjs`：纯想法草稿恢复、生成中 7 字段卡恢复，`gen-draft-bar` 可见 |
| 18 | 发布新作品后工坊列表可见，不被旧筛选藏住 | ✅ | `check-v3.mjs`：发布后自动跳 `#/workshop`，新标题在列；`check-gen.mjs` 也覆盖 |
| 19 | 首页开房间；单聊中途邀请角色转房间且保留消息 | ✅ | `check-v3.mjs`：`kind=group`、2 成员、房间徽标；单聊转群前后消息数不变 |
| 20 | 角色 A 提到 B 时 B 接话；头像随受伤/死亡变化 | ✅ | `check-v3.mjs` 9/9：`replies=["程墨白","琥珀"]`，UI 发言人正确；`check-04-status.mjs` 4/4 + `test-04-plugins.mjs`：受伤/死亡/情感角标、`[剧情状态]` 注入、成员状态卡 |
| 补 | 补丁 A：试穿只写 trials、转正幂等/判重、丢弃零残留、查重合并 | ✅ | `check-trial-conflict.mjs` 7/7、`check-dedupe.mjs` 11/11、`check-cardbook-ui.mjs` 10/10；`check-trial-discard-streaming.mjs` 5/5（流式中途丢弃 trial 不复活） |
| 补 | 补丁 B：挂载优先级、同 key 冲突高亮、群聊成员/活跃度/内嵌书 | ✅ | `check-preview-mounts.mjs` 5/5、`check-group-ui.mjs` 10/10、`check-world-hash.mjs` 5/5、`check-world-mount.mjs` 11/11 |
| 23 | 一人受伤不污染全队 | ✅ | `test-04-plugins.mjs` 14/14：琥珀流血、程墨白无状态；关键词只归发言者 |
| 24 | `[状态]` 回合递减、到期移除并写日志 | ✅ | `test-04-plugins.mjs`：流血 `turns=3` 经 3 回合移除，`log[0].type=expire` |
| 25 | 情感角标 + 多状态优先级 | ✅ | `test-04-plugins.mjs`：心动 💗；心动+流血取 🩸（death>dot>control>buff>emotion） |
| 26 | 好感 +5 增长、60 跨档、delta≥8 发糖 | ✅ | `test-04-plugins.mjs`：12×5=60；delta 10 记发糖条目 |
| 27 | 15 回合章节摘要、48h 前情提要 | ✅ | `test-04-plugins.mjs`：第 15 回合生成「摘要正文」；49h 旧会话 `chat:promptReady` 注入【前情提要】 |
| 28 | 预设载入 12 卡 + 主书 + 内嵌书、重复幂等 | ✅ | `check-04-presets.mjs` 8/8、`check-04-preset-ui.mjs` 6/6；雾港 12 卡/22 条、凤阙 12 卡/18 条 |
| 29 | dead 不进骰池、点名 toast、回归恢复 | ✅ | `check-04-member-state.mjs` 8/8：dead 被点名只由琥珀接话，toast「已退场（可在回忆中相见）」；切回 active 后墨羽恢复发言 |
| 30 | 三插件禁用零残留、旧数据不崩 | ✅ | `check-04-member-state.mjs` 8/8：四插件禁用后面板/头像角标为 0；重新启用无 pageerror |

补充：

- 运行时 JS/JSON（`src/` + `plugins/`，共 54 个文件）实测 raw 708.7KB / gzip 210.5KB，满足首屏 JS gzip < 300KB。
- 320 / 360 / 390 / 430 宽均无横向滚动（`overflow=0`）；320 下快捷栏自动折成两行。
- 触达审计：首页/卡库/世界书/聊天/设置/工坊/生成器全部 0 个 <44×44。
- 会话列表右滑删除：`check-swipe-delete.mjs` 输出 `SWIPE DELETE OK`（右滑 96px 露出删除，确认后删掉）。
- 离线刷新：`PWA OK`，截图 `dev/pwa-offline.png`。
- Lighthouse：`npx --yes lighthouse@11.7.1 http://127.0.0.1:8788 --only-categories=pwa --chrome-path=<Chrome> --chrome-flags="--headless=new --no-sandbox"`，PWA 得分 **100**，原始报告 `dev/lighthouse-pwa.json`。

---

## 十一、已知限制 / 明确未实现

- **Lighthouse PWA 已在交付机跑过（11.7.1，得分 100）**；真实「添加到主屏幕」仍需你在非隐身 Chrome 里点一次（CDP `installabilityErrors=[]`）。
- **群聊是顺序发言**：每轮最多 3 位角色依次生成（不是并行/同屏抢话）；`natural_order` 的点名规则只匹配成员名全词，昵称/代词不触发。
- **角色互聊链受 3 人上限**：A 的文本提到 B 时 B 会被排到下一棒，但如果一轮已经排满 3 人、或 B 已在本轮发过言，就不会再追加；避免自问自答和无限套娃。
- **房间仍是会话**：一个房间 = 一本主书 + 角色；没有独立的“世界/房间”数据表，跨会话不会共享上下文，也不存在“多本书全局全开”。真正的串台只会发生在手动叠加多本主书或全局书时。
- **头像状态是启发式与结构化混合**：0.4 story-status 优先读 `[状态]`，没有结构化行时才按关键词归给该发言者；它仍然不是权威战斗系统，历史消息只按最近 60 条回扫。状态会跟着会话全局显示，不会逐条消息回放历史状态。
- **内容哈希判重是“内容级”的**：字段完全相同的内嵌书/世界书会按设计合并；确实要保留两个一模一样的世界书时，得改一个字段再另存。
- **旧幽灵副本不自动删**：v0.2 已修新导入；历史遗留的同名副本请在「设置 → 数据 → 查重合并」里手动合并，删前会展示绑定会话数。
- **远程插件安装未实现**：市场只读本地/远程 JSON 索引，不会下载代码；设置页有明确文案。
- **浏览器直连 API 受 CORS 限制**；没有内置代理，因为「不向配置端点之外传数据」。
- **TTS 依赖系统语音**：`speechSynthesis` 没有 zh-CN 音色时只会 toast，不会假装朗读。
- **窗口化估算**：>100 条时用估算高度撑滚动条，日期分隔头高度未单独计入估算；滚动中可能有几像素抖动，不影响功能。
- **图片消息**只预留了 12px 圆角样式，当前消息模型是纯文本 + swipe；没有做图片上传/多模态。
- **分支**是复制式 fork（不是共享引用的树）；fork 后两边独立。
- **单聊 500 条**上限：达到后发送会提示先归档/导出；不做自动删除。
- **每日快照**在启动时检查，不是后台定时器；当天没打开应用就不会产生新快照。
- **插件 API 不是安全沙箱**：权限是 API 层清单制，第三方插件仍需审计。
- **创意工坊端点要自建**：客户端只定义 `/api/list`、`/api/item/:id`、`/api/publish` 契约；没有内置公网服务，也没有账号/评分写入口。
- **`dev/mock-server.mjs` 的工坊数据只在内存**：重启进程后远程发布的作品消失；正式端点请持久化。
- **.ptpack 只支持 store 模式**：第三方工具重压缩过的 zip 会被明确拒绝；这是为了避免引入解压依赖。
- **AI 生成质量取决于模型**：严格 JSON 靠提示词约束，模型不听话时会报「JSON 解析失败」，重试或换模型即可。
- **试穿沙盒不做多轮长上下文**：3 条自动试聊 + 手动追加；丢弃即销毁，不参与正式预算统计。

---

## 十二、开发备注

- 改源码后如果浏览器还跑着旧版：DevTools → Application → Service Workers → Unregister，清 `pt-shell-*` 缓存；或把 `sw.js` 顶部 `VERSION` 加一。
- 所有 JS 可做语法检查：

```bash
node --check src/main.js
node --check src/core/*.js
node --check src/ui/*.js
node --check src/ext/*.js
```

- 真实密钥不要写进 `dev/`、截图、README 或任何提交。
- `dev/mock-server.mjs` 只用于本地验收，监听 `127.0.0.1`；不要暴露到公网。

---

## 十三、设计口径速查

- 背景 `#17110D`，卡片 `#221A14`，正文 `#EFE6DA`，次级 `#A8988A`，琥珀 `#E8A33D`，危险 `#C94F3D`。
- 用户气泡 `#3A2C1E`、角色气泡 `#2A2119`；气泡最大宽 78%，圆角 16，尾巴 8。
- 顶栏 56px + `backdrop-filter: blur(12px)`；快捷栏/输入栏触达 ≥44。
- 设置抽屉宽 85%、最大 360px；骰子弹窗 280×320、圆角 24。
- 字体只用系统中文栈，不请求远程字体。
- 声音全部 Web Audio 合成；设置内可总开关与调音量。
- `prefers-reduced-motion` 下会关闭大部分动画。

如果只想快速看效果：`node dev/mock-server.mjs` → 打开 `http://127.0.0.1:8788/` → 跳过引导 → 点「与琥珀的雨夜」→ 在设置里填 mock 连接 → 发送。

---

## 十四、0.4 剧情层（0.4.0）

0.4 在房间模型上继续往「跑剧情」走，不新增 IndexedDB store，插件数据走 `extdata`。

### 14.1 房间与成员状态

- 一个房间 = 1 本主世界书 + 几位角色。单聊也可在「更多 → 世界书挂载」挂 1 本馆藏主书；群聊可在「启用多本世界书」高级模式挂最多 8 本。卡片内嵌书不占名额，角色在场才激活。
- 群聊自然顺序：上一条整词点名 → 被点名者必接；其余成员按 `talkativeness` 掷骰；`allow_self_responses` 控制连说。角色 A 的生成文本里提到 B，B 会在下一棒接话（每轮最多 3 位）。
- 成员状态 `active / away / dead`：dead 不进骰池，被点名时提示「TA 已退场（可在回忆中相见）」；away/dead 头像灰化；角色状态卡可一键切回在场。

### 14.2 结构化状态与好感

角色可以输出（只认单行 JSON）：

```text
[状态] {"target":"琥珀","add":["流血"],"stacks":2,"turns":3,"note":"玻璃划伤"}
[好感] {"target":"player","delta":5}
```

- 状态：26 种，`add/remove` 可多个；`turns` 按 `chat:generateAfter` 回合递减，到期移除并写日志；死亡免疫其它状态；护盾到期提示碎裂。
- 好感：每对 `-100..100`；档位「敌意/陌生/信任/心动/挚爱」；`delta≥8` 记发糖时刻，可点回原消息。
- 归属规则：结构化 payload 的 `target` 必须当前在场；无结构化的关键词只归该消息发言者本人；不会出现「一人受伤全队流血」。
- 正文里不会显示 JSON 行（复制/朗读/操作菜单也走清洗文本）。

### 14.3 预设世界

入口：设置 → 数据与备份 →「载入预设世界」，或首次引导第一步的「载入一套预设世界」。预设**不会自动写库**，必须点「载入」并确认。

| id | 名称 | 体量 | 内容分级 |
|---|---|---|---|
| `fog-harbor` | 雾港夜雨 | 12 卡 / 主书 22 条 / 12 本内嵌书 / 4 快捷回复 | general（男性向悬疑·情感） |
| `phoenix-palace` | 凤阙春深 | 12 卡 / 主书 18 条 / 12 本内嵌书 / 4 快捷回复 | general（女性向权谋·情感） |

- 同一 preset 重复载入按 `contentHash` 判重：同版本直接跳过，旧版本原位更新；不会产生同名副本。
- 预设文件：`assets/presets/fog-harbor.json`、`assets/presets/phoenix-palace.json`；生成脚本 `dev/make-presets.mjs`。
- 主书分三层：常识层（默认注入）、真相层（`selective + keysecondary`，命中才注入）、节拍层（`comment` 第 N 幕，不直接注入）。卡面不写反转秘密。

### 14.4 0.4 验收脚本

```bash
node dev/check-04-smoke.mjs          # 插件加载 / 设置卡
node dev/check-04-status.mjs         # 状态归属 + 档案状态卡
node dev/check-04-presets.mjs        # 两套预设 / 幂等
node dev/check-04-preset-ui.mjs      # 设置入口 / 选择器 / 写库
node dev/test-04-plugins.mjs         # 23–27 插件级：归属/回合/优先级/好感/日记
node dev/check-04-member-state.mjs   # 29/30：dead 调度、回归、禁用清理
node dev/check-04-affection-ui.mjs   # 26：好感档位/发糖面板
node dev/check-04-320.mjs            # 320 宽预设选择器/设置溢出
```

验收 23–30 对应：23 单元（归属）、24 单元（回合/日志）、25 单元（情感/优先级）、26 单元（好感/发糖）、27 单元（15 回合/48h）、28 预设、29/30 浏览器。所有插件都是内置示例，可以单独开关；禁用后不挂载面板、不装饰头像，旧数据留在 `extdata` 但主程序不崩。

> 注意：源码 0.4.0 与 APK/GitHub 的发布节奏分开；改完源码后重新执行 `node dev/mock-server.mjs`，APK 需要另行 `assembleDebug`。
