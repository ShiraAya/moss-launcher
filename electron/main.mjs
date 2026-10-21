import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  safeStorage,
} from "electron";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { loaderVersions, installProfile } from "./core/loaders.mjs";
import {
  inspectPack,
  packSummary,
  resolveCurseForge,
  matchManualFiles,
  importPack,
} from "./core/modpacks.mjs";
import { GameManager } from "./core/launcher.mjs";
import { MicrosoftAuth } from "./core/auth.mjs";
import { detectJava, probeJava, installJava } from "./core/java.mjs";
import { atomicJSON, readJSON, offlineUUID, safeId } from "./core/utils.mjs";
const dirname = path.dirname(fileURLToPath(import.meta.url));
if (process.env.MOSS_TEST_HOME)
  app.setPath("userData", process.env.MOSS_TEST_HOME);
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
let win,
  settings,
  auth,
  manager,
  javaList = [],
  running = null,
  controller = null,
  loginController = null,
  progress = null,
  busy = false;
let pendingPack = null;
const logs = [];
let lastEmit = 0;
const emit = (type, data) => {
  if (win && !win.isDestroyed())
    win.webContents.send("moss:event", { type, data });
};
function log(message) {
  const entry = { time: new Date().toISOString(), text: message };
  logs.push(entry);
  if (logs.length > 400) logs.splice(0, logs.length - 400);
  emit("log", entry);
}
function report(data) {
  progress = { ...progress, ...data };
  if (
    Date.now() - lastEmit > 120 ||
    ["complete", "error", "cancelled", "running"].includes(data.phase)
  ) {
    lastEmit = Date.now();
    emit("progress", progress);
  }
}
const dataDir = () => app.getPath("userData");
const runtimeDir = () => path.join(dataDir(), "runtimes");
const settingsFile = () => path.join(dataDir(), "settings.json");
function makeManager() {
  manager = new GameManager(settings.gameDirectory, { emit: report, log });
}
async function state() {
  return {
    settings,
    installed: await manager.installed(),
    java: javaList,
    account: auth.publicAccount(),
    busy,
    running: running ? { id: running.id, pid: running.child.pid } : null,
    progress,
    logs,
    platform: process.platform,
    arch: process.arch,
    totalMemory: Math.floor(os.totalmem() / 1024 / 1024),
    appVersion: app.getVersion(),
  };
}
function guardIdle() {
  if (busy || running)
    throw new Error("请等待当前任务结束或关闭游戏后再操作。");
}
function operation(title, job) {
  guardIdle();
  busy = true;
  controller = new AbortController();
  progress = { phase: "prepare", detail: title, percent: 0 };
  emit("busy", true);
  emit("progress", progress);
  const current = controller;
  Promise.resolve()
    .then(() => job(current.signal))
    .catch((e) => {
      const cancelled = current.signal.aborted;
      report({
        phase: cancelled ? "cancelled" : "error",
        detail: cancelled
          ? "任务已取消。已校验的文件会保留，下次安装可继续。"
          : e.message,
        percent: progress?.percent || 0,
      });
      log(cancelled ? "任务已取消" : e.message);
    })
    .finally(async () => {
      busy = false;
      controller = null;
      emit("busy", false);
      emit("installed", await manager.installed());
    });
  return { started: true };
}
function handle(name, fn) {
  ipcMain.handle("moss:" + name, async (event, ...args) => {
    if (
      !win ||
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("未授权的调用");
    return fn(...args);
  });
}
async function persist(next) {
  await atomicJSON(settingsFile(), next);
  settings = next;
  emit("settings", settings);
  return settings;
}
async function ensureJava(major, signal) {
  let java;
  if (settings.javaPath) {
    java = await probeJava(settings.javaPath);
    if (!java || java.major !== major || java.arch !== process.arch)
      throw new Error(
        `该版本需要 ${process.arch} 的 Java ${major}，请在设置中选择自动管理或正确的 Java。`,
      );
  } else {
    java = javaList.find((j) => j.major === major && j.arch === process.arch);
    if (!java) {
      java = await installJava(major, runtimeDir(), { signal, emit: report });
      javaList = await detectJava(runtimeDir());
      emit("java", javaList);
    }
  }
  return java;
}
function currentPack(token) {
  if (!pendingPack || token !== pendingPack.token)
    throw new Error("整合包预览已失效，请重新选择 ZIP。");
  return pendingPack.pack;
}
function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 1050,
    minHeight: 740,
    show: false,
    title: "苔原 Moss",
    backgroundColor: "#101311",
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 22, y: 20 },
    webPreferences: {
      preload: path.join(dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _p, cb) =>
    cb(false),
  );
  win.once("ready-to-show", () => win.show());
  win.on("close", (e) => {
    if (busy || running || loginController) {
      e.preventDefault();
      win.hide();
    }
  });
  if (process.env.MOSS_DEV_URL && !app.isPackaged)
    win.loadURL(process.env.MOSS_DEV_URL);
  else win.loadFile(path.join(dirname, "../dist/index.html"));
}
if (locked)
  app.whenReady().then(async () => {
    const defaults = {
      source: "official",
      gameDirectory: path.join(dataDir(), "game"),
      javaPath: "",
      memoryMB: 4096,
      macCompatibility: true,
      playerName: "Player",
      accountMode: "offline",
      microsoftClientId: "",
      selectedVersion: "",
    };
    settings = { ...defaults, ...(await readJSON(settingsFile(), {})) };
    makeManager();
    auth = new MicrosoftAuth(
      path.join(dataDir(), "account.enc.json"),
      safeStorage,
    );
    await auth.restore();
    javaList = await detectJava(runtimeDir(), settings.javaPath);
    handle("state", state);
    handle("manifest", () => manager.manifest(settings.source));
    handle("saveSettings", async (patch) => {
      guardIdle();
      if (!patch || typeof patch !== "object") throw new Error("设置格式无效");
      const next = { ...settings };
      if ("source" in patch) {
        if (!["official", "bmclapi"].includes(patch.source))
          throw new Error("未知下载源");
        next.source = patch.source;
      }
      if ("macCompatibility" in patch) {
        if (typeof patch.macCompatibility !== "boolean")
          throw new Error("图形兼容设置无效");
        next.macCompatibility = patch.macCompatibility;
      }
      if ("memoryMB" in patch) {
        if (
          !Number.isInteger(patch.memoryMB) ||
          patch.memoryMB < 1024 ||
          patch.memoryMB >
            Math.min(32768, Math.floor(os.totalmem() / 1024 / 1024))
        )
          throw new Error("内存应在 1024 MB 和可用物理内存之间");
        next.memoryMB = patch.memoryMB;
      }
      if ("playerName" in patch) {
        if (!/^[A-Za-z0-9_]{3,16}$/.test(patch.playerName))
          throw new Error("角色名需为 3–16 位英文字母、数字或下划线");
        next.playerName = patch.playerName;
      }
      if ("microsoftClientId" in patch) {
        if (
          patch.microsoftClientId !== "" &&
          !/^[a-f0-9-]{36}$/i.test(patch.microsoftClientId)
        )
          throw new Error("Client ID 格式错误");
        next.microsoftClientId = patch.microsoftClientId;
      }
      if ("accountMode" in patch) {
        if (!["offline", "microsoft"].includes(patch.accountMode))
          throw new Error("无效的账户类型");
        if (patch.accountMode === "microsoft" && !auth.publicAccount())
          throw new Error("请先登录微软账户");
        next.accountMode = patch.accountMode;
      }
      if ("selectedVersion" in patch)
        next.selectedVersion = patch.selectedVersion
          ? safeId(patch.selectedVersion)
          : "";
      if ("javaPath" in patch) {
        if (
          patch.javaPath !== "" &&
          !javaList.some((j) => j.path === patch.javaPath)
        )
          throw new Error("请通过文件选择器指定 Java");
        next.javaPath = patch.javaPath;
      }
      return persist(next);
    });
    handle("pickDirectory", async () => {
      guardIdle();
      const result = await dialog.showOpenDialog(win, {
        title: "选择游戏存储目录",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) return null;
      guardIdle();
      await fs.access(result.filePaths[0], fs.constants.W_OK);
      await persist({
        ...settings,
        gameDirectory: result.filePaths[0],
        selectedVersion: "",
      });
      makeManager();
      pendingPack = null;
      emit("installed", await manager.installed());
      return settings.gameDirectory;
    });
    handle("pickJava", async () => {
      guardIdle();
      const result = await dialog.showOpenDialog(win, {
        title: "选择 Java 可执行文件（bin/java 或 java.exe）",
        properties: ["openFile"],
      });
      if (result.canceled) return null;
      const java = await probeJava(result.filePaths[0]);
      if (!java) throw new Error("该文件不是可用的 Java 可执行程序");
      guardIdle();
      javaList = [java, ...javaList.filter((j) => j.path !== java.path)];
      await persist({ ...settings, javaPath: java.path });
      emit("java", javaList);
      return java;
    });
    handle("detectJava", async () => {
      javaList = await detectJava(runtimeDir(), settings.javaPath);
      emit("java", javaList);
      return javaList;
    });
    handle("loaderVersions", (minecraft, loader) =>
      loaderVersions(minecraft, loader, { source: settings.source }),
    );
    handle("install", (request) => {
      const input =
        typeof request === "string"
          ? { minecraft: request, loader: "vanilla" }
          : request;
      return operation("准备安装 Minecraft", async (signal) => {
        const record = await installProfile(manager, input, {
          source: settings.source,
          signal,
          ensureJava,
        });
        await persist({ ...settings, selectedVersion: record.id });
      });
    });
    handle("repair", (id) =>
      operation("校验并修复游戏文件", async (signal) => {
        const record = (await manager.installed()).find(
          (v) => v.id === safeId(id),
        );
        if (!record) throw new Error("找不到已安装版本");
        await installProfile(
          manager,
          {
            ...record,
            minecraft: record.minecraft || record.id,
            loader: record.loader || "vanilla",
          },
          { source: settings.source, signal, ensureJava },
        );
      }),
    );
    handle("pickPack", async () => {
      guardIdle();
      const result = await dialog.showOpenDialog(win, {
        title: "导入客户端整合包",
        properties: ["openFile"],
        filters: [{ name: "Minecraft 整合包", extensions: ["zip", "mrpack"] }],
      });
      if (result.canceled) return null;
      guardIdle();
      const pack = await inspectPack(result.filePaths[0]);
      guardIdle();
      pendingPack = { token: randomUUID(), pack };
      return packSummary(pack, pendingPack.token);
    });
    handle("resolvePack", async (token, key) => {
      guardIdle();
      const resolved = await resolveCurseForge(currentPack(token), key);
      guardIdle();
      currentPack(token);
      pendingPack.pack = resolved;
      return packSummary(resolved, token);
    });
    handle("pickPackFiles", async (token) => {
      guardIdle();
      const pack = currentPack(token);
      const result = await dialog.showOpenDialog(win, {
        title: "选择从 CurseForge 手动下载的模组文件",
        properties: ["openFile", "multiSelections"],
      });
      if (result.canceled) return null;
      const matched = await matchManualFiles(pack, result.filePaths);
      guardIdle();
      currentPack(token);
      pendingPack.pack = matched;
      return { matched: Object.keys(matched.localFiles).length };
    });
    handle("openPackLink", (token, index) => {
      const file = currentPack(token).downloadable.filter((f) => f.manual)[
        index
      ];
      if (!file?.page || new URL(file.page).hostname !== "www.curseforge.com")
        throw new Error("下载链接无效");
      return shell.openExternal(file.page);
    });
    handle("importPack", (token, options) => {
      const pack = currentPack(token);
      return operation("导入整合包", async (signal) => {
        const record = await importPack(manager, pack, options, {
          source: settings.source,
          signal,
          ensureJava,
        });
        await persist({ ...settings, selectedVersion: record.id });
        if (pendingPack?.token === token) pendingPack = null;
      });
    });
    handle("installJava", (major) => {
      if (![8, 17, 21, 25].includes(major))
        throw new Error("不支持的 Java 版本");
      return operation("安装 Java", async (signal) => {
        await installJava(major, runtimeDir(), { signal, emit: report });
        javaList = await detectJava(runtimeDir(), settings.javaPath);
        emit("java", javaList);
        report({
          phase: "complete",
          detail: `Java ${major} 已就绪`,
          percent: 100,
        });
      });
    });
    handle("launch", (id) => {
      safeId(id);
      return operation("准备启动 Minecraft " + id, async (signal) => {
        const installed = (await manager.installed()).find((v) => v.id === id);
        if (!installed) throw new Error("请先下载并安装该版本");
        if (installed.arch !== process.arch)
          throw new Error(
            "此版本在另一种处理器上安装，请先修复文件以获取本机原生库。",
          );
        const meta = await manager.metadata(id);
        const major = meta.javaVersion?.majorVersion || 8;
        const java = await ensureJava(major, signal);
        signal.throwIfAborted();
        const account =
          settings.accountMode === "microsoft"
            ? await auth.account(signal)
            : {
                name: settings.playerName,
                id: offlineUUID(settings.playerName),
                type: "offline",
                accessToken: "0",
              };
        signal.throwIfAborted();
        await persist({ ...settings, selectedVersion: id });
        const child = await manager.launch(
          id,
          settings,
          account,
          java,
          (result) => {
            running = null;
            emit("running", null);
            if (result.code !== 0) {
              report({
                phase: "error",
                detail: `游戏退出（${result.signal || result.code}），请查看启动日志。`,
              });
              win?.show();
            } else
              report({
                phase: "complete",
                detail: "游戏已退出，欢迎下次再来",
                percent: 100,
              });
          },
        );
        running = { id, child };
        emit("running", { id, pid: child.pid });
        report({
          phase: "running",
          detail: `Minecraft ${id} 正在运行`,
          percent: 100,
        });
      });
    });
    handle("cancel", () => {
      controller?.abort();
      return true;
    });
    handle("openFolder", async (id) => {
      const target = id
        ? path.join(settings.gameDirectory, "instances", safeId(id))
        : settings.gameDirectory;
      await fs.mkdir(target, { recursive: true });
      const err = await shell.openPath(target);
      if (err) throw new Error(err);
    });
    handle("login", async () => {
      if (loginController) throw new Error("已有登录请求，请先取消或完成");
      const current = new AbortController();
      loginController = current;
      try {
        const clientId = settings.microsoftClientId;
        const device = await auth.begin(clientId, current.signal);
        current.signal.throwIfAborted();
        auth
          .finish(clientId, device, current.signal)
          .then(async (account) => {
            await persist({ ...settings, accountMode: "microsoft" });
            emit("account", account);
            emit("loginDone", true);
          })
          .catch((e) => {
            if (!current.signal.aborted) emit("loginError", e.message);
          })
          .finally(() => {
            if (loginController === current) loginController = null;
          });
        return {
          userCode: device.user_code,
          verificationUri: device.verification_uri,
          expiresIn: device.expires_in,
        };
      } catch (e) {
        loginController = null;
        throw e;
      }
    });
    handle("cancelLogin", () => {
      loginController?.abort();
      loginController = null;
    });
    handle("logout", async () => {
      guardIdle();
      loginController?.abort();
      loginController = null;
      await auth.logout();
      await persist({ ...settings, accountMode: "offline" });
      emit("account", null);
    });
    handle("openLink", (key) => {
      const links = {
        microsoft: "https://www.microsoft.com/link",
        adoptium: "https://adoptium.net/temurin/releases/",
        bmclapi: "https://bmclapidoc.bangbang93.com/",
        minecraft: "https://www.minecraft.net/",
        entra: "https://entra.microsoft.com/",
      };
      if (!links[key]) throw new Error("未知链接");
      return shell.openExternal(links[key]);
    });
    handle("windowControl", (action) => {
      if (action === "minimize") win.minimize();
      else if (action === "maximize")
        win.isMaximized() ? win.unmaximize() : win.maximize();
      else if (action === "close") win.close();
    });
    createWindow();
    app.on("activate", () => {
      if (!win || win.isDestroyed()) createWindow();
      else win.show();
    });
  });
app.on("second-instance", () => {
  win?.show();
  win?.focus();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", () => {
  controller?.abort();
  loginController?.abort();
  if (win) win.removeAllListeners("close");
});
