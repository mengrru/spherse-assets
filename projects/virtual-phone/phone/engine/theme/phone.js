/* 小手机 · 引擎层 JS（所有 App 页面和外壳共用这一份）
 * 三层：引擎（这里）/ 世界包（phone/worlds/<id>/）/ 数据（世界包里的 data/）
 * 集中管理：
 *   1. 世界解析与数据文件路径（FILES 用 getter，按当前世界动态解析）
 *   2. 世界时钟与时间格式化
 *   3. 发给角色的消息契约（prompt.*）—— 与世界的 characters/_通用规则.md 一一对应
 */
(function () {
  "use strict";

  /* ================= 数据文件地图 =================
   * 引擎不写死任何一个世界：路径 = 世界目录 + 固定文件名。
   * 世界 id 先同步取自 URL（外壳会带 ?world=xxx），再由 phone/config.data.json 校正。
   */
  var DEFAULT_WORLD = "linjiang";
  var FILE_NAMES = {
    SHARED: "shared.data.json",     // 公共：profile / worldClock / theme / where / characters / conversations
    CHAT: "chat.data.json",         // 微信：messages
    SMS: "sms.data.json",           // 短信：smsThreads / sms
    BBS: "bbs.data.json",           // 论坛：posts / replies
    MAP: "map.data.json",           // 地图：places / visits
    MOMENTS: "moments.data.json",   // 朋友圈：moments / momentComments
    WALLET: "wallet.data.json",     // 钱包：wallet / transactions
    CAL: "calendar.data.json",      // 日历：events（日子与约定）/ marks（纪念日）
    NOTES: "notes.data.json",       // 备忘录：notes（他随手记的 + 角色留的便签）
    RADIO: "radio.data.json",       // 电台：tracks（歌，页面上传）/ shows（DJ 的节目话）
    ALBUM: "album.data.json"        // 相册：photos（他上传的照片 + 说明）
  };
  var WORLD_ID = (function () {
    try {
      var q = new URLSearchParams(location.search).get("world");
      if (q) return q;
    } catch (e) {}
    return DEFAULT_WORLD;
  })();
  // 世界 id 必须是字符串 —— 万一被写坏（比如 set 把标量变成了对象），退回默认世界，别让路径变成 [object Object]
  function worldIdSafe() {
    return (typeof WORLD_ID === "string" && WORLD_ID) ? WORLD_ID : DEFAULT_WORLD;
  }
  function worldDir() { return "phone/worlds/" + worldIdSafe() + "/"; }
  function worldFile(rel) { return worldDir() + rel; }

  // FILES 用 getter：世界切换或修正 id 之后，取值自动跟着变，调用点一行都不用改
  var FILES = {};
  Object.keys(FILE_NAMES).forEach(function (k) {
    Object.defineProperty(FILES, k, {
      enumerable: true,
      get: function () { return worldDir() + "data/" + FILE_NAMES[k]; }
    });
  });
  function allFiles() {
    return Object.keys(FILE_NAMES).map(function (k) { return FILES[k]; });
  }

  /* ================= 世界包 ================= */
  var WORLD = null;                 // 世界清单（品牌 / App 注册表 / 系统 Agent 名 / 版块名 / 资产）
  var worldReady = null;

  // 绕过 ensureWorld 的裸读，避免递归
  async function rawEntries(file) {
    if (await mode() === "sdk") return await spherse.data.entries({ file: file });
    return await rpc("data.entries", { file: file });
  }
  async function ensureWorld() {
    if (WORLD) return WORLD;
    if (worldReady) return worldReady;
    worldReady = (async function () {
      try {
        var root = await rawEntries("phone/config.data.json");
        // 兼容三种写法：config.world / world 是字符串 / world 被 set 写成了对象
        var w = (root && root.config && root.config.world) || (root && root.world);
        if (typeof w === "string" && w) WORLD_ID = w;
        else if (w && typeof w === "object" && w.id) WORLD_ID = w.id;
        WORLD = await rawEntries(worldFile("world.data.json"));
        WORLD = WORLD || {};
        WORLD.id = WORLD.id || WORLD_ID;
      } catch (e) {
        WORLD = { id: WORLD_ID, name: WORLD_ID, apps: [], systems: {}, boards: {}, brand: {} };
      }
      try { applyTheme(); } catch (e) {}
      return WORLD;
    })();
    return worldReady;
  }
  function getWorld() { return WORLD || { id: WORLD_ID, apps: [], systems: {}, boards: {}, brand: {} }; }
  function appMeta(key) {
    return (getWorld().apps || []).filter(function (a) { return a.key === key; })[0] || null;
  }
  function systemName(key, fallback) {
    var s = getWorld().systems || {};
    return s[key] || fallback || key;
  }
  function boardName(key) {
    var b = getWorld().boards || {};
    return b[key] || key;
  }
  // 货币：不同世界的钱不一样（元 / 加隆……）
  function currency() {
    var c = getWorld().currency || {};
    return {
      symbol: c.symbol || "¥",
      name: c.name || "元",
      quick: c.quick || [5.2, 13.14, 52, 66, 88, 520]
    };
  }
  function pageTitle(key, fallback) {
    var t = getWorld().titles || {};
    var m = appMeta(key);
    return (m && m.title) || t[key] || (m && m.name) || fallback || key;
  }
  // 项目内资源的绝对 URL（世界资产如地图 SVG 用）——靠 phone.js 自己的 script src 反推项目根
  var SELF = (document.currentScript && document.currentScript.src) || "";
  var ROOT_URL = (function () {
    var i = SELF.indexOf("/phone/");
    return i >= 0 ? SELF.slice(0, i + 1) : "";
  })();
  function assetUrl(rel) { return ROOT_URL + worldFile(rel); }

  /* ================= 运行环境：直接用 SDK，还是请外壳代办 =================
   * Spherse 的 SDK 会被注入到嵌套 iframe 里，但它的请求发往 window.parent ——
   * 也就是我们的外壳，没人应答，10 秒后抛 spherse:timeout。
   * 所以「有 SDK」不等于「SDK 能用」，必须跟外壳握一次手才能确定。
   */
  var rpcSeq = 0, rpcWait = {};
  var hostSubs = [];          // 外壳广播的订阅者（fileUpdate 等）
  var MODE = null;            // "sdk"（自己调 SDK）| "rpc"（请外壳代办）

  function hasSdk() { return !!(window.spherse && window.spherse.data); }

  function mode() {
    if (MODE) return Promise.resolve(MODE);

    // 外壳自己：显式声明，不用握手
    if (window.__PHONE_SHELL__) { MODE = "sdk"; return Promise.resolve(MODE); }
    // 独立打开（不在任何 iframe 里）
    if (window.parent === window) { MODE = hasSdk() ? "sdk" : "rpc"; return Promise.resolve(MODE); }
    // 嵌在 iframe 里但连 SDK 都没有 → 只能靠外壳
    if (!hasSdk()) { MODE = "rpc"; return Promise.resolve(MODE); }

    // 剩下这种情况要握手：问一句"上面是外壳吗？"
    return new Promise(function (resolve) {
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true; MODE = "sdk"; resolve(MODE);      // 没人应答 → 当作能自己调
      }, 400);
      hostSubs.push(function (d) {
        if (d.type !== "shellHello" || done) return;
        done = true; clearTimeout(timer); MODE = "rpc"; resolve(MODE);
      });
      post("hello", {});
    });
  }

  function rpc(type, payload, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = "r" + (++rpcSeq);
      rpcWait[id] = { resolve: resolve, reject: reject };
      post(type, Object.assign({ reqId: id }, payload || {}));
      setTimeout(function () {
        if (!rpcWait[id]) return;
        delete rpcWait[id];
        reject(new Error("和手机外壳失联（这个页面可能不是在小手机里打开的）"));
      }, timeoutMs || 15000);
    });
  }
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.ns !== "phone") return;
    if (d.type === "reply") {
      var w = rpcWait[d.reqId];
      if (!w) return;
      delete rpcWait[d.reqId];
      if (d.ok) w.resolve(d.data);
      else w.reject(new Error(d.error || "外壳执行失败"));
      return;
    }
    hostSubs.forEach(function (h) { try { h(d); } catch (err) {} });
  });

  /* ================= 小工具 ================= */
  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function escLines(s) { return esc(s).replace(/\n/g, "<br>"); }
  function money(n) { return (Number(n) || 0).toFixed(2); }
  function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n == null ? lo : n)); }
  function clampAff(a) { return clamp(a, 0, 100); }
  function ledDigits(n) {
    var s = String(n == null ? 0 : n);
    while (s.length < 6) s = "0" + s;
    return s;
  }
  function ledNum(n) { return n; }   // 占位，保留给将来
  function byId(arr, id) { return (arr || []).filter(function (x) { return x.id === id; })[0] || null; }
  function avatarHtml(emoji, color) {
    return '<div class="avatar" style="background:' + esc(color || "#c9d3e6") + '">' + esc(emoji || "🙂") + "</div>";
  }

  /* ================= 世界时钟 ================= */
  var shared = {};                      // 公共数据缓存

  function setShared(s) { shared = s || {}; applyTheme(); }
  function getShared() { return shared; }
  function clockCfg() {
    var w = shared.worldClock || {};
    var ar = Date.parse(w.anchorReal), aw = Date.parse(w.anchorWorld), rate = Number(w.rate);
    if (!isFinite(ar) || !isFinite(aw) || !isFinite(rate) || rate <= 0) return null;
    return { anchorReal: ar, anchorWorld: aw, rate: rate };
  }
  function worldNow() {
    var c = clockCfg();
    if (!c) return new Date();
    return new Date(c.anchorWorld + (Date.now() - c.anchorReal) * c.rate);
  }
  function toWorld(iso) {
    var t = Date.parse(iso);
    if (!isFinite(t)) return null;
    var c = clockCfg();
    if (!c) return new Date(t);
    // 一律线性换算（锚点前后同一套规则）：早年那些"现实年份"的种子时间戳（2025-01-01 之类）
    // 往回推，正好落在本世界的年代里。从前那条"锚点之前按现实时间显示"的分支，
    // 会让同一条时间轴混进 2025 这种别的年份 —— 那才是"时间线乱"的根源。
    return new Date(c.anchorWorld + (t - c.anchorReal) * c.rate);
  }
  function worldDayPart(d) {
    var h = d.getHours();
    if (h < 5) return "凌晨";
    if (h < 8) return "清早";
    if (h < 11) return "上午";
    if (h < 13) return "中午";
    if (h < 17) return "下午";
    if (h < 19) return "傍晚";
    if (h < 23) return "晚上";
    return "深夜";
  }
  function worldFullLabel(d) {
    var w = "日一二三四五六"[d.getDay()];
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 星期" + w + " " + worldDayPart(d) +
      " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function worldLine() {
    var c = clockCfg();
    if (!c) return "（手机里的时间：未设置）";
    return "（手机里的时间：" + worldFullLabel(worldNow()) + (c.rate === 1 ? "" : "，走得比现实快 " + c.rate + " 倍") + "）";
  }
  function worldRateLabel(rate) {
    if (rate === 1) return "实时";
    return rate + "×";
  }
  function worldRateHint(rate) {
    if (rate === 1) return "1 分钟 = 1 分钟";
    if (rate % 1440 === 0) return "1 分钟 = " + (rate / 1440) + " 天";
    if (rate % 60 === 0) return "1 分钟 = " + (rate / 60) + " 小时";
    return "1 分钟 = " + rate + " 分钟";
  }
  function timeOf(iso) {
    var d = toWorld(iso);
    return !d || isNaN(d.getTime()) ? "" : pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function dateLabel() {
    var d = worldNow(), w = "日一二三四五六"[d.getDay()];
    return d.getMonth() + 1 + "月" + d.getDate() + "日 星期" + w;
  }
  function greeting() {
    var h = worldNow().getHours();
    if (h < 5) return "凌晨好";
    if (h < 8) return "早上好";
    if (h < 11) return "上午好";
    if (h < 13) return "中午好";
    if (h < 17) return "下午好";
    if (h < 19) return "傍晚好";
    if (h < 23) return "晚上好";
    return "夜深了";
  }
  function fmtAgo(iso) {
    var d = toWorld(iso);
    if (!d || isNaN(d.getTime())) return "";
    var now = worldNow();
    var diff = now.getTime() - d.getTime();
    if (diff < 60000) return "刚刚";
    if (diff < 3600000) return Math.floor(diff / 60000) + " 分钟前";
    if (d.toDateString() === now.toDateString()) return "今天 " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (d.toDateString() === new Date(now.getTime() - 86400000).toDateString()) {
      return "昨天 " + pad(d.getHours()) + ":" + pad(d.getMinutes());
    }
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function fmtDateTime(iso) {
    var d = toWorld(iso);
    if (!d || isNaN(d.getTime())) return "—";
    return (d.getMonth() + 1) + "月" + d.getDate() + "日 " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function daysSince(iso) {
    var d = toWorld(iso);
    if (!d || isNaN(d.getTime())) return null;
    return Math.max(1, Math.floor((worldNow().getTime() - d.getTime()) / 86400000) + 1);
  }

  /* ================= 好感度 ================= */
  function affinitySegs(aff, count) {
    var a = clampAff(aff);
    var filled = Math.round((a / 100) * count);
    var cls = a >= 75 ? "hot" : "on";
    var out = "";
    for (var i = 0; i < count; i++) out += '<i class="' + (i < filled ? cls : "") + '"></i>';
    return out;
  }
  function affectionLevel(a) {
    a = clampAff(a);
    if (a >= 95) return "自己人";
    if (a >= 80) return "老朋友";
    if (a >= 60) return "聊得来";
    if (a >= 40) return "熟人";
    if (a >= 20) return "眼熟";
    return "刚认识";
  }

  /* ================= 外观：两个正交的维度 =================
   * 配色（theme）：颜色、滤镜、壁纸、底色          → themes.css
   * 设计语言（skin）：描边、投影、圆角、字体、密度   → skins.css
   * 由 applyTheme() 一起写到 <html data-theme data-skin> 上，两者可任意组合。
   * 默认值不在这里 —— 由世界包的 brand.defaultTheme 声明（见 defaultLook）。
   */
  var THEMES = [
    { id: "y2k", name: "千禧铬", hint: "铬金属 · 镭射彩虹 · 像素星星", dots: ["#ff4fd8", "#38e8ff", "#c6ff45"] },
    { id: "vapor", name: "蒸汽紫", hint: "霓虹渐变 · 网格地平线", dots: ["#7b3cff", "#ff6ad5", "#2de2e6"] },
    { id: "paper", name: "纸感", hint: "米白纸纹，安静", dots: ["#fdfaf3", "#e8ded0", "#3a3226"] },
    { id: "grimoire", name: "魔典", hint: "夜蓝星空 · 烛火金 · 金色星屑", dots: ["#101a33", "#ffcf72", "#f5eeda"] }
  ];
  var SKINS = [
    { id: "chunky", name: "描边贴纸", hint: "粗描边 + 硬投影 + 斜体标题（默认）", dots: ["#1a1420", "#ffffff", "#ff4fd8"] },
    { id: "flat", name: "扁平", hint: "无描边，柔和投影，正体字", dots: ["#e8ecf4", "#8a94a6", "#2b3446"] },
    { id: "tome", name: "手抄本", hint: "衬线标题 · 墨线细框 · 纸页横格", dots: ["#f5eeda", "#4a3620", "#ffcf72"] }
  ];
  function pick(list, id, fallback) { return list.filter(function (x) { return x.id === id; })[0] || fallback; }
  function themeById(id) { return pick(THEMES, id, THEMES[0]); }
  function skinById(id) { return pick(SKINS, id, SKINS[0]); }

  // 世界包声明的默认外观（world.data.json 的 brand.defaultTheme）—— 这个世界的"出厂长相"。
  // 两种写法都认：字符串 = 只指定配色；对象 = { id, skin }。
  function defaultLook() {
    var d = (getWorld().brand || {}).defaultTheme;
    if (typeof d === "string") return { id: d, skin: "" };
    if (d && typeof d === "object") return { id: d.id || "", skin: d.skin || "" };
    return { id: "", skin: "" };
  }
  // 解析顺序：①用户在主题商店挑的（公共数据的 theme，世界各存一份）
  //           → ②世界包声明的默认 → ③引擎兜底 y2k/chunky
  // 都经 themeById / skinById 归一：数据里残留的旧 id（那套配色已被删）会自动回落到默认值。
  function themeId() {
    return themeById((shared.theme && shared.theme.id) || defaultLook().id || "y2k").id;
  }
  function skinId() {
    return skinById((shared.theme && shared.theme.skin) || defaultLook().skin || "chunky").id;
  }
  function applyTheme() {
    try {
      var root = document.documentElement;
      root.setAttribute("data-theme", themeId());
      root.setAttribute("data-skin", skinId());
    } catch (e) {}
  }
  async function setTheme(id) {
    var t = Object.assign({}, shared.theme || {}, { id: themeById(id).id, updatedAt: new Date().toISOString() });
    shared.theme = t;
    applyTheme();                       // 立刻生效，不用等文件回写
    await mutate(FILES.SHARED, "setTheme", { id: t.id, updatedAt: t.updatedAt });
  }
  async function setSkin(id) {
    var t = Object.assign({}, shared.theme || {}, { skin: skinById(id).id, updatedAt: new Date().toISOString() });
    shared.theme = t;
    applyTheme();
    await mutate(FILES.SHARED, "setTheme", { skin: t.skin, updatedAt: t.updatedAt });
  }

  /* ================= 数据读写 ================= */
  // 路径自愈：万一调用方在 ensureWorld() 之前就取过 FILES（拿到的是默认世界），这里纠回来
  function fixPath(file) {
    if (!file) return file;
    var s = String(file);
    if (s.indexOf("phone/worlds/") !== 0) return s;
    return s.replace(/^phone\/worlds\/[^/]+\//, worldDir());
  }
  async function entries(file) {
    await ensureWorld();
    file = fixPath(file);
    if (await mode() === "sdk") return await spherse.data.entries({ file: file });
    return await rpc("data.entries", { file: file });
  }
  async function loadShared() {
    var s = await entries(FILES.SHARED);
    setShared(s);
    return s;
  }
  async function mutate(file, name, args, idempotencyKey) {
    await ensureWorld();
    file = fixPath(file);
    if (await mode() === "sdk") {
      return await spherse.data.mutate({ file: file, name: name, args: args, idempotencyKey: idempotencyKey });
    }
    return await rpc("data.mutate", { file: file, name: name, args: args, idempotencyKey: idempotencyKey });
  }
  async function dataSet(file, key, value) {
    await ensureWorld();
    file = fixPath(file);
    if (await mode() === "sdk") return await spherse.data.set({ file: file, key: key, value: value });
    return await rpc("data.set", { file: file, key: key, value: value });
  }
  /* 上传文件到项目目录（SDK 的 uploadFile）。参数：
   *   { data: File|Blob, name?: string, dirPath?: string }  —— dirPath 是**项目根相对**路径，且必须已存在
   * 返回 { path, bytes, renamed }，path 是项目根相对路径。
   * 注意：外挂 iframe 里调不到 SDK，所以走外壳代办；Blob/File 可以通过 postMessage 结构化克隆送过去。
   * 上传走 SDK 的 spherse.uploadFile：**哪端都能用**（旧文档曾写"仅 desktop"，2026-10 已经取消这条限制）。
   * 约束：dirPath 必须**已存在**（不自动建目录）、扩展名有白名单、单文件上限 100MB、同名自动改名。 */
     /* 用「文件预览」打开项目里的某个文件 —— 给诊断工具页用（比如 _archive/js-check.html）。
      SDK 的 openFile 是 fire-and-forget；页面里没 SDK 时请外壳转发。 */
   async function openProjectFile(path) {
     if (await mode() === "sdk") {
       try { spherse.openFile(path); } catch (e) {}
       return;
     }
     await rpc("openFile", { path: path });
   }

   /* 列出世界目录 assets/ 下的文件。**只读** —— 所以它是"上传"的备用入口：
      不能写入的宿主（实测：web 端上传会 reject forbidden）上，让别人把文件放进项目，
      用户再用「从项目里挑」把它选进来。相册与电台共用这个 helper。
      kinds: "image" | "audio" */
   var ASSET_EXT = {
     image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"],
     audio: ["mp3", "wav", "ogg", "m4a", "flac", "aac", "opus"]
   };
   async function listWorldAssets(kinds) {
     var exts = ASSET_EXT[kinds] || ASSET_EXT.image;
     var list = await rpc("content.listDir", { path: worldDir() + "assets" });
     return (list || []).filter(function (f) {
       if (!f || f.type !== "file") return false;
       return exts.indexOf(String(f.name || "").split(".").pop().toLowerCase()) >= 0;
     }).map(function (f) {
       return { name: f.name, src: "assets/" + f.name };   // src = 世界目录内的相对路径
     }).sort(function (a, b) { return String(b.name).localeCompare(String(a.name)); });
   }

   async function uploadFile(params) {
    await ensureWorld();
    var args = { data: params.data, name: params.name, dirPath: params.dirPath };
    if (await mode() === "sdk") return await spherse.uploadFile(args);
    try {
      return await rpc("content.upload", args, 90000);   // 大文件慢，给 90 秒
    } catch (e) {
      var m = String((e && e.message) || e);
      // rpc 超时的话给一句人话，别说成"跟外壳失联"
      if (m.indexOf("失联") >= 0) throw new Error("上传超时：网络太慢或文件太大（等了 90 秒）");
      throw e;
    }
  }
  function onFileUpdate(files, handler) {
    var list = [].concat(files);
    var offs = [];
    var sub = null;
    mode().then(function (m) {
      if (m === "sdk") {
        list.forEach(function (f) { offs.push(spherse.events.on("file:update", { path: f }, handler)); });
      } else {
        sub = function (d) { if (d.type === "fileUpdate" && list.indexOf(d.path) >= 0) handler(d); };
        hostSubs.push(sub);
      }
    });
    return function () {
      offs.forEach(function (off) { try { off(); } catch (e) {} });
      if (sub) {
        var i = hostSubs.indexOf(sub);
        if (i >= 0) hostSubs.splice(i, 1);
      }
    };
  }
  function toast(params) {
    mode().then(function (m) {
      if (m === "sdk") { spherse.toast(params); return; }
      rpc("toast", { params: params }, 4000).catch(function () {});
    });
  }
  // 出错了就把原因画在页面上，别留一片白
  function fatal(e) {
    var msg = String((e && e.message) || e || "未知错误");
    var box = document.getElementById("fatal-box");
    if (!box) {
      box = document.createElement("div");
      box.id = "fatal-box";
      box.className = "errbox";
      box.style.margin = "86px 16px 0";
      document.body.appendChild(box);
    }
    box.innerHTML = "<b>页面没读到数据</b><br>" + esc(msg) +
      "<br><br>· 这个页面要在小手机里打开（外壳负责提供数据）<br>" +
      "· 或者检查 phone/worlds/ 下这个世界的数据文件是否存在";
  }

  /* ================= 角色与会话 ================= */
  function characters() { return shared.characters || []; }
  function charById(id) { return byId(characters(), id); }
  function conversations() { return shared.conversations || []; }
  function convOfChar(charId) {
    return conversations().filter(function (c) { return c.characterId === charId; })[0] || null;
  }
  function charOfConv(conv) {
    return conv ? charById(conv.characterId) : null;
  }
  function myName() { return (shared.profile && shared.profile.displayName) || "我"; }
  function activeCharacter() {
    var best = null, bestT = "";
    characters().forEach(function (c) {
      var conv = convOfChar(c.id);
      var t = conv && conv.lastActiveAt ? String(conv.lastActiveAt) : "";
      if (!best || t > bestT) { best = c; bestT = t; }
    });
    return best;
  }

  // 找到（必要时新建）某个角色的会话，返回 { conv, sessionId }
  async function ensureAgentSession(char) {
    if (await mode() === "rpc") {
      var r = await rpc("session.ensure", { characterId: char.id });
      if (r && r.conv) {
        var list = shared.conversations || (shared.conversations = []);
        if (!byId(list, r.conv.id)) list.push(r.conv);
      }
      return { conv: r.conv, sessionId: r.sessionId };
    }
    var conv = convOfChar(char.id);
    if (!conv) {
      conv = await mutate(FILES.SHARED, "createConversation", { characterId: char.id, title: char.name });
      (shared.conversations = shared.conversations || []).push(conv);
    }
    if (conv.sessionId) return { conv: conv, sessionId: conv.sessionId };

    var slug = char.agentSlug;
    if (!slug) {
      try {
        var agents = await spherse.api.agents.list();
        var hit = (agents || []).filter(function (a) { return a.name === char.name; })[0];
        if (hit) slug = hit.slug || hit.id;
      } catch (e) { /* 忽略，下面兜底报错 */ }
    }
    if (!slug) throw new Error("找不到「" + char.name + "」对应的 Agent");

    var res = await spherse.createSession({ agentSlug: slug, open: false, name: "和 " + char.name + " 的聊天" });
    var sessionId = res && res.sessionId;
    if (!sessionId) throw new Error("会话创建失败");
    await mutate(FILES.SHARED, "setConversationSession", {
      id: conv.id, sessionId: sessionId, lastActiveAt: new Date().toISOString()
    });
    conv.sessionId = sessionId;
    return { conv: conv, sessionId: sessionId };
  }

  // 静默把一条消息交给角色；返回 true 表示已送达
  async function notify(char, message) {
    try {
      if (await mode() === "rpc") {
        await rpc("session.notify", { characterId: char.id, message: message });
        return true;
      }
      var ctx = await ensureAgentSession(char);
      await spherse.sendMessage({ sessionId: ctx.sessionId, message: message, open: false });
      return true;
    } catch (e) {
      var msg = String((e && e.message) || e);
      if (msg.indexOf("session_busy") >= 0) {
        toast({ variant: "warning", message: char.name + " 正在忙", description: "稍后再试" });
      } else {
        toast({ variant: "error", message: "没能通知 " + char.name, description: msg });
      }
      return false;
    }
  }

  /* ================= 系统 Agent（不属于任何好友的 Agent） =================
   * 比如「短信局」「临江论坛」：一个 Agent 管一类事，共用一个会话。
   * 名字来自世界包（world.data.json 的 systems），引擎不写死。
   * 会话 id 存在各自 App 的数据文件里（短信存在 sms.data.json 的 agent.sessionId）。
   */
  var SYSTEM_AGENTS = {};
  Object.keys({ sms: 1, bbs: 1 }).forEach(function (k) {
    Object.defineProperty(SYSTEM_AGENTS, k, {
      enumerable: true,
      get: function () { return systemName(k, "系统 Agent · " + k); }
    });
  });

  async function createSystemSession(name, sessionName) {
    if (await mode() === "sdk") {
      var agents = await spherse.api.agents.list();
      var hit = (agents || []).filter(function (a) { return a.name === name; })[0];
      if (!hit) throw new Error("找不到「" + name + "」这个 Agent");
      var res = await spherse.createSession({ agentSlug: hit.slug || hit.id, open: false, name: sessionName || name });
      if (!res || !res.sessionId) throw new Error("会话创建失败");
      return res.sessionId;
    }
    var r = await rpc("agent.session", { name: name, sessionName: sessionName || name });
    return r && r.sessionId;
  }
  async function sendSession(sessionId, message) {
    if (await mode() === "sdk") return await spherse.sendMessage({ sessionId: sessionId, message: message, open: false });
    return await rpc("session.send", { sessionId: sessionId, message: message });
  }

  /* ================= 未读 =================
   * idKey / isIncoming 可换：微信按 conversationId + role，短信按 threadId + role。
   * 会话 id 和短信会话 id 不会重名，所以共用 profile.lastSeen 一张表。
   */
  var CHAT_IN = function (m) { return m.role === "character"; };
  function seenTsOf(id) {
    var seen = (shared.profile && shared.profile.lastSeen && shared.profile.lastSeen[id]) || "";
    return Date.parse(seen) || 0;
  }
  function unreadOf(id, items, idKey, isIncoming) {
    idKey = idKey || "conversationId";
    isIncoming = isIncoming || CHAT_IN;
    var seenTs = seenTsOf(id);
    return (items || []).filter(function (m) {
      return m[idKey] === id && isIncoming(m) && (Date.parse(m.createdAt) || 0) > seenTs;
    }).length;
  }
  function totalUnread(messages) {
    return conversations().reduce(function (n, c) { return n + unreadOf(c.id, messages); }, 0);
  }
  function totalUnreadSms(threads, sms) {
    return (threads || []).reduce(function (n, t) { return n + unreadOf(t.id, sms, "threadId", CHAT_IN); }, 0);
  }
  async function markSeen(id, items, idKey, isIncoming) {
    if (!id) return;
    if (unreadOf(id, items, idKey, isIncoming) === 0) return;   // 防抖，也防写回环
    var seen = Object.assign({}, (shared.profile && shared.profile.lastSeen) || {});
    seen[id] = new Date().toISOString();
    var profile = Object.assign({}, shared.profile, { lastSeen: seen });
    shared.profile = profile;
    try { await dataSet(FILES.SHARED, "profile", profile); } catch (e) {}
  }
  // 第一次引入未读时的基线：把现有消息都当已读
  async function ensureSeenBaseline() {
    if (shared.profile && shared.profile.lastSeen) return;
    await loadShared();
    if (shared.profile && shared.profile.lastSeen) return;
    var seen = {}, nowIso = new Date().toISOString();
    conversations().forEach(function (c) { seen[c.id] = nowIso; });
    var profile = Object.assign({}, shared.profile, { lastSeen: seen });
    shared.profile = profile;
    try { await dataSet(FILES.SHARED, "profile", profile); } catch (e) {}
  }

  /* ================= 发给角色的消息契约 =================
   * 契约的另一端在世界包里的角色通用规则（worlds/<id>/characters/_通用规则.md）。
   * 每条消息都带上「数据文件：…」—— 所以规则文档不用写死路径，换世界不用改文档。
   */
  function dataLine(list) {
    return "（数据文件：" + list.map(function (f) { return fixPath(f); }).join(" / ") + "）";
  }
  function statusBlock(ch) {
    return "（你当前的状态：好感度 " + clampAff(ch.affection) + "，心情 " + (ch.mood || "未知") +
      "，正在做 " + (ch.doing || "未知") + "）\n" +
      "（你现在在：" + (ch.placeName || "不清楚") + "）\n" +
      whereLine() + "\n" + worldLine();
  }
  // 手机主人现在在哪 —— 「你在哪」存在公共数据里，所以每条消息都能带上
  function whereLine() {
    var w = shared.where || {};
    if (!w.placeName) return "（他现在在：不清楚）";
    return "（他现在在：" + w.placeName + "）";
  }
  var prompt = {
    chat: function (ch, conv, text) {
      return "【手机消息】" + myName() + "：「" + text + "」\n" +
        "（conversationId=" + conv.id + "）\n" +
        "（你的档案 id=" + ch.id + "）\n" +
        statusBlock(ch) + "\n" +
        dataLine([FILES.CHAT, FILES.CAL, FILES.NOTES, FILES.ALBUM, FILES.SHARED]) + "\n\n" +
        "请按《小手机 · 角色通用规则》处理这条消息。";
    },
    poke: function (ch, conv) {
      return "【叮咚】" + myName() + "戳了你一下，没有留言。\n" +
        "（conversationId=" + conv.id + "）\n" +
        "（你的档案 id=" + ch.id + "）\n" +
        statusBlock(ch) + "\n" +
        dataLine([FILES.CHAT, FILES.CAL, FILES.NOTES, FILES.ALBUM, FILES.SHARED]) + "\n\n" +
        "请按《小手机 · 角色通用规则》处理。";
    },
    momentNew: function (ch, moment, authorName) {
      return "【朋友圈】" + authorName + "刚发了一条新动态：\n「" + moment.text + "」\n" +
        "（momentId=" + moment.id + "）\n" +
        "（你的档案 id=" + ch.id + "）\n" +
        worldLine() + "\n" +
        dataLine([FILES.MOMENTS, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "请按《小手机 · 角色通用规则》处理：看不看、点不点赞、评不评论，都由你自己决定。";
    },
    momentComment: function (ch, moment, authorName, commentText) {
      return "【朋友圈】" + authorName + "在你的动态下面评论了：\n" +
        "你的动态：「" + moment.text + "」\n" +
        "（momentId=" + moment.id + "）\n" +
        "ta 的评论：「" + commentText + "」\n" +
        "（你的档案 id=" + ch.id + "）\n" +
        worldLine() + "\n" +
        dataLine([FILES.MOMENTS, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "请按《小手机 · 角色通用规则》处理。";
    },
    momentRefresh: function (ch) {
      return "【朋友圈】" + worldLine() + "。\n" +
        "（你的档案 id=" + ch.id + "）\n" +
        dataLine([FILES.MOMENTS, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "请按《小手机 · 角色通用规则》处理：想不想发一条新动态，或者去看看 " + myName() + " 的动态。";
    },
    wallet: function (ch, tx) {
      return "【钱包】" + myName() + (tx.kind === "redPacket" ? "给你包了一份" : "给你转了") + " " +
        money(tx.amount) + " " + currency().name + (tx.note ? "，备注：「" + tx.note + "」" : "，没写备注") + "。\n" +
        "（transactionId=" + tx.id + "）\n" +
        "（你的档案 id=" + ch.id + "）\n" + worldLine() + "\n" +
        dataLine([FILES.WALLET, FILES.CHAT, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "请按《小手机 · 角色通用规则》处理。";
    },
    sms: function (ch, thread, text) {
      return "【短信】" + myName() + "用短信给你发了：「" + text + "」\n" +
        "（短信会话 id=" + thread.id + "）\n" +
        "（你的档案 id=" + ch.id + "）\n" +
        statusBlock(ch) + "\n" +
        dataLine([FILES.SMS, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "请按《小手机 · 角色通用规则》处理 —— 注意这是短信，不是微信。";
    },
    // ---- 系统 Agent 用：一律「按你的行为规则处理」，不在引擎里提世界名 ----
    smsDice: function () {
      return "【掷骰子】" + worldLine() + "。\n" +
        dataLine([FILES.SMS, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "掷一次：现在这部手机外面可能发生了一件小事。想发就按你的行为规则处理；" +
        "觉得世界该安静一会儿，就什么都不做，回一句「不发」。";
    },
    smsReply: function (thread, text) {
      var kindLabel = thread.kind === "system" ? "机构号" : (thread.kind === "unknown" ? "陌生号码" : "好友号码");
      return "【短信】" + myName() + "用短信回了这个号码：\n" +
        "号码：" + thread.name + "（" + (thread.number || "无号码") + "，类型：" + kindLabel + "）\n" +
        "（短信会话 id=" + thread.id + "）\n" +
        "他发的内容：「" + text + "」\n" +
        worldLine() + "\n" +
        dataLine([FILES.SMS, FILES.NOTES, FILES.SHARED]) + "\n\n请按你的行为规则处理。";
    },    bbsRefresh: function () {
      return "【刷新】" + worldLine() + "。\n" +
        dataLine([FILES.BBS, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "刷一下论坛：想动就发一条新帖、或者去回一两层；觉得该安静一会儿就回一句「不发」，什么都不做。\n" +
        "按你的行为规则处理。";
    },
    bbsPost: function (post) {
      return "【论坛】" + myName() + "在「" + boardName(post.board) + "」发了一条新帖：\n" +
        "标题：「" + post.title + "」\n" +
        (post.body ? "正文：「" + post.body + "」\n" : "") +
        "（帖子 id=" + post.id + "）\n" +
        worldLine() + "\n" +
        dataLine([FILES.BBS, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "看看要不要有人回他 —— 1～3 层，用不同的人、不同的口吻；也可以只有一个人回，或者没人理。\n" +
        "按你的行为规则处理。";
    },
    bbsReply: function (post, text, replyAuthor) {
      return "【论坛】" + myName() + "在帖子里回复了一层：\n" +
        "帖子：「" + post.title + "」（帖子 id=" + post.id + "）\n" +
        "他的楼层：「" + text + "」\n" +
        (replyAuthor ? "（他用的昵称：" + replyAuthor + "）\n" : "") +
        worldLine() + "\n" +
        dataLine([FILES.BBS, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "看情况再回一句，或者不理。按你的行为规则处理。";
    },
    // ---- 论坛：有人在「你的」帖子里回了一层（收信人是一位角色，不是留言板上的那群人）----
    bbsNote: function (ch, post, text) {
      return "【论坛】" + myName() + "在你发的帖子里回了一层：\n" +
        "帖子：「" + post.title + "」（board=" + post.board + "，帖子 id=" + post.id + "）\n" +
        "他回的：「" + text + "」\n" +
        "（你的档案 id=" + ch.id + "）\n" +
        worldLine() + "\n" +
        dataLine([FILES.BBS, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "看情况再回一句，或者不理 —— 都由你自己决定。请按《小手机 · 角色通用规则》处理。";
    },
    // ---- 地图：位置变了 ----
    mapMove: function (ch, place) {
      return "【地图】" + myName() + "的位置变了：他刚到了「" + place.name + "」。\n" +
        "（地点 id=" + place.id + "，类型：" + (place.kind || "地点") + "，营业：" + (place.hours || "不详") + "）\n" +
        "（你的档案 id=" + ch.id + "）\n" +
        statusBlock(ch) + "\n" +
        dataLine([FILES.MAP, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "请按《小手机 · 角色通用规则》处理。";
    },
    // ---- 日历：他在日历上替你记了一件事 ----
    calendarNote: function (ch, ev) {
      return "【日历】" + myName() + "在日历上替你记了一件事：\n" +
        ev.date + (ev.time ? " " + ev.time : "（全天）") + "「" + ev.title + "」\n" +
        (ev.note ? "他写的备注：「" + ev.note + "」\n" : "") +
        (ev.repeat === "weekly" ? "（他标了每周重复）\n" : "") +
        "（日历条目 id=" + ev.id + "）\n" +
        "（你的档案 id=" + ch.id + "）\n" +
        statusBlock(ch) + "\n" +
        dataLine([FILES.CAL, FILES.NOTES, FILES.SHARED]) + "\n\n" +
        "这是他替你记下的，不一定等于你答应过 —— 收下、回一句、或者嫌他自作主张，都行。" +
        "请按《小手机 · 角色通用规则》处理。";
    }
  };

  /* ================= 手机主人的称呼 =================
   * 消息模板里为行文方便一律写「他」。世界包可以声明 owner.pronoun（默认「他」），
   * 由下面这个收尾循环统一替换 —— 这样"主人是男是女"就成了**世界级设定**，不用去改模板。
   */
  function ownerPronoun() {
    var o = (getWorld().owner) || {};
    return o.pronoun || "他";
  }
  function fixOwnerPronoun(s) {
    var p = ownerPronoun();
    if (p === "他" || typeof s !== "string") return s;
    return s.split("他").join(p);   // 引擎里「他」只用于指手机主人（没有"其它/他们"），可以整字替换
  }
  Object.keys(prompt).forEach(function (k) {
    var fn = prompt[k];
    if (typeof fn !== "function") return;
    prompt[k] = function () { return fixOwnerPronoun(fn.apply(null, arguments)); };
  });

  /* ================= 与外壳通信 ================= */
  function post(type, payload) {
    var msg = Object.assign({ ns: "phone", type: type }, payload || {});
    if (window.parent && window.parent !== window) {
      try { window.parent.postMessage(msg, "*"); } catch (e) {}
    }
  }
  function navigate(to) {
    if (window.parent && window.parent !== window) post("navigate", { to: to });
    else location.hash = "#/" + to;      // 独立打开（比如在文件浏览器里预览）时退化
  }
  function goHome() { navigate("home"); }
  function onHost(handler) {
    window.addEventListener("message", function (e) {
      var d = e.data;
      if (!d || d.ns !== "phone") return;
      handler(d);
    });
  }
  function params() {
    var out = {};
    try {
      new URLSearchParams(location.search).forEach(function (v, k) { out[k] = v; });
    } catch (e) {}
    return out;
  }
  function bindEscape(fn) {
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      if (fn && fn() === true) return;   // 应用自己处理了（比如关弹层）
      goHome();
    });
  }

  /* ================= 导出 ================= */
  window.phone = {
    FILES: FILES,
    allFiles: allFiles,
    // 世界
    world: getWorld, worldId: function () { return WORLD_ID; }, ensureWorld: ensureWorld,
    appMeta: appMeta, systemName: systemName, boardName: boardName, assetUrl: assetUrl,
    currency: currency, pageTitle: pageTitle,
    // 工具
    $: $, pad: pad, esc: esc, escLines: escLines, money: money, clamp: clamp, clampAff: clampAff,
    ledDigits: ledDigits, byId: byId, avatarHtml: avatarHtml,
    // 世界时钟
    setShared: setShared, shared: getShared, clockCfg: clockCfg, worldNow: worldNow, toWorld: toWorld,
    worldDayPart: worldDayPart, worldFullLabel: worldFullLabel, worldLine: worldLine, whereLine: whereLine,
    worldRateLabel: worldRateLabel, worldRateHint: worldRateHint,
    timeOf: timeOf, dateLabel: dateLabel, greeting: greeting, fmtAgo: fmtAgo, fmtDateTime: fmtDateTime,
    daysSince: daysSince,
    // 好感度
    affinitySegs: affinitySegs, affectionLevel: affectionLevel,
    // 数据
    entries: entries, entriesRaw: rawEntries, loadShared: loadShared, mutate: mutate, dataSet: dataSet,
    uploadFile: uploadFile, listWorldAssets: listWorldAssets, openProjectFile: openProjectFile,
    onFileUpdate: onFileUpdate, toast: toast, fatal: fatal, mode: mode,
    // 外观（配色 × 设计语言）
    THEMES: THEMES, SKINS: SKINS, themeId: themeId, skinId: skinId,
    themeById: themeById, skinById: skinById, setTheme: setTheme, setSkin: setSkin, applyTheme: applyTheme,
    defaultLook: defaultLook,
    // 角色
    characters: characters, charById: charById, conversations: conversations, convOfChar: convOfChar,
    charOfConv: charOfConv, myName: myName, activeCharacter: activeCharacter,
    ensureAgentSession: ensureAgentSession, notify: notify,
    SYSTEM_AGENTS: SYSTEM_AGENTS, createSystemSession: createSystemSession, sendSession: sendSession,
    // 未读
    unreadOf: unreadOf, totalUnread: totalUnread, totalUnreadSms: totalUnreadSms,
    markSeen: markSeen, ensureSeenBaseline: ensureSeenBaseline,
    // 契约
    prompt: prompt,
    // 外壳
    post: post, navigate: navigate, goHome: goHome, onHost: onHost, params: params, bindEscape: bindEscape,
    rpc: rpc
  };

  post("ready");   // 告诉外壳"我加载好了"
})();
