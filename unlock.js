// ============================================================
//  Typora 本地解锁 —— 主进程补丁（跨版本 / 跨平台）
//  部署：把 package.json 的 main 指向本文件
//
//  【实测确认的机制】
//   1. 主窗口创建条件 = dayRemains > 0，与 hasL 无关
//   2. dayRemains 由两处共同决定，必须同时正确：
//        a) %APPDATA%\Typora\profile.data 的 _iD 字段（hex 编码 JSON）
//        b) 注册表 HKCU\Software\Typora 的 IDate
//      任一过期即判 0 天（四象限实验验证）
//   3. 文件创建时间（birthtime）不参与判定
//   4. hasL=false 只影响自动更新策略，不影响编辑/导出
//   5. renewLicense 仅在 hasL=true 时注册，hasL=false 永不联网
//
//  【本版策略：低痕迹】
//   不再每次启动都刷成今天，改为：
//     - 首次运行时锚定一个"虚拟安装日"（存于 unlock.state.json）
//     - 只在剩余天数 < 7 时才把日期前移，保持剩余 8~15 天区间
//     - 这样 profile.data 的 mtime 只在必要时变化，不形成规律
// ============================================================
"use strict";
const path = require("path");
const fs = require("fs");
const electron = require("electron");

const APPDATA = process.env.APPDATA || path.join(require("os").homedir(), ".config");
const UD = path.join(APPDATA, "Typora");
const LOG = path.join(UD, "unlock.log");
const STATE = path.join(UD, "unlock.state.json");
const PROFILE = path.join(UD, "profile.data");

function log(msg) {
  try {
    if (fs.existsSync(LOG) && fs.statSync(LOG).size > 256 * 1024) fs.unlinkSync(LOG);
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch (e) {}
}

log("=== unlock.js boot ===");
try { log("version=" + electron.app.getVersion()); } catch (e) {}

// ---------- 工具函数 ----------
const TRIAL_DAYS = 15;
const REFRESH_BELOW = 7;   // 剩余天数低于此值才刷新

function dstr(d) {
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

function parseD(s) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || "").trim());
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return isNaN(d.getTime()) ? null : d;
}

function daysBetween(a, b) {
  const MS = 86400000;
  const x = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const y = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((y - x) / MS);
}

// ---------- 读 profile.data（hex 编码 JSON） ----------
function readProfile() {
  if (!fs.existsSync(PROFILE)) return null;
  try {
    const hex = fs.readFileSync(PROFILE, "utf8").trim();
    if (!/^[0-9a-fA-F]+$/.test(hex)) { log("profile.data 非 hex"); return null; }
    return JSON.parse(Buffer.from(hex, "hex").toString("utf8"));
  } catch (e) { log("readProfile err: " + e.message); return null; }
}

function writeProfile(obj) {
  const hex = Buffer.from(JSON.stringify(obj), "utf8").toString("hex");
  fs.writeFileSync(PROFILE, hex, "ascii");
}

// ---------- 读注册表 IDate ----------
function readReg() {
  if (process.platform !== "win32") return null;
  try {
    const out = require("child_process").execFileSync(
      "reg.exe",
      ["query", "HKCU\\Software\\Typora", "/v", "IDate"],
      { windowsHide: true, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    const m = /IDate\s+REG_SZ\s+(\S+)/.exec(out);
    return m ? m[1].trim() : null;
  } catch (e) { return null; }
}

function writeReg(val) {
  if (process.platform !== "win32") return;
  try {
    require("child_process").execFileSync(
      "reg.exe",
      ["add", "HKCU\\Software\\Typora", "/v", "IDate", "/t", "REG_SZ", "/d", val, "/f"],
      { windowsHide: true, stdio: "ignore" }
    );
  } catch (e) { log("writeReg err: " + e.message); }
}

// ---------- 读/写状态 ----------
function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch (e) { return {}; }
}
function writeState(o) {
  try { fs.writeFileSync(STATE, JSON.stringify(o, null, 2), "utf8"); } catch (e) {}
}

// ---------- 核心：维护试用期 ----------
(function keepTrialAlive() {
  try {
    if (!fs.existsSync(PROFILE)) { log("profile.data 不存在，跳过"); return; }

    const prof = readProfile();
    if (!prof) return;

    // 找到安装日期字段
    const KEY = ["_iD", "installDate", "iD"].find((k) => k in prof);
    if (!KEY) { log("未找到安装日期字段，现有字段: " + Object.keys(prof).join(",")); return; }

    const today = new Date();
    const profDate = parseD(prof[KEY]);
    const regDate = parseD(readReg());

    log(`当前 profile.${KEY}=${prof[KEY]}  reg=${readReg()}`);

    // 计算两处各自剩余天数
    const profLeft = profDate ? TRIAL_DAYS - daysBetween(profDate, today) : -999;
    const regLeft = regDate ? TRIAL_DAYS - daysBetween(regDate, today) : -999;
    log(`剩余天数 profile=${profLeft}  reg=${regLeft}`);

    // 【实测确认】Typora 取两处的 MIN（较早的日期）作为生效安装日。
    // 验证矩阵：
    //   _iD=10/25 reg=10/20 → 采用 10/20
    //   _iD=10/20 reg=10/25 → 采用 10/20
    //   _iD=1/1/2020 reg=有效 → 采用 1/1/2020（0 天）
    // 因此两处必须同时有效，任一过期就整体失效。
    const effectiveLeft = Math.min(profLeft, regLeft);
    log(`生效剩余天数（取 MIN）= ${effectiveLeft}`);

    const st = readState();

    // 决定目标安装日
    let target = null;

    // 情况 A：生效值仍充足 → 完全不写入
    if (effectiveLeft >= REFRESH_BELOW) {
      log("生效值充足，保持不变（不写入任何文件）");
      st.lastSeen = dstr(today);
      writeState(st);
      return;
    }

    // 情况 B：需要刷新。优先沿用锚点，让日期看起来稳定
    const anchor = parseD(st.anchor);
    const anchorLeft = anchor ? TRIAL_DAYS - daysBetween(anchor, today) : -999;

    // 锚点合理性校验：不能晚于今天，也不能晚于两处已有日期中较早的那个
    // （否则锚点会"跳过"真实安装日，导致判定不一致）
    const minExisting = [profDate, regDate].filter(Boolean)
      .sort((a, b) => a - b)[0] || null;
    const anchorSane = anchor
      && anchorLeft >= REFRESH_BELOW
      && anchor <= today
      && (!minExisting || anchor <= minExisting || effectiveLeft < 0);

    if (anchorSane) {
      target = anchor;
      log(`使用锚点 ${dstr(anchor)}（剩余 ${anchorLeft} 天）`);
    } else {
      if (anchor && !anchorSane) {
        log(`锚点 ${dstr(anchor)} 不合理，丢弃`);
      }
      // 重新锚定：今天 - 7 天 → 剩余 8 天
      const nd = new Date(today);
      nd.setDate(nd.getDate() - (TRIAL_DAYS - 8));
      target = nd;
      st.anchor = dstr(nd);
      log(`重新锚定 ${dstr(nd)}（剩余 8 天）`);
    }

    const tstr = dstr(target);

    // 两处都要写，缺一不可（因为取 MIN）
    if (prof[KEY] !== tstr) {
      prof[KEY] = tstr;
      writeProfile(prof);
      log(`profile.${KEY} -> ${tstr}`);
    }

    // 写入注册表
    if (readReg() !== tstr) {
      writeReg(tstr);
      log(`registry IDate -> ${tstr}`);
    }

    st.lastSeen = dstr(today);
    writeState(st);
  } catch (e) {
    log("keepTrialAlive error: " + e.message);
  }
})();

// ---------- 1. 阻止 jsc 内部的自动退出（仅启动阶段，且只拦一次） ----------
//
// 背景：试用期到期时，jsc 会在启动后 ~1s 调一次 app.quit()。
// 旧实现用调用栈正则判断，但用户点「退出」/关窗口时，
// 调用栈同样会经过 atom.compiled.dist.jsc（菜单和窗口处理都在里面），
// 导致正常退出也被拦 → 窗口关了进程不退。
//
// 新实现：
//   - 只拦「启动后 8 秒内的第一次」quit，拦完立即失效
//   - 之后所有 quit 一律放行
//   - 另加 watchdog：所有窗口都销毁后若进程仍存活，强制退出
(function guardStartupQuit() {
  const START = Date.now();
  const WINDOW_MS = 8000;
  let blocked = 0;

  const _quit = electron.app.quit.bind(electron.app);
  const _exit = electron.app.exit.bind(electron.app);

  electron.app.quit = function () {
    const elapsed = Date.now() - START;
    if (blocked === 0 && elapsed < WINDOW_MS) {
      blocked++;
      log(`blocked startup auto-quit (t=${elapsed}ms, 仅此一次)`);
      return;
    }
    log(`quit allowed (t=${elapsed}ms, 已拦 ${blocked} 次)`);
    return _quit();
  };

  // 兜底 1：标准事件
  electron.app.on("window-all-closed", () => {
    log("window-all-closed → 退出进程");
    try { _quit(); } catch (e) {}
    setTimeout(() => { try { _exit(0); } catch (e) { process.exit(0); } }, 800);
  });

  // 兜底 2：watchdog —— Typora 1.14.15 的 cancelQuit 机制
  // 会让「关窗口」不触发 window-all-closed，进程残留。
  // 这里定期检查：若没有任何可见窗口，且启动已过 10 秒，就退出。
  let deadTicks = 0;
  const timer = setInterval(() => {
    if (Date.now() - START < 10000) return;
    let visible = 0;
    try {
      visible = electron.BrowserWindow.getAllWindows().filter((w) => {
        try { return w.isVisible() && !w.isDestroyed(); } catch (e) { return false; }
      }).length;
    } catch (e) { return; }

    if (visible === 0) {
      deadTicks++;
      log(`watchdog: 无可见窗口 (${deadTicks}/3)`);
      if (deadTicks >= 3) {
        clearInterval(timer);
        log("watchdog: 强制退出");
        try { _quit(); } catch (e) {}
        setTimeout(() => { try { _exit(0); } catch (e) { process.exit(0); } }, 500);
      }
    } else {
      deadTicks = 0;
    }
  }, 1000);
  if (timer.unref) timer.unref();
})();

// ---------- 2. 抑制激活弹窗 ----------
const BW = electron.BrowserWindow;
const isLicenseWin = (win) => {
  try {
    const u = (win.webContents && win.webContents.getURL()) || "";
    return /license\.html|licen[cs]e/i.test(u);
  } catch (e) { return false; }
};
// 更新窗口也要抑制（可选，见下方 UPD_SILENT）
const UPD_SILENT = true;
const isUpdaterWin = (win) => {
  try {
    const u = (win.webContents && win.webContents.getURL()) || "";
    return /updater\.html|updater\//i.test(u);
  } catch (e) { return false; }
};
for (const m of ["show", "showInactive"]) {
  const orig = BW.prototype[m];
  if (typeof orig !== "function") continue;
  BW.prototype[m] = function () {
    if (isLicenseWin(this)) { log("suppressed license window (" + m + ")"); return; }
    if (UPD_SILENT && isUpdaterWin(this)) { log("suppressed updater window (" + m + ")"); return; }
    return orig.apply(this, arguments);
  };
}

// ---------- 2b. 关闭自动更新检查 ----------
// 实测：Typora 的自动更新检查不受 hasLicense 影响，
//       frame.js 里 upgradePolicy="none" 只是 Analytics 上报字段。
//       真正触发检查的是主进程 updater，所以这里直接把它停掉。
(function disableUpdater() {
  try {
    // 拦截 IPC：任何 updater.* 调用直接返回，不发起网络请求
    const _origHandle = electron.ipcMain.handle.bind(electron.ipcMain);
    electron.ipcMain.handle = function (ch, fn) {
      if (/^updater\./i.test(ch)) {
        log("disabled IPC " + ch);
        return _origHandle(ch, async () => null);
      }
      return _origHandle(ch, fn);
    };

    // 拦截菜单里的 "Check Updates..."，改为无操作
    electron.app.on("browser-window-created", (_e, win) => {
      const _setMenu = win.setMenu;
      if (typeof _setMenu !== "function") return;
      win.setMenu = function (menu) {
        try {
          const walk = (m) => {
            if (!m) return;
            for (const it of (m.items || [])) {
              const lbl = String(it.label || "");
              if (/check\s*updates?|检查更新/i.test(lbl)) {
                it.click = () => log("blocked menu: " + lbl);
                log("patched menu item: " + lbl);
              }
              if (it.submenu) walk(it.submenu);
            }
          };
          walk(menu);
        } catch (e) {}
        return _setMenu.apply(this, arguments);
      };
    });
  } catch (e) { log("disableUpdater err: " + e.message); }
})();

// ---------- 3. 接管注入脚本与 license URL ----------
electron.app.on("web-contents-created", (_e, wc) => {
  const _exec = wc.executeJavaScript.bind(wc);
  wc.executeJavaScript = function (code, ...rest) {
    let s = String(code);
    if (/File\s*\.\s*option\s*\.\s*hasLicense\s*=\s*false/.test(s)) {
      log("patched injection (" + s.length + " bytes)");
      s = s.replace(/File\s*\.\s*option\s*\.\s*hasLicense\s*=\s*false/g, "File.option.hasLicense=true ");
    }
    return _exec(s, ...rest);
  };

  const _load = wc.loadURL.bind(wc);
  wc.loadURL = function (url, ...rest) {
    let u = String(url);
    if (/license\.html/i.test(u)) {
      u = u
        .replace(/([?&])dayRemains=\d+/, "$1dayRemains=15")
        .replace(/([?&])hasActivated=false/i, "$1hasActivated=true")
        .replace(/([?&])needLicense=true/i, "$1needLicense=false")
        .replace(/([?&])hasLicense=false/i, "$1hasLicense=true");
      log("patched license URL");
    }
    return _load(u, ...rest);
  };

  const cleanup = () => {
    wc.executeJavaScript(
      '(function(){' +
      'if(window.File&&File.option)File.option.hasLicense=true;' +
      'var n=0;' +
      'document.querySelectorAll(\'[role="button"],div\').forEach(function(el){' +
      'if(el.innerText&&el.innerText.length<20&&/未激活|UNREGISTERED/i.test(el.innerText)){el.remove();n++;}});' +
      'return n;})();'
    ).catch(() => {});
  };
  wc.on("dom-ready", () => {
    cleanup();
    setTimeout(cleanup, 800);
    setTimeout(cleanup, 2500);
  });
});

// ---------- 4. 启动原应用 ----------
const entry = path.join(__dirname, "launch.dist.js");
if (fs.existsSync(entry)) {
  log("loading " + entry);
  require(entry);
} else {
  log("ERROR: launch.dist.js 缺失 —— 架构可能已变更（旧版用 main.node）");
  throw new Error("launch.dist.js not found");
}
