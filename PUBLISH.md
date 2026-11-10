# dsh-commit-review 发布记录

## 状态：已发布 ✅

| 项 | 值 |
| --- | --- |
| 包名 | `dsh-commit-review` |
| 最新版本 | **1.0.0** |
| 发布时间 | 2026-11-10T07:09:22Z |
| maintainer | `gabi-saul <liuqiang9596@gmail.com>` |
| 文件数 / 体积 | 10 个文件 / 16.8 kB（解包 52.4 kB） |
| shasum | `e0d638a2cfc8311f628d1564331d4602a122e895` |
| 安装方式 | `dsh plugin --profile web add dsh-commit-review` |

## 发布过程（踩过的两个坑）

### 坑 1：`npm publish` 报 E403

```
403 Forbidden - PUT https://registry.npmjs.org/dsh-commit-review
Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.
```

原因：npm 现在要求**发布时必须提供 2FA 证明**（proof-of-presence）。当时的状况是账号没开 2FA，
`~/.npmrc` 里那把是 `npm login` 的会话 token（没有 bypass-2FA 能力），账号里唯一带 `bypass_2fa=true`
的 granular token 已于 2026-10-21 过期。三个条件叠加 → 只能拒绝。

### 坑 2：`npm stage approve` 报 404

用 `npm stage publish` 绕过 2FA 暂存成功后（这一步不需要 2FA，是 npm 的设计），
`npm stage approve` 一直返回 `404 staged version "<id>" not found`。

原因：`npm stage approve` / `reject` **都需要 2FA**。账号没开 2FA 时，注册表返回的是 404
而不是明确的权限错误，所以很容易误判成「stage id 拼错了」。开完 2FA 后同一个请求立刻变成
`401 EOTP`（要求提供一次性密码），才是正常的提示。

### 安全密钥（security key）没有二维码

如果 2FA 配的是 security key（WebAuthn：Touch ID / Face ID / YubiKey）而不是 TOTP 验证器 App，
**没有二维码、也没有 6 位数字码**。这时不能用 `--otp=<6位码>`，要走浏览器流程：

```bash
npm stage approve <stage-id>
# 打印 https://www.npmjs.com/auth/cli/<uuid>
# 点开 → Use security key → Touch ID / YubiKey
```

## 注意事项

- **不要用 recovery code 认证**：npm 文档写明用恢复码登录会触发 **72 小时 security hold**，
  期间不能发布包、不能创建 token、不能改账号设置。
- **staged 版本占用 semver 唯一索引**：同一版本号不能既 staged 又 publish，会报
  `409 Cannot publish over previously staged version`。必须先 approve 或 reject。
- **staged 期间会有公开占位包**：`npm stage publish` 会创建一个 `0.0.0-stage` 空壳版本
  （`stub: true`），`dist-tags.latest` 指向它，此时 `npm install` 装到的是空包。所以
  暂存后要尽快 approve 或 reject，不要长期挂着。
- **bypass-2FA token 将在 2027 年 1 月失效**：
  https://gh.io/bypass-2fa-tokens-no-longer-publish

## 收录进插件市场（dshmarket）

`dshmarket` 读的是 https://awesome-dsh-plugin.com/plugins.json ，不自动发现 npm 包。
收录方式是给 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR，加一个文件
`data/plugins/LiuQhahah__dsh-commit-review.yml`：

```yaml
url: https://github.com/LiuQhahah/dsh-commit-review
name: LiuQhahah/dsh-commit-review
category: git
description:
  en: 'Review commits produced in the current workspace, grouped by repository, with per-file diffs, in a sidebar tab.'
  zh: '在侧栏按仓库分组查看本工作区产生的提交，每个提交可展开查看文件级 diff。'
```

`category` 合法值：`agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools`
`wsl` `browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify` `dev` `security`
`remote` `market` `fun`。选 `git` 最贴。

收录硬要求（均已满足）：

- `package.json` 声明 `dsh.bundle` ✓（只有 `dsh.client` 是最常见的拒稿原因）
- 真实可用的代码 ✓
- 仓库创建满 1 天 ✓（2026-11-09 创建）
- 仓库带 `dsh-plugin` topic ✓
- 非纯聚合包 ✓
- 描述属实、不带营销词 ✓

## 发布后的验证记录

从真实 registry 安装并端到端跑通：

```bash
npm install dsh-commit-review    # 10 个文件，stub 字段消失
```

隔离 profile 里启动 DSH：

- 日志出现 `[commit-review] routes registered under /api/commit-review`
- boot HTML 注入 `dsh-commit-review/client.js&rev=82d4e68e9a17`
- `/api/commit-review/repos?sessionId=x` 返回自家 400（路由存在）
- Playwright 打开右侧栏看到 `["File Review", "Commit review", "Session log"]`
- 点开 tab 后正常渲染 commit 内容，**0 个 page error**
