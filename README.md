# spherse-assets

Spherse 官方静态资源发布仓库。资源源文件在此仓库中 git 管理，通过 GitHub Actions 手动触发发布流水线，构建产物（manifest + zip 包）上传到阿里云 OSS 公共读 bucket，供 Spherse 客户端拉取。

目前支持的资源类型：

| 类型 | 源目录 | OSS 路径 | 说明 |
|---|---|---|---|
| skills | `skills/` | `spherse/skills/` | 技能市场（Skill Marketplace） |
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

## OSS 布局

```
spherse/skills/manifest.json                                ← 全量清单，每次发布覆盖
spherse/skills/{name}/{version}/{name}-{version}.zip         ← 版本化 zip，不可变
```

客户端（Spherse）通过 manifest 中的 `zipUrl` 下载 zip，并校验其与 manifest 同源。

## 必需的仓库配置

Repository variables：

| 变量 | 示例 | 用途 |
|---|---|---|
| `OSS_PUBLIC_BASE_URL` | `https://download.example.com` | manifest 中 zipUrl 的 base，需与 Spherse 端 manifest 常量同源 |
| `OSS_BUCKET` | `my-bucket` | 上传目标 bucket |

Repository secrets：

| 密钥 | 用途 |
|---|---|
| `OSS_ACCESS_KEY_ID` | ossutil 上传凭证 |
| `OSS_ACCESS_KEY_SECRET` | ossutil 上传凭证 |

命名与 Spherse 主仓库的 release 流水线保持一致。
