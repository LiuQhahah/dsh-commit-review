# dsh-commit-review npm 发布步骤（已准备好的部分 + 你要执行的 3 步）

## 我已经做好的（commit 4d553a2 已 push）

- 包名 `@local/dsh-commit-review` → `dsh-commit-review`（package.json / cordis.patch.yml / client.js 的 loader id / index.js 注释，共 5 处）
- 删掉 `"private": true`
- 补 `license: MIT`、`repository`、`homepage`、`bugs`、`keywords`（含 `dsh-plugin`）
- README 的 5 张图改成 `raw.githubusercontent.com` 绝对地址（npm 页面不再裂图，包体积仍 16.8 kB）
- 本地 profile 的安装从旧名迁到新名（`plugin_manager remove_bundle` + `install_bundle`），已确认 3080 路由正常
- 用打包出来的 tarball 在隔离 profile 里完整验证过：`[commit-review] routes registered`、bundle 注入、右侧栏出现 `Commit review`
- 仓库加了 `dsh-plugin` topic
- `npm publish --dry-run` 通过：10 files / 16.8 kB

## 你要执行的 3 步

### 1. 登录 npm（当前 token 已失效）

```bash
npm login
```

`~/.npmrc` 里 registry.npmjs.org 那个 token 实测返回 401，必须重新登录。没有 npm 账号就先在 https://www.npmjs.com/signup 注册。

### 2. 发布

```bash
cd /Users/qiang_liu/Downloads/workspace/iam/dsh-plugins/commit-review
npm publish
```

不用加 `--access public`（无 scope 的包默认 public）。

### 3. 验证

```bash
npm view dsh-commit-review version
```

## 发布后（可选，但推荐）

### A. 让别人能一键安装

```bash
dsh plugin --profile web add dsh-commit-review
```

### B. 收录进插件市场（dshmarket 才能搜到）

`dshmarket` 读的是 https://awesome-dsh-plugin.com/plugins.json ，收录方式是**给 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR**，加一个文件 `data/plugins/LiuQhahah__dsh-commit-review.yml`：

```yaml
url: https://github.com/LiuQhahah/dsh-commit-review
name: LiuQhahah/dsh-commit-review
category: git
description:
  en: 'Review commits produced in the current workspace, grouped by repository, with per-file diffs, in a sidebar tab.'
  zh: '在侧栏按仓库分组查看本工作区产生的提交，每个提交可展开查看文件级 diff。'
```

注意 `category` 从这些里选：`agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools` `wsl` `browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify` `dev` `security` `remote` `market` `fun`。选 `git` 最贴。

收录要求（已满足的）：仓库 `package.json` 有 `dsh.bundle` 声明 ✓、真实代码 ✓、建仓满 1 天（2026-11-09 建，明天达标）、有 `dsh-plugin` topic ✓。
