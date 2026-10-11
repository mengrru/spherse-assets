# spherse-assets

Spherse 官方静态资源发布仓库。资源源文件在此仓库中 git 管理，通过 GitHub Actions 手动触发发布流水线，构建产物（manifest + zip 包）上传到阿里云 OSS 公共读 bucket，供 Spherse 客户端拉取。

目前支持的资源类型：

| 类型 | 源目录 | OSS 路径 | 说明 |
|---|---|---|---|
| skills | `skills/` | `spherse/skills/` | 技能市场（Skill Marketplace） |
| projects | `projects/` | `spherse/projects/` | 项目市场（Project Marketplace） |
| prompts | `prompts/` | `spherse/prompts/` | 提示词模板市场（Prompt Template Marketplace），每语言一个大 JSON |
| samples | `samples/` | `spherse/sample/` | 预留：示例项目等，尚未接入发布脚本 |

## 技能源格式

每个技能是一个目录：`skills/{skill-name}/`，其中必须有 `SKILL.md`（YAML frontmatter + Markdown 正文）：

```markdown
---
name: my-skill
description: 一句话描述技能用途与触发时机
version: 1.2.0
---

（技能指令正文）
```

要求：

- `name` 必须与目录名完全一致，且不含 `/ \ :`、不以 `.` 开头
- `version` 必须是合法 semver；**内容变更后必须提升 version，否则发布流水线不会识别**（diff 基于 version）
- 目录下的其它文件（`references/`、`scripts/` 等）会作为 companion files 一起打包
- 下架技能 = 删除对应目录，下次发布后 manifest 自动移除该条目（OSS 旧 zip 保留作不可变历史）

## 项目源格式

每个项目是一个目录：`projects/{project-name}/`，其中必须有 `meta.json`（元数据，**打包 zip 时会自动排除**）：

```json
{
  "name": "my-world",
  "description": "一句话描述项目",
  "version": "1.2.0",
  "category": "游戏"
}
```

要求：

- `name` 必须与目录名完全一致，且不含 `/ \ :`、不以 `.` 开头
- `description`、`category` 必填非空；`category` 为自由字符串，客户端顶部分类菜单按其动态归并
- `version` 必须是合法 semver；**内容变更后必须提升 version，否则发布流水线不会识别**（diff 基于 version）
- 目录下其它内容任意（项目文件、嵌套的 meta.json 均保留），zip 顶层目录 = 项目名
- 下架项目 = 删除对应目录，下次发布后 manifest 自动移除该条目（OSS 旧 zip 保留作不可变历史）

## 提示词模板源格式

每个提示词模板是一个目录：`prompts/{prompt-id}/`，按语言拆分内容与元数据文件：

```
prompts/my-template/
  meta.zh-cn.json     # 标题 / 简介 / 类别（zh-cn 版）
  meta.en-us.json     # 标题 / 简介 / 类别（en-us 版）
  zh-cn.md            # 提示词正文（zh-cn 版）
  en-us.md            # 提示词正文（en-us 版）
```

`meta.{lang}.json` 结构（三字段均必填非空）：

```json
{
  "title": "世界观创作助手",
  "description": "一句话简介",
  "category": "创作"
}
```

要求：

- `prompt-id` 规则与 skills/projects 的 name 一致（不含 `/ \ :`、不以 `.` 开头）
- 语言码格式 `^[a-z]{2}(-[a-z]{2})?$`（如 `zh-cn`、`en-us`）
- 每个目录至少一个 `{lang}.md` 且至少一个 `meta.{lang}.json`；只识别 `{lang}.md`、`meta.{lang}.json`、`README.md` 三类文件，其余文件报错
- 无版本化与 diff：每次发布全量重新生成所有语言 JSON 并覆盖上传（内容直接内联，客户端无安装步骤）
- build 语义（`scripts/publish-prompts.mjs`）：语言集合 = 全部内容文件语言的并集；`{lang}.json` 只包含拥有 `{lang}.md` 的模板；某模板缺 `meta.{lang}.json` 时按回退链取——zh 系语言 `当前语言 → zh-cn → en-us`，其余语言 `当前语言 → en-us → zh-cn`，链耗尽则报错
- 下架模板 = 删除对应目录后重新发布；全量下架需手动删除 OSS 对象（空目录发布会直接报错，防误删）

## 发布流程（projects）

1. 在 `projects/` 下添加或修改项目内容并提升 `version`，提交推送
2. GitHub → Actions → 「Publish assets to OSS」→ Run workflow，选择 resource = `projects`
3. 流水线逻辑（`scripts/publish-projects.mjs`）：
   - 扫描并校验全部项目（name/description/version/category）
   - 从仓库全量生成新 manifest
   - 拉取 OSS 当前 manifest，diff 出新增或 version 变化的项目
   - 仅将这些项目打包为 zip（顶层目录 = 项目名，排除顶层 meta.json）写入 `dist/`
   - CI 用 ossutil 上传变更的 zip，最后覆盖上传 manifest

本地 dry-run：

```bash
npm install
npm test                 # 发布逻辑单测（skills + projects）
OSS_PUBLIC_BASE_URL=https://example.com npm run publish:projects  # 本地生成 dist/（真实 fetch 远端 manifest；不会上传）
```

## 发布流程（skills）

1. 修改 `skills/` 下的技能内容并提升 `version`，提交推送
2. GitHub → Actions → 「Publish assets to OSS」→ Run workflow，选择 resource = `skills`
3. 流水线逻辑（`scripts/publish-skills.mjs`）：
   - 扫描并校验全部技能（name/description/version）
   - 从仓库全量生成新 manifest
   - 拉取 OSS 当前 manifest，diff 出新增或 version 变化的技能
   - 仅将这些技能打包为 zip（顶层目录 = 技能名）写入 `dist/`
   - CI 用 ossutil 上传变更的 zip，最后覆盖上传 manifest

本地 dry-run：

```bash
npm install
npm test              # 发布逻辑单测
OSS_PUBLIC_BASE_URL=https://example.com npm run publish:skills   # 本地生成 dist/（真实 fetch 远端 manifest；不会上传）
```

## 发布流程（prompts）

1. 在 `prompts/` 下添加或修改模板（多语言内容 + meta），提交推送
2. GitHub → Actions → 「Publish assets to OSS」→ Run workflow，选择 resource = `prompts`
3. 流水线逻辑（`scripts/publish-prompts.mjs`）：
   - 扫描并校验全部模板（id / 语言码 / meta 字段 / meta 回退链可解析）
   - 按语言生成 `dist/spherse/prompts/{lang}.json`（每语言一个大 JSON，全量内容内联）
   - CI 用 ossutil 覆盖上传全部语言 JSON（无需 OSS_PUBLIC_BASE_URL，各语言 JSON 相互独立）

本地 dry-run：

```bash
npm install
npm test                 # 发布逻辑单测（skills + projects + prompts）
npm run publish:prompts  # 本地生成 dist/（不会上传）
```

## OSS 布局

```
spherse/skills/manifest.json                                ← 全量清单，每次发布覆盖
spherse/skills/{name}/{version}/{name}-{version}.zip         ← 版本化 zip，不可变
spherse/projects/manifest.json                               ← 全量清单，每次发布覆盖
spherse/projects/{name}/{version}/{name}-{version}.zip       ← 版本化 zip，不可变
spherse/prompts/{lang}.json                                  ← 每语言一个大 JSON，每次发布覆盖
```

客户端（Spherse）通过 manifest 中的 `zipUrl` 下载 zip，并校验其与 manifest 同源；提示词模板市场按 app 语言请求对应的 `{lang}.json`，整包 404 时由 server 侧回退（zh 系 → zh-cn 优先，缺省 en-us，兜底 zh-cn）。

## 必需的仓库配置

Repository variables：

| 变量 | 示例 | 用途 |
|---|---|---|
| `OSS_PUBLIC_BASE_URL` | `https://download.example.com` | manifest 中 zipUrl 的 base，需与 Spherse 端 manifest 常量同源 |
| `OSS_BUCKET` | `my-bucket` | 上传目标 bucket |
| `OSS_ENDPOINT` | `oss-cn-beijing.aliyuncs.com` | bucket 所在地 endpoint（ossutil `-e` 参数，不带 bucket 前缀） |

Repository secrets：

| 密钥 | 用途 |
|---|---|
| `OSS_ACCESS_KEY_ID` | ossutil 上传凭证 |
| `OSS_ACCESS_KEY_SECRET` | ossutil 上传凭证 |

命名与 Spherse 主仓库的 release 流水线保持一致。
