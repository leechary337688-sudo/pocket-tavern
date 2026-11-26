# 袖珍酒馆 · 进阶玩法：本地模型 + 电脑版 + 手机连接

> 这份是给「已经看过 `novice.md`、能自己装 App、能开一局」的人看的。
> 目标：**不花 API 钱，用自己电脑跑模型；电脑上先玩通，再让手机连过来。**
> 你不需要懂编程，但需要愿意按步骤点鼠标、复制地址。
>
> 已经跑通、想继续研究采样、角色卡、世界书、插件、TTS 和成人向写作？看同目录的 **[玩法与调教.md](./玩法与调教.md)**。
>
> **2026-11-26 修订**：补上实测踩到的坑 —— 新版 LM Studio 的「开发者」页**没有** `Serve on Local Network` 开关，改用命令行 `lms server start --bind 0.0.0.0 --port 1234 --cors` 才能让手机连上；同时补了 `lms` 命令找不到、端口不一致、防火墙等排错。
>
> **0.5.0 补充**：多 Agent 群聊只影响“发给模型的历史”，不影响本地模型设置。每个角色独立上下文后，7B 仍可能替别人说话；要稳定，优先 14B/云模型，并把群聊 `max_tokens` 降到 512 左右。

---

## 0. 先搞清楚三件事

### 0.1 本地模型是什么

云 API（DeepSeek 等）是「别人机房里的大模型」，按量收费；本地模型是「下载到自己电脑上的模型文件」，用你的显卡/内存跑，不联网、不花钱，但速度取决于电脑配置。

袖珍酒馆只负责「界面 + 角色卡 + 世界书 + 聊天记录」，模型由另一个程序提供。这个程序叫 **本地模型服务**，它会在电脑上开一个「接口地址」，袖珍酒馆把聊天内容发过去，它把回复流式传回来。

### 0.2 你要准备什么

- 一台 Windows 10/11 电脑（建议 16GB 内存以上）；
- 一张独立显卡更好（NVIDIA / AMD 都行），没有独显也能跑小模型；
- 手机和电脑在同一个 Wi-Fi 下（手机连接电脑时）；
- 浏览器：Edge 或 Chrome；
- 磁盘空间：模型 4GB–25GB 不等，建议放在 **D 盘**。

### 0.3 两条路线，先选一条

| 路线 | 适合谁 | 优点 | 缺点 |
|---|---|---|---|
| **LM Studio（推荐）** | 新手、想点鼠标完成 | 图形界面、内置模型下载、OpenAI 兼容接口 | 安装包较大 |
| **Ollama** | 愿意敲几行命令 | 轻量、命令简单、生态广 | 没有内置模型商店界面 |

下面主写 LM Studio，Ollama 放在第 6 节作为备选。

---

## 1. 按电脑配置选模型

先看你的显卡显存（任务管理器 → 性能 → GPU → 专用 GPU 内存），再看内存。

> 下表的“能跑”指 **Q4_K_M 量化 + 8K 上下文** 下比较舒服；上下文开到 32K 会更吃显存。
> 模型体积是 GGUF 文件大小，实际显存还要加上下文缓存，通常再多 1–3GB。
> 如果 LM Studio 里能搜到同系列更新一代的模型，优先选同尺寸的新版；下表用稳定、常见的中文模型举例。

| 你的配置 | 推荐模型（GGUF） | 模型体积参考 | 说明 |
|---|---|---|---|
| 无独显 / 核显，16GB 内存 | Qwen2.5-3B-Instruct Q4 | 约 2GB | 能跑，速度慢；只适合试玩 |
| 4GB 显存 | Qwen2.5-3B-Instruct Q4 | 约 2GB | 7B 很勉强，不建议 |
| 6GB 显存 | Qwen2.5-7B-Instruct Q4 | 约 4.7GB | 上下文先设 4K–8K；8GB 更稳 |
| 8GB 显存 | Qwen2.5-7B-Instruct Q5/Q6，或 Llama-3.1-8B Q5 | 5–6GB | 中文角色扮演优先 Qwen2.5-7B；**RTX 3070 Ti 实测 Q5_K_M 可全量载入 GPU** |
| 12GB 显存 | **Qwen2.5-14B-Instruct Q4** | 约 9GB | 性价比甜点；8K 上下文 |
| 16GB 显存 | Qwen2.5-14B Q6，或 Qwen2.5-32B Q3（慢） | 12–14GB | 14B Q6 质量更稳 |
| 24GB 显存 | **Qwen2.5-32B-Instruct Q4**，或 Gemma-2-27B Q4 | 18–20GB | 中文长篇角色扮演很舒服 |
| 48GB 显存 | Qwen2.5-72B Q4（紧） | 约 40GB | 需要留上下文空间，不推荐新手 |
| Apple Silicon 16GB 统一内存 | Qwen2.5-7B/14B Q4 | 5–9GB | 14B 会占满，建议 7B |
| Apple Silicon 32GB 统一内存 | Qwen2.5-32B Q4 | 约 20GB | 注意散热和内存压力 |

**一句话建议：**
- 8GB 显存以下：**Qwen2.5-7B-Instruct Q4**，别硬上 14B。
- 12GB 显存：**Qwen2.5-14B-Instruct Q4**，这是最推荐的起点。
- 24GB 显存：**Qwen2.5-32B-Instruct Q4**，体验明显更好。
- 不要选 `Coder` 版本做角色扮演；选 `Instruct` / `Chat`。

**量化怎么选：**
- `Q4_K_M`：默认，体积和质量平衡最好；
- `Q5_K_M` / `Q6_K`：显存够就选，质量略好；
- `Q8_0`：显存很大再考虑；
- `Q2/Q3`：除非实在装不下，不建议，角色容易“降智”。

---

## 2. 安装 LM Studio

### 2.1 下载

打开官网：

**https://lmstudio.ai/**

点 **Download for Windows**，把安装包下载到：

`D:\AI\下载\`

> 如果 D 盘没有 `AI` 文件夹，先新建 `D:\AI`，再建 `D:\AI\下载`。

### 2.2 安装

双击安装包。安装路径能选就选：

`D:\AI\LM Studio`

不能选就按默认装（通常在 `C:\Users\你的用户名\AppData\Local\LM Studio`），不影响使用。

### 2.3 把模型目录放到 D 盘（建议）

打开 LM Studio，点左下角 **齿轮 / Settings**，找 **Models / 模型目录**，把目录改成：

`D:\AI\LMStudio\models`

如果当前版本没有“修改模型目录”的选项，就先用默认目录，别为这个卡住。

> 模型很占空间；C 盘紧张时一定要改。改完重启 LM Studio。

**把文件浏览器切到“显示扩展名”：**

Windows 资源管理器 → 顶部 **查看** → 勾上 **文件扩展名**。
后面要认 `.gguf` 文件、要改 `.bat`，看不见扩展名很容易改错文件名。

### 2.4 确认 LM Studio 自带命令行 `lms`

现在的 LM Studio 会自带一个叫 `lms` 的命令行工具，**第 3.3 节让手机连电脑时要用它**。先确认它能不能用：

1. `Win + R` → 输入 `powershell` → 回车；
2. 输入：

```powershell
lms --version
```

能打印出版本号 = 可用，跳到第 3 节。

**如果报“无法将 lms 识别为cmdlet / 不是内部或外部命令”：**

- 新版：LM Studio 设置里可能有 **在终端中使用 lms / Install `lms` on PATH** 之类的开关，打开它，然后**关掉 PowerShell 重新开一个**再试；
- 还不行：LM Studio 安装目录里搜 `lms.exe`，用它所在的完整路径调用：

```powershell
& "C:\Users\你的用户名\.lmstudio\bin\lms.exe" --version
```

（路径以你机器上实际找到的为准。）

> 这一步失败也不影响电脑版；只是手机连电脑时，你会需要 3.3 节的「命令行兜底方案」。

---

## 3. 下载并加载模型

### 3.1 在 LM Studio 里搜模型

1. 点左侧 **放大镜 / Discover**；
2. 搜索：`Qwen2.5 14B Instruct GGUF`；
3. 在结果里选 **Q4_K_M**（文件名通常带 `Q4_K_M.gguf`）；
4. 点 **Download**。

按第 1 节的表选尺寸，不要一次下最大的。下载 9GB 左右，取决于网速。

### 3.2 加载模型

1. 点左侧 **Chat** 或 **My Models**；
2. 选中刚下载的模型；
3. 右侧设置里：
   - **Context Length** 先设 `8192`（显存小就 4096）；
   - **GPU Offload** 拉到最大（显存够就全放显卡）；
   - 如果报显存不足：降低 Context、降低 GPU 层数，或换小一号模型；
4. 在聊天框里发一句“你好”，确认模型本身能回复。

### 3.3 启动本地接口

1. 点左侧 **本地模型 API**（有的版本叫 **Developer / 开发者 → 本地服务器**）；
2. 打开顶部的 **本地 API 服务器** 开关，状态变成 **正在运行**；
3. 记下这一页显示的 **基础 URL**，形如 `http://localhost:1234/v1`；
4. 点 **编辑端口**，填 `1234`（要和后面 App 里填的一致）；
5. 打开 **CORS**（跨域）。

> ⚠️ **最容易卡住的版本差异**：
> - 新版 LM Studio 左侧 **「开发者」页只有「代码更改 / 终端 / 默认 shell」**，**根本没有** `Serve on Local Network` 开关 —— 这不是你点错了；
> - 有的版本把它放在「本地模型 API」页里，有的版本只能靠命令行参数；
> - **结论：找不到开关，就跳到 3.4 的做法二用命令行**，实测可用。

6. 本机验证（浏览器打开）：

**http://127.0.0.1:1234/v1/models**

能看到一段 JSON（里面有一串模型 id），就说明接口通了。

> 袖珍酒馆的“后端地址”只填到端口：`http://127.0.0.1:1234`，**不要**在后面加 `/v1`；程序会自己拼 `/v1/chat/completions`。

### 3.4 让局域网/手机能访问（两种做法，二选一）

#### 做法一：图形界面（有开关就用这个）

在「本地模型 API」页里找 **Serve on Local Network / 在局域网中提供服务** 或 **允许其他设备访问**，打开它。服务器会自动重启，**基础 URL 会从 `localhost` 变成局域网 IP**，例如 `http://192.168.1.23:1234/v1`。

#### 做法二：命令行（找不到开关就用这个，实测可用）

先 `lms server stop` 停掉图形界面里那个，改用命令行启动，**管理员 PowerShell**：

```powershell
lms server stop
lms server start --bind 0.0.0.0 --port 1234 --cors
```

看到下面这三行就成功了：

```text
W CORS is enabled. This means any website you visit can use the LM Studio server.
W Server will accept connections from the network. Only use this if you know what you are doing!
Success! Server is now running on port 1234
```

**这两行 W 开头的不是报错，是提醒“服务已经对网络开放”**。局域网/私有 Tailscale 用没问题；不要把它暴露到公网（见第 8 节）。

> 参数含义：`--bind 0.0.0.0` = 所有网卡都能连（含局域网和 Tailscale），`--cors` = 允许网页调用，`--port 1234` = 端口。
> 下次开机如果手机又不通，重新执行这一条命令即可；也可以在 LM Studio 设置里找“启动时自动运行服务器”之类的开关。

7. 再验证一次本机：

```text
http://127.0.0.1:1234/v1/models
```

8. 局域网/手机验证放到第 5 节做（用 `100.x.x.x` 或 `192.168.x.x` 去访问同一个端口）。

---

## 4. 电脑版：解压即用，开第一局

### 4.1 下载电脑版

在 GitHub Release 里下载：

**https://github.com/leechary337688-sudo/pocket-tavern/releases/tag/v0.4.0**

找到 `PocketTavern-0.4.0-desktop.zip`，下载到 `D:\AI\下载\`。

### 4.2 解压

右键 zip → **全部解压缩** → 解压到：

`D:\PocketTavern`

解压后目录里应该有：

```text
启动袖珍酒馆.bat
serve.ps1
index.html
src/
plugins/
icons/
assets/
README-电脑版.md
```

> 不要只把 `index.html` 拖出来单独打开；ES 模块和 IndexedDB 需要本地服务器，必须用启动脚本。

### 4.3 启动

双击 **`启动袖珍酒馆.bat`**。

会发生三件事：

1. 弹出一个黑色命令行窗口（不要关，关了服务就停）；
2. 自动打开浏览器：`http://127.0.0.1:5173/`；
3. 看到「袖珍酒馆」启动页。

如果 Windows 弹「已保护你的电脑」：点 **更多信息 → 仍要运行**。这是本地脚本，没有联网下载行为。

> 端口固定为 5173，是为了让你的聊天记录始终在同一个浏览器存储里。
> 如果提示端口被占用：关掉占用 5173 的程序，或重启电脑后再试；不要随便换端口，否则会变成一份新的空数据。

### 4.4 填本地接口，开一局

1. 过 18+ 提示；
2. 点右上角齿轮 → **后端连接**；
3. 接口类型：**OpenAI 兼容**；
4. 后端地址：`http://127.0.0.1:1234`；
5. API 密钥：随便填 `local`（LM Studio 默认不校验；如果以后你给服务加了 key，再填真的）；
6. 点 **拉取模型**，选择列表里的模型；
7. 点 **测试连接**，再点 **保存连接**；
8. 回首页 → 卡库 → 选「琥珀」→ 开聊；
9. 发一句“你好”，能看到字一个个出来，就成功了。

如果模型回复很慢：第一次加载模型会慢；之后看 LM Studio 的日志和显卡占用。

### 4.5 电脑版的数据在哪

数据存在浏览器（Edge/Chrome）的 IndexedDB 里，绑定地址 `http://127.0.0.1:5173`。

- 换浏览器 → 数据不共享；
- 换端口 → 数据不共享；
- 想换机/备份：设置 → 数据与备份 → **导出全量备份**；
- 删除电脑版文件夹不会删浏览器数据；要彻底清空用设置里的「清空并恢复演示数据」。

---

## 5. 手机连接电脑本地模型

先确认：**手机连的是电脑上的 LM Studio/Ollama，不是连袖珍酒馆的网页。** 手机 App 已经内置界面了。

### 5.0 通用前提

电脑上：

- LM Studio 已加载模型，服务器状态是 **正在运行**；
- 端口记牢（本文统一用 `1234`；**你自己改成 1235 就全部换成 1235**，别一部分 1234 一部分 1235）；
- 打开 **CORS**；
- **允许局域网访问**：在图形界面打开 `Serve on Local Network`；**如果这个开关在你的版本里找不到（很多新版「开发者」页没有它），用命令行**：

```powershell
lms server stop
lms server start --bind 0.0.0.0 --port 1234 --cors
```

- Windows 防火墙弹窗选 **允许访问**，并且只勾 **专用网络**。

手机上：

- 先不要打开 App，先用手机浏览器测试接口（下面每种方式都会写）；
- Tailscale 方式不需要同一个 Wi-Fi，但两端都要登录同一个 Tailscale 账号。

---

### 方式 A：同一 Wi-Fi（最常用）

**步骤：**

1. 电脑上按 `Win + R`，输入 `cmd`，回车；
2. 输入：

```bat
ipconfig
```

3. 找到当前 Wi-Fi 的 **IPv4 地址**，例如 `192.168.1.23`；
4. 手机浏览器打开：

```text
http://192.168.1.23:1234/v1/models
```

能看到 JSON，说明手机能访问电脑的模型服务。

5. 打开袖珍酒馆 App → 设置 → 后端连接：
   - 接口类型：OpenAI 兼容
   - 后端地址：`http://192.168.1.23:1234`（换成你的 IP，不要加 `/v1`）
   - API 密钥：`local`
   - 拉取模型 → 选模型 → 测试连接 → 保存
6. 开一局，发“你好”。

**如果手机浏览器打不开：**

- LM Studio 的 `Serve on Local Network` 没开；
- Windows 防火墙拦了 1234 端口：控制面板 → Windows Defender 防火墙 → 允许应用通过防火墙 → 找到 LM Studio，勾专用网络；
- 手机连的是 5G 流量，不是 Wi-Fi；
- 电脑和手机不在同一个网段（比如电脑插网线、手机连另一个路由器）；
- 公司/酒店 Wi-Fi 开了“客户端隔离”，设备之间不能互访，换手机热点。

---

### 方式 B：USB 数据线 + adb 反向端口（不依赖 Wi-Fi）

适合 Wi-Fi 不稳、或路由器隔离的情况。需要一点命令行操作。

**电脑准备：**

1. 下载 Android Platform Tools：

**https://developer.android.com/tools/releases/platform-tools**

2. 解压到 `D:\AI\platform-tools`；
3. 手机打开「开发者选项」→ 打开「USB 调试」；
4. 数据线连电脑，手机弹「允许 USB 调试」→ 允许；
5. 在 `D:\AI\platform-tools` 文件夹空白处按住 Shift + 右键 →「在此处打开 PowerShell 窗口」；
6. 输入：

```bat
.\adb devices
```

看到你的手机序列号 + `device` 才算成功。

7. 输入：

```bat
.\adb reverse tcp:1234 tcp:1234
```

8. 手机 App 里后端地址填：

```text
http://127.0.0.1:1234
```

9. 拉取模型、测试、开聊。

**注意：**

- `adb reverse` 只在 USB 连着、且电脑上服务还在时有效；
- 拔线或重启 adb 后要重新执行；
- 手机 App 里的 `127.0.0.1` 指的是手机自己，但因为做了反向端口，会转发到电脑的 1234；
- 不需要 root。

---

### 方式 C：Tailscale（不在家也能连）

适合：你在外面，想连家里电脑；或者家里没有公网 IP。

1. 电脑安装 Tailscale：

**https://tailscale.com/download/windows**

2. 手机应用商店安装 Tailscale；
3. 电脑和手机登录 **同一个账号**；
4. 电脑上打开 Tailscale，记下它的 `100.x.x.x` 地址；
5. 电脑上打开 Tailscale，记下它的 `100.x.x.x` 地址（命令行 `tailscale ip -4` 最准）；
6. 电脑上让 LM Studio 对网络开放：图形界面有 `Serve on Local Network` 就打开；**没有就用命令行** `lms server stop` + `lms server start --bind 0.0.0.0 --port 1234 --cors`；
7. 手机浏览器测试：

```text
http://100.x.x.x:1234/v1/models
```

8. App 后端地址填 `http://100.x.x.x:1234`（不要加 `/v1`）。

**Tailscale 卡住的常见原因：**

| 现象 | 原因 | 处理 |
|---|---|---|
| 电脑上 `127.0.0.1:1234` 能开，手机 `100.x.x.x:1234` 打不开 | LM Studio 只监听本机（没开局域网） | 用上面的 `--bind 0.0.0.0` 命令重启服务 |
| 手机浏览器一直转圈或显示“无法访问” | Windows 防火墙拦了 1234 | 控制面板 → Windows Defender 防火墙 → 允许应用通过防火墙 → 勾 LM Studio 的**专用网络**；或临时关掉防火墙测试（测完打开） |
| Tailscale 显示两台设备都在线但还是不通 | 走了 relay、或被 Windows 的网络类型识别成“公用网络” | 把当前网络类型改成**专用网络**；再试一次 |
| 手机 App 里“测试连接”失败但浏览器能开 | CORS 没开 | 命令行加 `--cors`，或在图形界面打开 CORS |
| 换了端口后不通 | 命令行的 `--port` 和 App 里填的不一致 | 三处统一：`lms` 命令、电脑版 App、手机 App |

**安全提醒：**

- Tailscale 是私有虚拟局域网，不要把这套服务再端口转发到公网；
- LM Studio 默认没有登录密码，暴露到公网等于把模型借给陌生人；
- 不用时关掉 LM Studio Server。

---

### 方式 D：手机热点（没有路由器时）

1. 手机开「个人热点」；
2. 电脑连这个热点；
3. 电脑 `ipconfig` 看 Wi-Fi 的 IPv4；
4. 手机浏览器访问 `http://电脑IP:1234/v1/models`；
5. App 填同样的地址。

有些安卓热点默认开启“客户端隔离”，如果手机访问不了电脑，就在热点设置里关掉隔离，或改用 USB 方式。

---

### 5.5 连接成功后怎么测试

按顺序测，不要一上来就开聊：

1. **手机浏览器**打开 `/v1/models`：有 JSON = 网络通；
2. App 设置里点 **测试连接**：成功 = 地址和密钥格式对；
3. 点 **拉取模型**：能列出模型 = 模型 id 对；
4. 发一句“你好”：有流式回复 = 全通；
5. 看 LM Studio 的 Server 日志：有请求进来 = 确实连到了电脑。

如果第 1 步就不通，别在 App 里反复改，先解决网络/防火墙。

---

## 6. 备选：Ollama

### 6.1 安装

**https://ollama.com/download/windows**

下载安装。装完打开 PowerShell：

```bat
ollama run qwen2.5:7b
```

第一次会下载模型。能对话后，`Ctrl + D` 退出聊天，服务仍在后台。

### 6.2 接口

默认地址：

```text
http://127.0.0.1:11434
```

测试：

```text
http://127.0.0.1:11434/v1/models
```

App 后端地址填 `http://127.0.0.1:11434`，模型名填 `qwen2.5:7b`（或你 `ollama list` 里看到的完整名字）。

### 6.3 手机连接

Ollama 默认只监听本机，需要设置两个 Windows 用户环境变量，然后重启 Ollama：

```bat
setx OLLAMA_HOST 0.0.0.0:11434
setx OLLAMA_ORIGINS *
```

然后关掉 Ollama 托盘图标，重新打开。手机浏览器访问 `http://电脑IP:11434/v1/models`。

> `OLLAMA_ORIGINS=*` 是放开跨域；只在局域网用，不要公网暴露。

---

## 7. 常见问题

| 现象 | 多半原因 | 怎么修 |
|---|---|---|
| 「开发者」页里没有 `Serve on Local Network` 开关 | 新版 LM Studio 的 GUI 把它藏了/去掉了 | 用命令行：`lms server stop` 后 `lms server start --bind 0.0.0.0 --port 1234 --cors` |
| 命令行报“无法将 lms 识别为 cmdlet” | `lms` 没进 PATH | LM Studio 设置里找“安装 lms / 加入 PATH”，或用它所在目录的完整路径调用 `lms.exe` |
| 命令报 `port already in use` | 图形界面里那个服务器还开着 | 先在「本地模型 API」页关掉开关（或 `lms server stop`）再启动 |
| 命令行提示 `W CORS is enabled...` / `W Server will accept connections...` | **不是报错**，是安全提醒 | 局域网/Tailscale 使用无需处理；别暴露公网 |
| 电脑版能用，手机连不上 | LM Studio 只监听 127.0.0.1 | 用 `--bind 0.0.0.0` 重启；再查防火墙专用网络 |
| App 里“测试连接”失败，浏览器能开 `/v1/models` | CORS 没开 | 命令行加 `--cors`；Ollama 设 `OLLAMA_ORIGINS=*` |
| 手机浏览器打不开 `IP:1234` | 没开局域网 / 防火墙 / 不同 Wi-Fi | 见上一行；允许专用网络；同一 Wi-Fi 或 Tailscale |
| 401 Unauthorized | 服务要求 key | LM Studio 一般随便填；若你设了 token，填真的 |
| 404 Not Found | 地址多写了 `/v1` | App 里只填到端口，例如 `http://192.168.1.23:1234` |
| model not found | 模型 id 不对 | 点「拉取模型」，从列表选；不要手打显示名 |
| 回复极慢 / 卡住 | 模型太大、上下文太高、CPU 跑 | 换小模型；Context 降到 4096/8192；GPU Offload 调低 |
| 电脑版打不开 | 直接双击了 index.html | 必须双击 `启动袖珍酒馆.bat`，用本地服务器 |
| 电脑版端口被占用 | 5173 被别的程序占 | 关掉占用程序；不要随意换端口，否则数据会分成两份 |
| 手机 App 连 `127.0.0.1` 不行 | 手机自己的 127.0.0.1 不是电脑 | 用电脑局域网 IP / Tailscale IP；或用 `adb reverse` 后再用 127.0.0.1 |
| 电脑重启后手机又连不上 | 命令行的服务器不会自动随开机启动 | 重新执行 `lms server start --bind 0.0.0.0 ...`；或找 LM Studio 的“随应用启动服务器”设置 |

---

## 8. 安全与边界

- 本地模型服务默认 **没有登录密码**，只适合本机/局域网/Tailscale 私有网络；
- **`--bind 0.0.0.0` 等于“对所有网卡开放”**：同一 Wi-Fi 的任何人、任何网页（因为开了 CORS）理论上都能调用你的模型；
  - 在公共 Wi-Fi（酒店/机场/咖啡厅）里**不要**这样开着；
  - 只在私有网络里用，用完 `lms server stop`；
  - 需要更强隔离：改用 Tailscale，只在 Tailscale 虚拟网内访问；
- 不要把 1234/11434 端口直接映射到公网；
- 不用时关掉 LM Studio Server；
- 袖珍酒馆不会把你的 API Key 发给插件；本地模型的 key 也建议只填 `local`；
- 角色卡、聊天、世界书都在本机 IndexedDB；换浏览器/换端口会看不到旧数据，先导出备份。

---

## 9. 一页小抄

```text
LM Studio 下载：https://lmstudio.ai/
Ollama 下载：https://ollama.com/download/windows
Platform Tools：https://developer.android.com/tools/releases/platform-tools
Tailscale：https://tailscale.com/download
电脑版：https://github.com/leechary337688-sudo/pocket-tavern/releases/tag/v0.4.0

电脑本地接口：http://127.0.0.1:1234
手机同一 Wi-Fi：http://电脑IPv4:1234
手机 USB：adb reverse tcp:1234 tcp:1234 → http://127.0.0.1:1234
Tailscale：http://100.x.x.x:1234

LM Studio 让手机能连（GUI 找不到开关时）：
  lms server stop
  lms server start --bind 0.0.0.0 --port 1234 --cors

全机端口只认一个：命令 / 电脑版 / 手机 App 三处必须一致。
App 后端地址只填到端口，不要加 /v1。
模型选 Instruct / Chat，不要选 Coder。
8GB 显存：Qwen2.5-7B Q4/Q5；12GB：Qwen2.5-14B Q4；24GB：Qwen2.5-32B Q4。
```
