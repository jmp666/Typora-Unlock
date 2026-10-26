# Typora 本地解锁补丁 — 使用说明

适用版本：Typora **1.10 ~ 1.14.15**（字节码架构）
适用平台：Windows / Linux（macOS 需先自检，见第 6 节）

> **已验证版本**：Windows 1.14.10、1.14.15；Linux 1.14.9

---

## 1. 这是什么

一个部署到 Typora 主进程的小补丁，作用是：

- 不再弹出「激活 Typora」对话框
- 左下角不再显示「未激活 ×」角标
- 自动维护试用期计数，使其保持在 8~15 天
- 编辑、渲染、保存、PDF 导出、图片导出全部正常

### 原理（一句话版）

Typora 主窗口能否创建，取决于**试用期剩余天数 > 0**，而不是授权状态 `hasL`。

剩余天数由**两处存储共同决定，必须同时正确**：

| 存储位置 | 字段 | 格式 |
|---|---|---|
| `%APPDATA%\Typora\profile.data` | `_iD` | hex 编码的 JSON |
| 注册表 `HKCU\Software\Typora` | `IDate` | `M/D/YYYY` |

**生效规则：取两者中较早的日期（MIN）。任一过期即判 0 天。** 四象限对照实验：

| `_iD` | `IDate` | 实际采用 |
|---|---|---|
| 今天 | 今天 | 今天 → 15 天 ✅ |
| 过期 | 过期 | 过期 → 0 天 |
| **今天** | 过期 | **过期 → 0 天** ❌ |
| 过期 | **今天** | **过期 → 0 天** ❌ |

> 所以**只改注册表无效**，必须两处同时维护。

补丁负责把这两处维护在有效区间，同时拦掉主进程注入的「未激活」UI 脚本。

> 文件创建时间（`birthtime`）**不参与**判定，改它无效。

### 它做不到什么

- 不能生成真实的授权码（需要 Typora 的 RSA 私钥）
- 不能把主进程内部的 `hasL` 改成 `true`（该变量封装在 V8 字节码闭包里）

### 关于自动更新（重要更正）

**早期版本的说法是错的。** 之前写"`hasL=false` 会自动禁用更新"，那是**从 `upgradePolicy` 字段推断**的，未经验证。

实测真相：

```js
// frame.js（渲染进程）里确实有这段
File.option.hasLicense
  ? t.upgradePolicy = ...   // "stable" / "dev" / "off"
  : t.upgradePolicy = "none"
```

但 `upgradePolicy` **只是 Analytics 上报字段**，不控制实际行为。
真正触发更新检查的是主进程的 `updater.checkForUpdates`，它**完全不看 `hasLicense`**。

实测证据：未打补丁的原版 Typora（`hasLicense=false`）照样弹「有新版本更新 1.14.15」。

**因此补丁现在会主动拦截更新**：

```
disabled IPC updater.checkForUpdates
disabled IPC updater.cancelUpdate
disabled IPC updater.skipUpdate
disabled IPC updater.downloadUpdate
patched menu item: 检查更新…
suppressed updater window (show)
```

> 想保留自动更新，把 `unlock.js` 里的 `UPD_SILENT` 改为 `false`，
> 并注释掉 `disableUpdater()` 那一段。

---

## 2. 环境要求

- **Node.js**（任意 16+ 版本），用于解包/重打包 `app.asar`
  验证：`node -v`
- Windows：需要**管理员权限**
- Linux / macOS：安装目录可写，或用 `sudo`

---

## 3. Windows 安装

### 步骤

1. 完全退出 Typora（任务栏右键 → 退出，或任务管理器结束进程）
2. 双击 `Install-TyporaUnlock.cmd`（**不需要手动右键提权**，脚本会自己请求）
3. 脚本会自动完成：
   - 探测 Typora 安装路径
   - 请求管理员权限
   - 备份原 `app.asar` → `app.asar.orig`
   - 解包 → 安装 `unlock.js` → 改 `main` → 重打包
4. 启动 Typora 验证

### 路径自动探测

脚本会依次检查这些位置：

```
C:\Program Files\Typora
C:\Program Files (x86)\Typora
%LOCALAPPDATA%\Programs\Typora
%LOCALAPPDATA%\Typora
%APPDATA%\Typora
D:\Program Files\Typora
D:\Typora
E:\Typora
C:\Typora
```

找到第一个含 `resources\app.asar` 的就用它。

**装在别处怎么办**：手动传路径。

```cmd
Install-TyporaUnlock.cmd "D:\MyApps\Typora"
Install-TyporaUnlock.cmd "D:\MyApps\Typora\resources"
```

两种写法都行，`\resources` 后缀会被自动去掉。

### 输出示例

```
[*] Auto-detecting Typora installation...
    found: C:\Program Files\Typora
[*] Typora root: C:\Program Files\Typora
[*] resources : C:\Program Files\Typora\resources
[*] Requesting administrator privileges...
[1/5] Backing up app.asar ...
[2/5] Extracting app.asar ...
[3/5] Installing unlock.js ...
[4/5] Switching entry point to unlock.js ...
[5/5] Repacking app.asar ...
[OK] Done. Launch Typora to verify:
       - no "Activate Typora" dialog
       - no "UNREGISTERED" badge at bottom-left
```

### 验证成功的标志

- 没有「激活 Typora」弹窗
- 左下角没有「未激活」字样
- 可以正常输入文字

### 诊断日志

如果出问题，查看：

```
%APPDATA%\Typora\unlock.log
```

正常启动的日志类似：

```
=== unlock.js boot ===
version=1.14.10
profile _iD -> 10/26/2026
registry IDate -> 10/26/2026
loading ...\app.asar\launch.dist.js
patched license URL
patched injection (873 bytes)
blocked auto-quit
suppressed license window (show)
```

### 还原

双击 `Uninstall-TyporaUnlock.cmd`（同样自动探测路径、自动提权）。

装在非标准位置时：

```cmd
Uninstall-TyporaUnlock.cmd "D:\MyApps\Typora"
```

还原会做三件事：

1. 把 `app.asar.orig` 复制回 `app.asar`
2. 删除解包出来的 `app` 目录
3. 删除 `app.asar.orig` 备份文件

> 注意：还原脚本删除备份后，就再没有回滚副本了。
> 如果需要保留，在还原前手动备份 `app.asar.orig`。

---

## 4. Linux 安装

### 步骤

```bash
# 1. 退出 Typora
pkill -f Typora

# 2. 给脚本执行权限
chmod +x install-unlock.sh uninstall-unlock.sh

# 3. 安装（自动探测安装路径）
./install-unlock.sh

# 若探测失败，手动指定 resources 目录：
./install-unlock.sh /usr/share/typora/resources
./install-unlock.sh /opt/Typora/resources
```

### 常见安装路径

| 安装方式 | 路径 |
|---|---|
| deb / rpm | `/usr/share/typora/resources` |
| tar.gz 解包 | `~/Typora/resources` |
| 自定义 | 你解压的位置 |

### 诊断日志

```bash
tail -f ~/.config/Typora/unlock.log
```

### 还原

```bash
./uninstall-unlock.sh
# 或
./uninstall-unlock.sh /usr/share/typora/resources
```

---

## 5. 文件说明

| 文件 | 用途 | 必须 |
|---|---|---|
| `unlock.js` | **主补丁**，部署到 `app.asar` 内部 | ✅ |
| `asar.js` | 解包 `app.asar` | ✅ |
| `asar_pack_noint.js` | 重打包 `app.asar`（不写完整性字段） | ✅ |
| `Install-TyporaUnlock.cmd` | Windows 安装脚本 | Windows |
| `Uninstall-TyporaUnlock.cmd` | Windows 还原脚本 | Windows |
| `install-unlock.sh` | Linux / macOS 安装脚本 | Linux/macOS |
| `uninstall-unlock.sh` | Linux / macOS 还原脚本 | Linux/macOS |
| `check-compat.js` | 版本兼容性自检 | 建议保留 |
| `app.asar.linux` | Linux 1.14.9 预制补丁包 | 可选 |

> `asar_pack_noint.js` 里的 **noint** 指「不写入 integrity 字段」。
> 这是关键：带 integrity 字段打包会导致 Typora 启动时校验失败。

---

## 6. 升级后怎么办

**Typora 升级会覆盖 `app.asar`，补丁会失效。** 升级后重新跑一次安装脚本即可。

但在升级前，建议先做兼容性检查：

```bash
node check-compat.js "/path/to/Typora/resources/app.asar"
```

输出示例：

```
=== Typora 1.14.10 (releaseId 49b5981e) ===
main 入口: launch.dist.js

--- jsc 锚点检测 ---
  ✓ File.option.hasLicense = false
  ✓ license.html
  ✓ dayRemains=
  ✓ UNREGISTERED
  ✓ watch L
  ✓ onUnfillLicense
  ✓ trailRemains
  ✓ profile.data
  ✓ _iD
  ✓ IDate
  ✓ renewLicense

--- 结论 ---
  PASS  launch.dist.js 存在
  PASS  atom.compiled.dist.jsc 存在
  PASS  main 可重定向
  PASS  锚点完整度 11/11
  PASS  锚点关键子集 (前4项)

✅ 兼容：可直接部署本补丁
```

### 兼容性对照

| 版本 | 状态 |
|---|---|
| 1.14.15 | ✅ 已实测（锚点 11/11，功能正常） |
| 1.14.10 | ✅ 已实测 |
| 1.14.9（Linux） | ✅ 已实测 |
| 1.14.x 其他 | ⚠️ 结构相同，跑 `check-compat.js` 确认 |
| 1.15.x | ⚠️ 大概率可用，跑 `check-compat.js` 确认 |
| 1.10 ~ 1.13 | ⚠️ 结构相同，未逐一实测 |
| ≤ 1.9.x | ❌ 架构不同（`main.node` + 加密 `atom.js`），不支持 |

### macOS 说明

macOS 的 dmg 是**在线安装器**（仅 14 MB），首次启动才下载应用本体。
因此无法预先分析，需要装好之后跑：

```bash
node check-compat.js "/Applications/Typora.app/Contents/Resources/app.asar"
```

若显示「✅ 兼容」，再执行 `./install-unlock.sh "/Applications/Typora.app/Contents/Resources"`。

> macOS 上 license 存储走 Keychain 而非注册表，`unlock.js` 已做平台判断，
> 非 Windows 会自动跳过注册表操作。

---

## 7. 故障排查

### 启动后闪退

1. 查看 `%APPDATA%\Typora\unlock.log`（Windows）或 `~/.config/Typora/unlock.log`
2. 若日志为空 → `unlock.js` 没被加载，检查 `package.json` 的 `main` 是否为 `unlock.js`
3. 若报 `launch.dist.js not found` → 版本架构不符，用 `check-compat.js` 确认

### 仍然显示「未激活」

1. 确认已完全退出 Typora 再启动（Typora 是单实例）
2. 检查日志里有没有 `patched injection` 和 `suppressed license window`
3. 若日志正常但界面仍显示 → 可能是新版本改了 UI 文案，需要调整 `unlock.js` 第 3c 节的清理正则

### 试用期仍显示 0 天

1. **两处必须同时正确**，只改一处无效：
   - `%APPDATA%\Typora\profile.data` 的 `_iD` 字段（hex 编码）
   - 注册表 `HKCU\Software\Typora` 的 `IDate`
2. 看日志里的这两行：
   ```
   当前 profile._iD=...  reg=...
   剩余天数 profile=N  reg=N
   ```
   若两个 N 都是正数却仍显示 0 天，说明有第三个来源，请把日志反馈出来。
3. 删掉 `unlock.state.json` 可以让补丁重新锚定。

### 想彻底回到原版

```bash
# Windows
Uninstall-TyporaUnlock.cmd

# Linux / macOS
./uninstall-unlock.sh
```

原版备份在 `app.asar.orig`，不会丢失。

### 关于换行符

`.cmd` 脚本必须用 **CRLF** 换行。如果你用编辑器改过脚本，注意保存时选择 CRLF：

| 编辑器 | 操作 |
|---|---|
| Notepad++ | 右下角点击 `Unix (LF)` → 选 `Windows (CRLF)` → 保存 |
| VS Code | 右下角 `LF` → 选 `CRLF` → 保存 |
| 记事本 | 默认 CRLF，无需处理 |

用 LF 保存的 `.cmd` 在部分 Windows 版本上会出现 `The syntax of the command is incorrect`
或 `goto` 跳转失效。

`.sh` 脚本则必须用 **LF**，不要转成 CRLF，否则 Linux 上报
`/bin/bash^M: bad interpreter`。

本包内的文件已经按各自平台设置好换行符，正常解压即可，无需改动。

---

## 8. 技术备注

### 为什么改 `main` 字段可以

Typora 的完整性校验（日志里的 `[LC] p`）只检查 `LicenseIndex.js` 的文件名哈希，
不检查 `package.json` 的 `main` 字段。所以把入口重定向到 `unlock.js` 是可行的，
日志里会出现 `[LC] p` 警告，但不影响运行。

### 为什么不能改 `.jsc`

`atom.compiled.dist.jsc` 是 V8 字节码缓存。改动任何字节都会触发
`cachedDataRejected`，V8 直接拒绝加载，程序崩溃。等长改动、语义等价改动都会失败。

### 为什么 `hasL` 改不动

它是 `atom.compiled.dist.jsc` 内部的闭包变量，不挂载到任何可访问对象上
（`global`、`require.cache`、`process` 都查过）。
`publicDecrypt`、`native-reg.getValue` 都可以 hook，但改不了这个闭包变量的值。

### 为什么不联网（无暗桩上报）

分两部分看。

**授权校验不联网**：`renewLicense`（每 12 小时校验）只在 `hasL === true` 时才注册定时器。
`hasL=false` 时它根本不会被创建。

实测：强制把 12 小时定时器改成 3 秒、`SLicense` 设为非空、跑 75 秒，
监控 `https.request` / `http.request` / `global.fetch` / `net.connect` / `tls.connect` 五层，
**NET 记录数 = 0**。

**但更新检查本来会联网**：原版 Typora 启动后会检查新版本（实测会弹出 1.14.15 提示）。
补丁已把 `updater.*` 全部拦截，所以补丁状态下同样不会联网。

90 秒全程监控实测（补丁状态）：

```
07:25:20 === boot ===
07:25:20 SPAWN execFileSync reg.exe     ← 补丁自己读注册表
07:26:50 === 90 秒到，结束监控 ===
```

除补丁自身的 `reg.exe` 调用外，**零网络请求、零子进程**。

### 存在哪些检测点

| 检测点 | 行为 | 影响 |
|---|---|---|
| `[LC] p` | 检查 `LicenseIndex.js` 文件名哈希 | 仅日志警告，不阻断 |
| `Integrity check failed` | 检查 asar 内容 | 仅日志警告 |
| `onUnfillLicense` | 验签失败时清空 `SLicense` | 不影响试用期 |

**未发现**：定时回传、设备指纹上报、功能降级、数据损坏。

### 刷新策略（低痕迹设计）

补丁**不是**每次启动都刷成今天。实际逻辑：

1. 首次运行：锚定一个"虚拟安装日" = 今天 - 7 天（剩余 8 天），存入 `unlock.state.json`
2. 之后每次启动：两处剩余天数都 ≥ 7 就**完全不写入**
3. 剩余天数 < 7 时：恢复到锚点日期
4. 锚点也过期时：重新锚定为"今天 - 7 天"

实测验证：

```
第一次启动: 剩余天数 profile=-2475 reg=-2475
            → 重新锚定 10/19/2026（剩余 8 天）

第二次启动: 剩余天数 profile=8 reg=8
            → 两处均充足，保持不变
            → 文件 hash 完全不变（D35507A9B9）
```

> `profile.data` 的 `mtime` 每次启动都会变，但这是 **Typora 自己保存窗口状态**导致的，
> 用原始未打补丁的 asar 对照，`mtime` 同样会变，与补丁无关。

### 已实测的功能清单

| 功能 | 状态 |
|---|---|
| 编辑 / 渲染 / 保存 | ✅ |
| PDF 导出 | ✅（51,910 / 18,777 字节，中文用 MicrosoftYaHei 子集嵌入） |
| 图片导出 | ✅（784×635 PNG，无 watermark） |
| 表格 / 代码块 / 列表 | ✅ |
| 自动更新 | ⚠️ 被禁用（`upgradePolicy=none`） |

---

## 9. 免责声明

本补丁仅用于**本地学习研究**（分析 Electron 应用的主进程架构、V8 字节码保护机制、
asar 打包格式）。请在试用期结束后购买正版授权以支持开发者。

使用本补丁产生的任何后果由使用者自行承担。
