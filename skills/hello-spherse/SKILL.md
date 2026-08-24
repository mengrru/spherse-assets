---
name: hello-spherse
description: 示例技能：介绍技能包仓库的目录结构与发布流程，可作为新技能的模板。
version: 0.2.0
---

# Hello Spherse

这是一个示例技能，演示 spherse-assets 仓库中技能包的标准结构：

- `skills/{skill-name}/SKILL.md`：技能定义，frontmatter 必须包含 `name`（与目录名一致）、`description` 和 `version`（合法 semver）
- 同目录下的其它文件（如 `references/`、`scripts/`）会作为 companion files 一起打包发布

修改技能内容后，必须提升 `version` 才会被发布流水线识别并上传。
