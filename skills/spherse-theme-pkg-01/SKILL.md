---
name: spherse-theme-pkg-01
description: Spherse 主题包，内置 7 款可一键应用的 UI 主题；当用户询问有哪些主题、想要查看主题预览或要求更换/应用某个主题时使用
---

# Spherse 主题包（spherse-theme-pkg-01）

本 skill 是一个**项目级 UI 主题包**：内置 7 款主题，帮助用户一键应用到当前项目。主题作用于整个 App（UI 变量、全局背景、项目面板、聊天窗口默认样式等），应用后刷新页面即可生效。

## 目录结构

```
skills/spherse-theme-pkg-01/
├── SKILL.md
├── references/                 # 主题源文件（只读，勿改动）
│   ├── theme-01.css … theme-07.css
│   ├── theme-04-bg.png         # theme-04 配套背景图（CSS 内相对引用）
│   └── theme-06-avatar.webp    # theme-06 配套头像（CSS 内相对引用）
└── previews/                   # 主题预览
    ├── index.html              # 聚合预览页：顶部切换 7 款主题
    └── preview-base.css        # 预览页共享骨架
```

## 主题清单

| 编号 | 主题 | 源文件 | 视觉特征 | 附带资源 |
|------|------|--------|----------|----------|
| 01 | 黄昏 × 星空 | `references/theme-01.css` | 浅色=放学黄昏暖橙，深色=深夜星空（靛紫+星点+银河光晕），全局噪点纹理 | — |
| 02 | MOMO 复古终端 | `references/theme-02.css` | 磷光绿 CRT 终端、扫描线、等宽字体；用户=❯ 输入、助手=▮ 输出 | — |
| 03 | 庄重的魔法世界 | `references/theme-03.css` | 羊皮纸×烛光金；用户=暖金渐变气泡，助手=半透明深蓝气泡，金色魔法微粒 | — |
| 04 | 魔法世界观 | `references/theme-04.css` | 全窗背景图 + 半透明遮罩，羊皮纸半透明容器 | ⚠️ 需一并拷贝 `theme-04-bg.png` |
| 05 | 紫晶金箔 | `references/theme-05.css` | 暗色紫晶夜穹、亮色浅紫羊皮纸；用户=烫金气泡，助手=紫晶玻璃 | — |
| 06 | 数据余温 | `references/theme-06.css` | 终端冷蓝×琥珀暖意、JetBrains Mono 等宽字体、冰蓝/琥珀竖线 | ⚠️ 需一并拷贝 `theme-06-avatar.webp` |
| 07 | 霓虹深渊 | `references/theme-07.css` | 赛博朋克×Synthwave：热粉/电青/毒绿，全暗色主题 | — |

## 触发场景

- 用户问「有哪些主题 / 都有什么主题 / 看看主题」→ **展示预览页**，让用户挑选。
- 用户说「换主题 / 应用主题 X / 帮我换上……主题」→ 走**应用主题流程**。

## 展示主题预览

用户想看有哪些主题时，用 `render_card` 渲染聚合预览页：

```
render_card(type: "html", file_path: "skills/spherse-theme-pkg-01/previews/index.html", title: "Spherse 主题预览 · 7 款主题")
```

预览页顶部有主题切换器（左右箭头循环 + 展开列表直选），下方展示每款主题的聊天窗口、界面组件与色板；深色/浅色主题自动跟随系统。让用户在预览页中选定一款，确认后进入应用流程。

## 应用主题（核心流程）

> 主题是**项目级**的，目标位置为 `.spherse/theme.css`。按照「先备份 → 再拷贝」执行，绝不直接覆盖用户已有主题。

### 第 1 步：确认目标主题

先与用户确认要应用哪一款（编号或名称，见「主题清单」）。可先展示预览页辅助选择。

### 第 2 步：检查并备份现有主题

检查用户项目 `.spherse/theme.css` 是否存在：

- **存在** → 先备份：
  1. 读取 `.spherse/theme.css` 内容（`read_file`）；
  2. 在项目根目录创建备份目录 `theme-backups/`（不存在则新建）；
  3. 将内容写入 `theme-backups/theme-{YYYYMMDD-HHMMSS}.css`（时间戳精确到秒，避免覆盖）；
  4. **告知用户备份文件的完整路径**，方便日后还原。
- **不存在** → 无需备份，直接进入第 3 步。

备份也可以用 `copy_file(".spherse/theme.css", "theme-backups/theme-{时间戳}.css")` 完成。

### 第 3 步：拷贝主题到目标位置

把选定的主题源文件写入 `.spherse/theme.css`：

- 用 `read_file` 读取 `skills/spherse-theme-pkg-01/references/theme-0X.css`，再用 `write_file` 写入 `.spherse/theme.css`（write_file 会覆盖旧内容；请确保第 2 步的备份已完成）。

**附带资源必须一并拷贝**（CSS 内的 `url()` 相对路径基于 `.spherse/` 目录解析，只拷 CSS 会导致背景图/头像加载失败）：

| 主题 | 需拷贝的资源 | 目标位置 |
|------|--------------|----------|
| 04 魔法世界观 | `references/theme-04-bg.png` | `.spherse/theme-04-bg.png` |
| 06 数据余温 | `references/theme-06-avatar.webp` | `.spherse/theme-06-avatar.webp` |

- 资源用 `copy_file` 拷贝；若目标文件已存在（重复应用同一主题），跳过即可（内容相同）。

### 第 4 步：验证与收尾

1. `read_file` 检查 `.spherse/theme.css` 已正确写入（应包含该主题的头部特征注释，见下节）；
2. 告知用户：
   - 主题「XXX」已应用，刷新页面后生效；
   - 原主题已备份到 `theme-backups/theme-{时间戳}.css`；
   - 如需还原：把备份文件内容写回 `.spherse/theme.css` 即可。

## 识别当前主题

读取 `.spherse/theme.css` 后，通过文件头部的特征注释判断当前应用的是哪一款（用于回答「我现在是什么主题」或换主题前告知用户）：

| 特征注释（包含） | 主题 |
|------------------|------|
| `黄昏 × 星空` | 01 |
| `MOMO TERMINAL` | 02 |
| `魔法世界` / `The Grand Magical World` | 03 |
| `哈利波特魔法世界观` | 04 |
| `紫晶金箔` | 05 |
| `数据余温` | 06 |
| `霓虹深渊` / `Synthwave` | 07 |

若都不匹配，说明是用户自定义或其它来源的主题，按通用备份流程处理即可（备份后正常覆盖）。

## 注意事项

- **先备份、后覆盖**：`.spherse/theme.css` 可能包含用户的自定义样式，绝不能未经备份直接覆盖。
- 备份文件放在项目根目录 `theme-backups/`（可见、可管理），不要放进 `.spherse/` 元数据目录。
- 拷贝主题时同步检查附带资源，保持 CSS 内相对路径可用。
- theme-06 内含 Google Fonts `@import`（JetBrains Mono），离线环境会回退到系统等宽字体，不影响主题本身。
- 本主题作用于**整个项目 UI**；若用户只想定制**单个 agent 的聊天窗口**，属于 `spherse-create-agent-chat-theme` 的范畴，不在本 skill 内。
- 应用后刷新即可生效，无需重启应用。
