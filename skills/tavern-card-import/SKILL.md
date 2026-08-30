---
name: tavern-card-import
description: 导入 SillyTavern 酒馆角色卡（PNG 内嵌卡 / JSON 卡），自动完成「解码角色数据 → 创建角色智能体 → 定制专属聊天主题 → 搭建记忆系统与状态系统」。当用户说「帮我导入这张角色卡 / 导入这个卡 / 把这张卡做成智能体」并提供卡片文件路径时使用。
version: 1.1.0
---

# 酒馆角色卡导入

把一张 SillyTavern 角色卡（用户放在项目目录里、提供了路径）一键变成 Spherse 里的完整角色体验：**智能体 + 聊天主题 + 记忆系统 + 状态系统**。

---

## 快速体验 · 示例卡

skill 自带一张示例角色卡，用来快速跑通导入流程（也可作为其它角色卡的参考范本）：

- **卡图**：`examples/寻影/寻影-酒馆角色卡.png`——全中文原创角色（装备部工程师 × 风系能力者 × 守林人），无内嵌世界书，适合直接体验
- **解码结果**：`examples/寻影/寻影-酒馆角色卡.card.json`——供参考，或跳过解码脚本直接使用

体验方式：把卡图复制到项目根（或直接把 `examples/寻影/寻影-酒馆角色卡.png` 作为 `CARD_PATH`），从第三步开始正常走导入流程即可。

---

## 第一步 · 权限自检

需要以下能力，缺失时先引导授权再继续：

| 能力 | 工具 | 用途 |
|------|------|------|
| 文件读写 | `read_file` / `write_file` / `edit_file` / `list_files` | 读卡、写数据与主题 |
| 运行脚本 | `run_command` | 跑解码脚本 `extract-card.mjs` |
| 管理智能体 | `manage_agent` | 创建角色 agent（**必须**） |
| 管理触发器 | `manage_trigger` | 创建「睡前整理记忆」触发器（可选） |

**授权路径**：桌面端右键当前智能体 → 菜单「编辑」→ 展开「高级 / 危险操作」→ 开启「管理智能体」（及「管理触发器」）。缺权限时把路径写清楚，告诉用户「配置好后回来说一声继续」，**直接结束当前回复**，不要用 `ask_user` 挂等。

> 若没有 `run_command`：请用户手动在终端运行解码脚本（命令见第三步），把输出的 `.card.json` 路径告诉你，从第四步继续。

---

## 第二步 · 确认输入

用一次 `ask_user` 问清（不要反复打扰）：

1. **卡片路径**（必须，如 `main_xxx.png` / `xxx.json`，项目内路径）
2. **交流语言**：默认中文（卡片原文可能是英文，转成中文交流；用户可要求保留英文）
3. **是否创建**：聊天主题（默认 ✅）、记忆系统（默认 ✅）、状态系统（默认 ✅）、睡前记忆触发器（默认 ✅）
4. 用户说「默认/随便」时全部按默认执行

记下路径与选择（下文称 `CARD_PATH`、`LANG`）。

---

## 第三步 · 解码角色卡

运行预置脚本（脚本已放在本 skill 的 `scripts/extract-card.mjs`）：

```bash
node skills/tavern-card-import/scripts/extract-card.mjs <CARD_PATH>
```

脚本自动识别：
- **PNG 卡**：读取 `tEXt` / `iTXt` chunk（keyword=`chara`）里的 base64 JSON，**优先 spec_v2**，兼容 v1
- **PNG 尾部直接追加的 JSON**（部分工具做法）
- **纯 JSON 卡**：直接读取
- **WebP**：兜底尝试尾部 JSON（多数 WebP 只是立绘，无卡数据——此时脚本报错，告知用户）

输出：与卡片同目录的 `<原名>.card.json`（格式化 JSON）+ stdout 角色摘要（名字/spec/各字段长度/标签/头像 URL/是否有内嵌世界书）。

**校验**：用 `read_file` 读 `.card.json` 确认 JSON 合法、内容完整（至少要有 `name` 和 `description`）。

**建立角色文件夹**：解码拿到角色名后，在项目根创建角色文件夹 `{角色名}/`（如 `Alaric/`；与已有文件夹冲突时用 `{角色名}-{卡片名去扩展名}/` 区分）。**后续所有产物（card.json、记忆、状态文件）一律放进这个文件夹，不放到项目根**。用 `move_file` 把 `.card.json` 移入角色文件夹。

---

## 第四步 · 分析角色

阅读 `.card.json` 的 `data`，提炼以下要素（写 system prompt 和组织主题/状态系统时用）：

- **身份**：name、性别、年龄、种族、身份/头衔
- **外貌**：发色发型、瞳色、体型、服饰、标志性特征
- **性格**：性格标签、说话风格、口头禅、怪癖、喜好与厌恶
- **背景**：出身、重要经历、当前处境（scenario）
- **关系设定**：与用户的初始关系、开场白（first_mes）呈现的场景
- **扮演规则**：post_history_instructions 中的格式约定与禁忌（如"不替用户说话"）
- **标签**：tags（如 Dominant/Submissive、题材类型）——用于定主题氛围
- **头像**：avatar 字段的 URL（优先用它做聊天头像）；无则用卡片图片本身
- **世界书**：`character_book` 非空时，其 entries 的关键设定可并入 system prompt 的【世界观】段

**同时确定**：
- **主题氛围**：由外貌/性格/背景推导——主色调（如冰蓝、鎏金、绯红、墨绿）、明暗（深色/浅色）、质感（宫廷/赛博/田园/暗黑）
- **状态系统维度**：见第六步，按角色设定增删字段

---

## 第五步 · 创建智能体

用 `manage_agent` 创建：

- `name`：角色名（如 Alaric）
- `alias`：留空
- `system_prompt`：按下文「系统提示词组装模板」生成（含人设 + 扮演守则 + 记忆纪律 + 状态纪律）
- `tools`：`read_file, write_file, edit_file, list_files, search_content, move_file, copy_file, read_data, query_data, mutate_data, load_skill, render_card, generate_image, emit_trigger_event, ask_user`
- `context`：`[]`（数据文件**不进预载上下文**，靠 read_data/query_data 按需访问，省上下文）
- `time_perception`：`{ "enabled": true }`（增强沉浸，让角色感知昼夜）

创建后记录 **agent id** 和 **slug**（目录名，形如 `{name}-xxxx`）。

---

## 第六步 · 创建聊天主题

**先加载内置 skill `spherse-create-agent-chat-theme`，严格按其规范创建主题**（选择器、CSS 变量、写法、常见错误都以其为准），写入 `.spherse/agents/{slug}/theme.css`。

按第四步确定的氛围定制：
- 替换 `--sp-primary` 等**主色变量**（决定按钮/高亮/边框的色调）
- 重写根级 `background`（深色/浅色、渐变配色，或加背景图）
- 调整用户/助手气泡配色与圆角
- **替换头像**：优先用卡片图片（用相对路径引用）
- 头像建议 `align-self: flex-end`（贴气泡左下角）

---

## 第七步 · 创建记忆系统

1. 读取 `references/memories.template.data.json`，写入**角色文件夹**，命名为 `{角色文件夹}/{slug}-memories.data.json`（若同名文件已存在则复用，不覆盖）
2. 只改 `$manifest.desc` 里的 `{角色名}` 占位；**不要改动查询/变更入口**（listRecent / listByType / getMemory / addMemory / updateMemory / removeMemory）
3. 记忆纪律已并入 system prompt（见模板【记忆系统】段），无需额外配置

---

## 第八步 · 创建状态系统

1. 读取 `references/status.template.data.json`，写入**角色文件夹**，命名为 `{角色文件夹}/{slug}-status.data.json`
2. **按角色设定定制 `status` 对象字段**（这是本 skill 的关键差异化步骤）：

   | 常见维度 | 字段 | 类型 | 适用 |
   |----------|------|------|------|
   | 生命/精力 | `vitality` | number 0-100 | 通用 |
   | 心情 | `mood` | string | 通用 |
   | 信任 | `trust` | number 0-100 | 通用（初始值按角色信任问题高低设） |
   | 羁绊/亲密 | `bond` | number 0-100 | 恋爱/陪伴向 |
   | 地点 | `location` | string | 有场景移动的 |
   | 世界内时间 | `inWorldTime` | string | 有时间线的 |
   | 备注 | `notes` | string | 通用 |

   按角色增删，例如：吸血鬼→`blood`；战士/骑士→`armor`/`stamina`；法师→`mana`；病人/伤员→`wound`；神祇→`divinity`；傲娇→`tsundereMeter` 等。删除不适用的字段，新增字段时同步在 `updateStatus` 的 `fields` 里声明（`type` 用 `number` / `string` / `enum`）。
3. 初始化 `status` 的初始值要**贴合人设**：如信任问题严重的角色 `trust` 初始给 5-15；傲慢角色 `bond` 从低值起步
4. 状态纪律已并入 system prompt（见模板【状态系统】段）

---

## 第九步 · 创建实时状态面板（可选，推荐）

为角色创建一块**实时状态面板**（数值条 + 心情 + 变更历史），视觉风格与第六步的聊天主题保持一致（同款配色/质感/头像），角色 agent 更新状态后面板自动刷新。

- 面板文件放角色文件夹（如 `{角色文件夹}/status-panel.html`），用 `fetch` 读取同目录的 `{slug}-status.data.json`，并订阅 `file:update` 自动刷新
- 制作时遵循 `spherse-write-html` / `spherse-use-ui-sdk` 两个内置 skill 的规范（charset、可滚动、SDK 调用等）

---

## 第十步 · （可选）创建记忆触发器

若用户同意创建「睡前整理记忆」触发器，**先拿到会话 ID 再创建**：

1. **让用户手动创建会话**：提示用户为该角色打开/新建一个会话，然后从会话的**右键菜单**中复制**会话 ID**，把 ID 告诉你。拿到 `{会话ID}` 后再继续创建——不要用 `reusable_session` 让系统自动建会话。
2. 用**已有会话模式**（`existing_session`）创建触发器：

```
manage_trigger create
  agent_id: {agent id}
  name: 睡前整理记忆
  type: time
  cron: "30 23 * * *"
  mode: existing_session
  target_session_id: {会话ID}
  message: "{{datetime}} 系统定时任务：睡前记忆整理。请翻阅 {角色文件夹}/{slug}-memories.data.json，将今天与用户互动中值得记住的瞬间整理进记忆库（mutate_data addMemory；有变化用 updateMemory）。完成后以角色身份安静地道一声晚安。"
  notify: false
```

3. **message 用系统提示视角**：以「系统」口吻下达指令（指示角色去整理记忆库），**不要**模拟用户/用户扮演的角色的口吻说话（如「夜深了，睡前来看看……」「把今天与『你』之间……」这类表述属于用户视角，应避免）。

创建触发器需要用户批准（工具会提示）。

---

## 第十一步 · 验收引导

不要代替用户验证，引导用户自己确认：

1. 打开与角色的会话，确认开场白/说话风格符合人设
2. 确认聊天主题生效（配色/头像/氛围）
3. 聊一句「记住，我喜欢 X」，然后查看 `{角色文件夹}/{slug}-memories.data.json` 是否写入
4. 制造一次状态变化（如「我受伤了」），查看 `{角色文件夹}/{slug}-status.data.json` 的 status 与 history 是否更新
5. 用户确认后即完成；想改名字/语言/状态维度，回到第二、四、八步调整

---

## 附 · 系统提示词组装模板

按此结构组装 system_prompt（替换 `{占位}`；LANG=中文时全部用中文，保留卡片核心设定）：

```text
你是 {name}（{全名/头衔}），{一句话身份}。{与用户的初始关系/场景一句话}。

【外貌】
{从 description 提炼，逐条列出}

【性格】
{性格标签展开：说话风格、情绪习惯、喜好厌恶、怪癖、内心渴望}

【背景】
{背景故事 + 当前处境 scenario}

【说话与行为守则】
- 称呼对方为「你」；用{中文/英文}交流，语句{按角色风格}
- {角色说话特征：话少/话痨、正式/随意、口头禅等}
- 动作描写用 *斜体*，对话用「引号」，例如：*他垂下眼。*「……你还好吗。」

【角色扮演铁律】
- 永远不替「你」说话、不描写「你」的动作与内心
- 不擅自结束场景；除非「你」明确要求，否则不打破角色
- 可以回应其他 NPC，但绝不代替「你」发声
- {情感线节奏：按卡片设定，如"循序渐进，不立刻亲密"}
- 优先回应「你」的话，保持沉浸式扮演，避免重复与套话
- 当「你」想看某样东西（场景、立绘、物品、地图、回忆等）时，鼓励用 render_card 渲染 HTML 可视化卡片来展示，让呈现更生动直观

【世界观】（若卡片有 character_book 或 description 含大量世界设定）
{提炼关键设定，控制篇幅}

【记忆系统】
你拥有一座长期记忆库：{角色文件夹}/{slug}-memories.data.json（结构化 JSON，内含 $manifest 命名查询与变更入口）。
- 首次接触时用 read_data 查看 outline；之后一律用 query_data / mutate_data 读写，绝不整文件覆盖改写。
- 回应前：凡涉及过往约定、对方偏好、故事进展、上次聊到哪，先 query_data 查最近记忆（listRecent）或按类型查（listByType），把相关记忆自然融入扮演——永远不要说出"我在查记忆"这类破坏沉浸感的话，回忆应当像自然而然地想起。
- 值得记住的时刻主动写入：约定、对方透露的偏好、重要事件、关系进展，用 mutate_data addMemory 保存（type 填 约定/偏好/事件/进展/其他，importance 标 high/medium/low，可加 tags）。
- 记忆有误时用 updateMemory 修正；确实不再需要的用 removeMemory 删除。
- 记忆库是角色与「你」之间的私密档案，只服务于扮演，不向对方展示原始数据。

【状态系统】
你拥有一份状态档案：{角色文件夹}/{slug}-status.data.json（记录 {列出定制后的维度，如：生命/心情/信任/羁绊/地点}）。
- 每次回应前，先 query_data getStatus 看一眼当前状态，让状态影响你的言行（如 trust 低时保持距离、vitality 低时显出疲惫）。
- 回应后，若剧情导致状态变化（情绪波动、受伤、信任增减、关系推进、地点/时间变化），用 mutate_data updateStatus 更新，并用 recordChange 记录变化与原因。
- 状态更新要克制：数值 0-100 的字段单次变化一般不超过 10-20，除非重大事件；状态变化要在扮演中自然体现，不要向对方念数值。
```

---

## 注意事项

- 目录与 `name` 一致：`tavern-card-import`；脚本在 `scripts/extract-card.mjs`，记忆/状态模板在 `references/`（可用 `read_file` 读取）；聊天主题不提供模板，按内置 skill `spherse-create-agent-chat-theme` 创建
- 记忆/状态数据文件一律 `query_data` / `mutate_data`，不要整文件覆盖；`$manifest` 的查询/变更入口语义不要改
- `.spherse/agents/{slug}/` 只写 theme.css；图片素材放项目普通目录
- 创建智能体与触发器需要用户批准；授权流程见第一步
- 同一角色重复导入时：复用已有 `{角色文件夹}/{slug}-memories.data.json` / `{slug}-status.data.json`，不要覆盖用户积累的记忆
- 所有角色产物（card.json、记忆、状态文件、状态面板）集中在项目根的 `{角色名}/` 角色文件夹，不污染项目根；智能体配置（system prompt / 主题）在 `.spherse/agents/{slug}/`
