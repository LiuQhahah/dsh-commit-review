# dsh-commit-review 发布状态与后续步骤

## 当前状态（2026-11-10）

| 项 | 状态 |
| --- | --- |
| 代码/打包 | ✅ 就绪，`npm pack` 10 文件 / 16.8 kB |
| `npm publish` | ❌ E403：`Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages` |
| `npm stage publish` | ✅ 成功，已暂存 `dsh-commit-review@1.0.0`，stage id `90a75e3e-e703-4c21-a2eb-74c091862a3f` |
| `npm stage approve` | ❌ 404（因为账号没开 2FA） |
| registry 现状 | ⚠️ 包名已可被公开安装，但解析到 `0.0.0-stage` 占位空壳 |

## 根因

不是「token 过期」那么简单，是 npm 现在的发布策略：

1. `npm publish` 要求**发布时必须提供 2FA 证明**（proof-of-presence）。
2. 你的账号 `gabi-saul` 的 `tfa` 是 **false**（`GET /-/npm/v1/user` 实测），即根本没开 2FA。
3. `~/.npmrc` 里那把 `npm_DL3sc…` 是 `npm login` 的**会话 token**，会话 token 没有 bypass-2FA 权限；账号里唯一一把带 `bypass_2fa=true` 的 granular token（`pi-web`）已在 2026-10-21 过期。
4. 所以注册表只能拒绝：既没有 2FA 码，token 也不能免 2FA。

`npm stage publish` 之所以能成功，是因为手册明确写了它**故意跳过 2FA**（把 2FA 推迟到 approve）；但 `npm stage approve` 和 `npm stage reject` 都需要 2FA，而账号没开 2FA → 两者都返回 404。

## 你的情况：2FA 已开，但用的是「安全密钥」不是「验证器 App」

`GET /-/npm/v1/user` 现在返回 `tfa: { mode: "auth-and-writes", pending: null }`，2FA 已生效。
没有二维码那一步，是因为你注册的是 **security key**（WebAuthn：Touch ID / Face ID / YubiKey 这类），
不是 TOTP 验证器 App。两者都算 2FA，只是验证方式不同——安全密钥走浏览器，不产生 6 位数字码。

所以 `--otp=<6位码>` 这条路对你**不适用**（你没有 6 位码可输），要走浏览器认证流程。

## 你要做的：一条命令

在**你自己的终端**里跑（必须是交互式终端，npm 需要 TTY 才能弹浏览器）：

```bash
cd /Users/qiang_liu/Downloads/workspace/iam/dsh-plugins/commit-review
npm stage approve 90a75e3e-e703-4c21-a2eb-74c091862a3f
```

它会打印类似：

```
npm error code EOTP
npm error This operation requires a one-time password.
npm error Open this URL in your browser to authenticate:
npm error   https://www.npmjs.com/auth/cli/<uuid>
```

**点开那个 URL**（或在提示时让它自动打开）→ 页面上点 **Use security key** → Touch ID / 插入 YubiKey →
认证成功后 CLI 会自动完成 approve，1.0.0 就发布出去了。

### 不要直接 `npm publish`

`1.0.0` 已经被 staged 占了 semver 唯一索引，npm 手册原文：

> Staged packages share the same semver version unique index as published packages —
> you cannot publish a version that already exists as a staged version for that package.

直接 `npm publish` 1.0.0 会报 `409 Cannot publish over previously staged version`。
要么 approve 已暂存的那条（推荐），要么先 `npm stage reject <id>` 再重新 publish。

### ⚠️ 别用恢复码（recovery code）认证

npm 文档原文：

> Using a recovery code to log in triggers a temporary **72-hour security hold** on your account.
> During this time, you cannot publish packages, create access tokens, or modify account settings.

请用安全密钥本身，不要用恢复码。

## ⚠️ 需要尽快收尾的原因

`npm stage publish` 会在 registry 里创建一个公开可见的 **`0.0.0-stage` 占位版本**（`stub: true`），`dist-tags.latest` 指向它。实测：

```
$ npm install dsh-commit-review
added 1 package
$ ls node_modules/dsh-commit-review/
package.json  README.md     ← 空壳，没有任何功能代码
```

也就是说，现在任何人执行 `dsh plugin --profile web add dsh-commit-review` 都会装到一个空包。所以这件事要尽快用 approve（发布 1.0.0）或 reject（删掉暂存 + 占位）收尾，不要长期挂着。

## 发布后的收尾

### 让别人能一键安装

```bash
dsh plugin --profile web add dsh-commit-review
```

### 收录进插件市场（dshmarket 才能搜到）

`dshmarket` 读的是 https://awesome-dsh-plugin.com/plugins.json ，收录方式是给 `awesome-dsh-plugin/awesome-dsh-plugin` 提 PR，加一个文件 `data/plugins/LiuQhahah__dsh-commit-review.yml`：

```yaml
url: https://github.com/LiuQhahah/dsh-commit-review
name: LiuQhahah/dsh-commit-review
category: git
description:
  en: 'Review commits produced in the current workspace, grouped by repository, with per-file diffs, in a sidebar tab.'
  zh: '在侧栏按仓库分组查看本工作区产生的提交，每个提交可展开查看文件级 diff。'
```

`category` 合法值：`agi` `ui` `usage` `theme` `model` `identity` `session` `memory` `tools` `wsl` `browser` `vision` `voice` `docs` `skill` `workflow` `git` `notify` `dev` `security` `remote` `market` `fun`。选 `git` 最贴。

收录硬要求（均已满足）：`package.json` 有 `dsh.bundle` ✓、真实代码 ✓、建仓满 1 天（2026-11-09 建）✓、有 `dsh-plugin` topic ✓、非纯聚合包 ✓。
