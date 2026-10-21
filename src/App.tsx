import { useEffect, useState } from "react";
import {
  House,
  Layers3,
  Download,
  Settings2,
  ArrowUpRight,
  ArrowRight,
  Play,
  ChevronDown,
  Search,
  Check,
  RefreshCw,
  FolderOpen,
  Cpu,
  MemoryStick,
  Globe2,
  Terminal,
  UserRound,
  Plus,
  X,
  Minus,
  Maximize2,
  LoaderCircle,
  Leaf,
  ShieldCheck,
  ExternalLink,
  AlertCircle,
  Box,
  LogOut,
  Square,
  CheckCircle2,
} from "lucide-react";
import Landscape, { Cube } from "./Landscape";
import type {
  State,
  Manifest,
  Settings,
  Device,
  Version,
} from "./types";
type Page =
  "home" | "versions" | "downloads" | "settings" | "accounts" | "logs";
const nav = [
  { id: "home", label: "开始游戏", icon: House },
  { id: "versions", label: "游戏版本", icon: Layers3 },
  { id: "downloads", label: "下载任务", icon: Download },
  { id: "settings", label: "启动器设置", icon: Settings2 },
] as const;
const titles: Record<Page, string> = {
  home: "开始游戏",
  versions: "游戏版本",
  downloads: "下载任务",
  settings: "启动器设置",
  accounts: "我的账户",
  logs: "启动日志",
};
const formatBytes = (b = 0) =>
  b > 1024 ** 3
    ? (b / 1024 ** 3).toFixed(2) + " GB"
    : b > 1024 ** 2
      ? (b / 1024 ** 2).toFixed(1) + " MB"
      : (b / 1024).toFixed(0) + " KB";
const date = (v: string) =>
  new Date(v).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
const api = window.moss;

export default function App() {
  const [state, setState] = useState<State | null>(null),
    [manifest, setManifest] = useState<Manifest | null>(null),
    [page, setPage] = useState<Page>("home"),
    [toast, setToast] = useState(""),
    [bootError, setBootError] = useState(""),
    [fetching, setFetching] = useState(false),
    [remoteError, setRemoteError] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("release"),
    [limit, setLimit] = useState(24),
    [selected, setSelected] = useState(""),
    [device, setDevice] = useState<Device | null>(null),
    [loggingIn, setLoggingIn] = useState(false),
    [javaMajor, setJavaMajor] = useState(21);
  const patch = (data: Partial<State>) =>
    setState((s) => (s ? { ...s, ...data } : s));
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await fn();
    } catch (e) {
      setToast(
        String(e instanceof Error ? e.message : e).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    }
  };
  const loadManifest = async () => {
    if (!api) return;
    setFetching(true);
    setRemoteError("");
    try {
      setManifest(await api.manifest());
    } catch (e) {
      setRemoteError(e instanceof Error ? e.message : String(e));
    } finally {
      setFetching(false);
    }
  };
  useEffect(() => {
    if (!api) return;
    let active = true;
    api
      .state()
      .then((s) => {
        if (active) {
          setState(s);
          setSelected(s.settings.selectedVersion || s.installed[0]?.id || "");
        }
      })
      .catch((e) => setBootError(e.message));
    const off = api.onEvent(({ type, data }) => {
      if (type === "log")
        setState((s) =>
          s ? { ...s, logs: [...s.logs, data].slice(-400) } : s,
        );
      else if (
        [
          "settings",
          "installed",
          "java",
          "account",
          "busy",
          "running",
          "progress",
        ].includes(type)
      )
        setState((s) => (s ? { ...s, [type]: data } : s));
      else if (type === "loginDone") {
        setDevice(null);
        setLoggingIn(false);
        setToast("微软账户已连接");
      } else if (type === "loginError") {
        setDevice(null);
        setLoggingIn(false);
        setToast(data);
      }
    });
    return () => {
      active = false;
      off();
    };
  }, []);
  useEffect(() => {
    if (state) void loadManifest();
  }, [state?.settings.source]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 6500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (
      state?.installed.length &&
      !state.installed.some((v) => v.id === selected)
    )
      setSelected(state.installed[0].id);
  }, [state?.installed, selected]);
  if (!api)
    return (
      <div className="browser-notice">
        <Cube size={70} />
        <h1>苔原 Moss</h1>
        <p>
          这是一个桌面游戏启动器。请运行 macOS / Windows 应用，或在项目中执行
          pnpm dev。
        </p>
      </div>
    );
  if (!state)
    return (
      <div className="browser-notice">
        <Cube size={60} />
        <h2>{bootError ? "启动器加载失败" : "正在准备你的世界"}</h2>
        <p>{bootError || "检测本机运行环境…"}</p>
      </div>
    );
  const { settings, installed, java, account, busy, running, progress } = state;
  const locked = busy || !!running;
  const save = (v: Partial<Settings>) => run(() => api.saveSettings(v));
  const install = (id: string) =>
    run(async () => {
      await api.install(id);
      setPage("downloads");
    });
  const launch = (id: string) =>
    run(async () => {
      await api.launch(id);
      setSelected(id);
    });
  const latest = manifest?.latest.release;
  const displayName =
    settings.accountMode === "microsoft" && account
      ? account.name
      : settings.playerName;
  const selectedInstall = installed.find((v) => v.id === selected);
  const list = (manifest?.versions || []).filter(
    (v) =>
      (filter === "installed"
        ? installed.some((i) => i.id === v.id)
        : v.type === filter) &&
      v.id.toLowerCase().includes(query.toLowerCase()) &&
      new Date(v.releaseTime) >= new Date("2018-07-18"),
  );
  const startLogin = () =>
    run(async () => {
      setLoggingIn(true);
      try {
        setDevice(await api.login());
      } catch (e) {
        setLoggingIn(false);
        throw e;
      }
    });
  const cancelLogin = () =>
    run(async () => {
      await api.cancelLogin();
      setDevice(null);
      setLoggingIn(false);
    });
  const versionRow = (
    v: { id: string; type: string; releaseTime?: string; installedAt?: string },
    compact = false,
  ) => {
    const local = installed.find((i) => i.id === v.id);
    return (
      <div className={"version-row " + (compact ? "compact" : "")} key={v.id}>
        <div
          className={
            "block-avatar " + (v.type === "snapshot" ? "snapshot" : "")
          }
        >
          <Cube size={compact ? 30 : 38} />
        </div>
        <div className="version-info">
          <strong>Minecraft {v.id}</strong>
          <span>
            {v.type === "release" ? "正式版" : "开发快照"}
            <i />{" "}
            {local
              ? `Java ${local.java} · 已安装`
              : v.releaseTime
                ? date(v.releaseTime)
                : "Java Edition"}
          </span>
        </div>
        {compact ? (
          <button
            className="icon-button"
            title="选择此版本"
            onClick={() => setSelected(v.id)}
          >
            {selected === v.id ? <Check size={18} /> : <ArrowRight size={18} />}
          </button>
        ) : (
          <>
            <span className={"tag " + (local ? "green" : "")}>
              {local ? "已就绪" : "原版"}
            </span>
            <button
              className={local ? "secondary small" : "primary small"}
              disabled={locked}
              onClick={() => (local ? void launch(v.id) : void install(v.id))}
            >
              {local ? (
                <Play size={14} fill="currentColor" />
              ) : (
                <Download size={15} />
              )}{" "}
              {local ? "启动" : "安装"}
            </button>
            {local && (
              <button
                className="icon-button"
                disabled={locked}
                title="校验并修复游戏文件"
                onClick={() => void install(v.id)}
              >
                <RefreshCw size={15} />
              </button>
            )}
          </>
        )}
      </div>
    );
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="drag-zone" />
        <a className="brand" onClick={() => setPage("home")}>
          <Cube size={37} />
          <div>
            <b>
              moss<span>苔原</span>
            </b>
            <small>EVERY WORLD BEGINS HERE</small>
          </div>
        </a>
        <div className="nav-label">你的工作台</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={"nav-item " + (page === n.id ? "active" : "")}
              onClick={() => setPage(n.id)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.id === "downloads" && busy && <span className="nav-dot" />}
              {n.id === "versions" && installed.length > 0 && (
                <small>{installed.length}</small>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="side-note">
            <Leaf size={18} />
            <p>
              把想象，变成世界。<span>Make room for adventure.</span>
            </p>
          </div>
          <button
            className={"nav-item " + (page === "logs" ? "active" : "")}
            onClick={() => setPage("logs")}
          >
            <Terminal size={18} />
            <span>启动日志</span>
          </button>
          <button className="profile" onClick={() => setPage("accounts")}>
            <div className="face">
              <span />
            </div>
            <div>
              <b>{displayName}</b>
              <small>
                <span className="status-dot" />
                {settings.accountMode === "microsoft" ? "微软账户" : "离线档案"}
              </small>
            </div>
            <ChevronDown size={15} />
          </button>
          <div className="build-label">
            MOSS LAUNCHER <span>v{state.appVersion}</span>
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            工作台 <span>/</span> <b>{titles[page]}</b>
          </div>
          <div className="header-right">
            <span className="edition">JAVA EDITION</span>
            <button
              className="source-status"
              onClick={() => setPage("settings")}
            >
              <span className="status-dot" />
              {settings.source === "official"
                ? "Mojang 官方源"
                : "BMCLAPI 镜像"}
            </button>
            {state.platform !== "darwin" && (
              <div className="window-buttons">
                <button
                  aria-label="最小化"
                  onClick={() => api.windowControl("minimize")}
                >
                  <Minus size={14} />
                </button>
                <button
                  aria-label="最大化"
                  onClick={() => api.windowControl("maximize")}
                >
                  <Maximize2 size={13} />
                </button>
                <button
                  aria-label="关闭"
                  onClick={() => api.windowControl("close")}
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>
        </header>
        <main className="content" key={page}>
          {page === "home" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">LET'S BUILD SOMETHING.</div>
                  <h1>
                    你好，{displayName}
                    <span className="heading-dot">.</span>
                  </h1>
                  <p>世界已准备好，下一段冒险由你开启。</p>
                </div>
                <div className="platform-pill">
                  <Box size={15} />
                  {state.platform === "darwin" ? "macOS" : "Windows"}{" "}
                  <span>·</span>{" "}
                  {state.arch === "arm64" ? "Apple Silicon" : "x64"}
                </div>
              </div>
              <section className="hero">
                <Landscape />
                <div className="hero-content">
                  <span className="hero-kicker">
                    <span /> MINECRAFT JAVA EDITION
                  </span>
                  <h2>
                    你的世界，
                    <br />
                    即刻启程<span>。</span>
                  </h2>
                  <p>
                    从第一块方块开始，
                    <br />
                    建造只属于你的无限可能。
                  </p>
                  <button
                    className="hero-button"
                    onClick={() => setPage("versions")}
                  >
                    探索游戏版本 <ArrowUpRight size={19} />
                  </button>
                </div>
                <div className="hero-corner">
                  <span>THE OVERWORLD</span>
                  <b>无限世界 · 无限可能</b>
                </div>
                <div className="hero-coordinate">
                  X 128 <span>/</span> Y 64 <span>/</span> Z −256
                </div>
              </section>
              <div className="home-grid">
                <section className="panel worlds">
                  <div className="panel-heading">
                    <h3>
                      我的游戏{" "}
                      <span>
                        {installed.length.toString().padStart(2, "0")}
                      </span>
                    </h3>
                    <button
                      className="text-button"
                      onClick={() => {
                        setFilter("installed");
                        setPage("versions");
                      }}
                    >
                      全部版本 <ArrowRight size={14} />
                    </button>
                  </div>
                  {installed.length ? (
                    installed.slice(0, 2).map((v) => versionRow(v, true))
                  ) : (
                    <div className="empty-world">
                      <div className="empty-cube">
                        <Cube size={35} />
                      </div>
                      <div>
                        <b>一个新世界，等你创造</b>
                        <p>安装第一个版本，开始你的旅程。</p>
                      </div>
                      <button
                        className="icon-button add"
                        aria-label="安装第一个版本"
                        onClick={() => setPage("versions")}
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                  )}
                  <button
                    className="add-version"
                    onClick={() => {
                      setFilter("release");
                      setPage("versions");
                    }}
                  >
                    <Plus size={15} /> 添加游戏版本
                  </button>
                </section>
                <section className="panel environment">
                  <div className="panel-heading">
                    <h3>运行环境</h3>
                    <span className="tag green">
                      {java.length ? "已检测" : "自动配置"}
                    </span>
                  </div>
                  <div className="env-row">
                    <div className="env-icon">
                      <Cpu size={18} />
                    </div>
                    <div>
                      <span>Java 运行环境</span>
                      <b>
                        {settings.javaPath
                          ? `Java ${java.find((j) => j.path === settings.javaPath)?.major || "自定义"}`
                          : "智能选择"}{" "}
                        <small>
                          {java.length
                            ? `${java.length} 个可用`
                            : "启动时自动下载"}
                        </small>
                      </b>
                    </div>
                    <CheckCircle2 size={17} className="green-text" />
                  </div>
                  <div className="env-row">
                    <div className="env-icon">
                      <MemoryStick size={18} />
                    </div>
                    <div>
                      <span>游戏内存</span>
                      <b>
                        {(settings.memoryMB / 1024).toFixed(1)}{" "}
                        <small>
                          GB / {(state.totalMemory / 1024).toFixed(0)} GB
                        </small>
                      </b>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="调整内存"
                      onClick={() => setPage("settings")}
                    >
                      <Settings2 size={16} />
                    </button>
                  </div>
                </section>
              </div>
              <div className="home-footer">
                <ShieldCheck size={14} />
                <span>文件完整性校验 · 独立游戏目录 · 跨平台体验</span>
                <button onClick={() => api.openLink("minecraft")}>
                  Minecraft 官网 <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}
          {page === "versions" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">FIND YOUR NEXT ADVENTURE</div>
                  <h1>每个版本，都是新起点。</h1>
                  <p>从官方清单获取游戏，选择你想探索的世界。</p>
                </div>
                <button
                  className="secondary"
                  disabled={fetching}
                  onClick={() => void loadManifest()}
                >
                  <RefreshCw size={16} className={fetching ? "spin" : ""} />{" "}
                  刷新列表
                </button>
              </div>
              {latest && (
                <div className="release-banner">
                  <div className="release-art">
                    <Cube size={67} />
                  </div>
                  <div>
                    <span className="eyebrow">LATEST RELEASE</span>
                    <h2>Minecraft {latest}</h2>
                    <p>最新正式版 · 原版 Java Edition</p>
                  </div>
                  <button
                    className="primary"
                    disabled={locked}
                    onClick={() =>
                      installed.some((v) => v.id === latest)
                        ? void launch(latest)
                        : void install(latest)
                    }
                  >
                    {installed.some((v) => v.id === latest) ? (
                      <Play size={16} />
                    ) : (
                      <Download size={17} />
                    )}{" "}
                    {installed.some((v) => v.id === latest)
                      ? "启动最新版本"
                      : "安装最新版本"}
                  </button>
                </div>
              )}
              <div className="list-toolbar">
                <div className="tabs">
                  {[
                    ["release", "正式版"],
                    ["snapshot", "开发快照"],
                    ["installed", "已安装"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={filter === id ? "selected" : ""}
                      onClick={() => {
                        setFilter(id);
                        setLimit(24);
                      }}
                    >
                      {label}
                      {id === "installed" && <span>{installed.length}</span>}
                    </button>
                  ))}
                </div>
                <label className="search">
                  <Search size={17} />
                  <input
                    aria-label="搜索版本"
                    placeholder="搜索版本，例如 1.21.1"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setLimit(24);
                    }}
                  />
                </label>
              </div>
              {manifest?.cached && (
                <div className="info-strip">
                  <AlertCircle size={16} /> 当前显示本地缓存，恢复网络后可刷新。
                </div>
              )}
              {remoteError && (
                <div className="error-box">
                  <AlertCircle size={19} />
                  <p>{remoteError}</p>
                  <button
                    className="secondary"
                    onClick={() => void loadManifest()}
                  >
                    重试
                  </button>
                </div>
              )}
              <div className="version-list">
                {filter === "installed"
                  ? installed
                      .filter((v) => v.id.includes(query))
                      .map((v) => versionRow(v))
                  : list.slice(0, limit).map((v) => versionRow(v))}
              </div>
              {fetching && !manifest && (
                <div className="empty-state">
                  <LoaderCircle className="spin" />
                  <h3>正在获取版本清单</h3>
                  <p>
                    连接
                    {settings.source === "official"
                      ? "Mojang 官方源"
                      : "BMCLAPI 镜像"}
                    …
                  </p>
                </div>
              )}
              {!fetching &&
                ((filter === "installed" && installed.length === 0) ||
                  (filter !== "installed" && !list.length)) && (
                  <div className="empty-state">
                    <Layers3 size={36} />
                    <h3>{query ? "没有找到匹配版本" : "还没有安装游戏"}</h3>
                    <p>
                      {query
                        ? "试试其他版本号。"
                        : "切换到正式版，选择一个版本安装。"}
                    </p>
                  </div>
                )}
              {filter !== "installed" && list.length > limit && (
                <button
                  className="secondary load-more"
                  onClick={() => setLimit((n) => n + 30)}
                >
                  加载更多版本 <ChevronDown size={16} />
                </button>
              )}
              <p className="fine-print">
                支持 1.13+ 原版；Apple Silicon 建议选择
                1.19+。旧版及模组加载器暂未集成。
                {settings.source === "bmclapi" && (
                  <>
                    {" "}
                    下载加速由{" "}
                    <button onClick={() => api.openLink("bmclapi")}>
                      BMCLAPI
                    </button>{" "}
                    提供。
                  </>
                )}
              </p>
            </>
          )}
          {page === "downloads" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">A LITTLE CLOSER TO YOUR WORLD</div>
                  <h1>冒险，正在抵达。</h1>
                  <p>自动下载游戏文件、依赖库与资源，并逐一校验。</p>
                </div>
                <span className="tag green">
                  {busy ? "1 个进行中" : "暂无进行中的任务"}
                </span>
              </div>
              <section className="panel download-panel">
                {progress ? (
                  <>
                    <div className="download-title">
                      <div className="block-avatar">
                        <Cube size={42} />
                      </div>
                      <div>
                        <h2>
                          {progress.version
                            ? "Minecraft " + progress.version
                            : progress.phase === "java"
                              ? "Java 运行环境"
                              : "任务状态"}
                        </h2>
                        <p>
                          {progress.phase === "error"
                            ? "任务遇到了问题"
                            : progress.phase === "complete"
                              ? "已完成"
                              : progress.phase === "cancelled"
                                ? "已取消"
                                : progress.phase === "running"
                                  ? "游戏运行中"
                                  : "正在准备你的冒险"}
                        </p>
                      </div>
                      {busy ? (
                        <button
                          className="secondary small"
                          onClick={() => run(() => api.cancel())}
                        >
                          <Square size={13} /> 取消任务
                        </button>
                      ) : (
                        <span
                          className={
                            "tag " +
                            (progress.phase === "error" ? "red" : "green")
                          }
                        >
                          {progress.phase === "error"
                            ? "需要处理"
                            : progress.phase === "cancelled"
                              ? "已取消"
                              : "已完成"}
                        </span>
                      )}
                    </div>
                    <div
                      className={
                        "progress-track " +
                        (progress.phase === "error" ? "failed" : "")
                      }
                    >
                      <div
                        style={{
                          width: `${Math.max(1, Math.min(100, progress.percent || 0))}%`,
                        }}
                      />
                    </div>
                    <div className="download-detail">
                      <span>{progress.detail}</span>
                      <b>{Math.round(progress.percent || 0)}%</b>
                    </div>
                    <div className="download-stats">
                      <div>
                        <span>已传输</span>
                        <b>{formatBytes(progress.bytes)}</b>
                      </div>
                      <div>
                        <span>文件校验</span>
                        <b>
                          {progress.files ?? 0}{" "}
                          <small>/ {progress.totalFiles ?? "—"}</small>
                        </b>
                      </div>
                      <div>
                        <span>平均速度</span>
                        <b>{busy ? formatBytes(progress.speed) + "/s" : "—"}</b>
                      </div>
                    </div>
                    {progress.phase === "error" && progress.version && (
                      <button
                        className="primary"
                        disabled={locked}
                        onClick={() => void install(progress.version!)}
                      >
                        <RefreshCw size={16} /> 重试并修复
                      </button>
                    )}
                    {progress.phase === "complete" && progress.version && (
                      <button
                        className="primary"
                        disabled={locked}
                        onClick={() => void launch(progress.version!)}
                      >
                        <Play size={16} /> 启动游戏
                      </button>
                    )}
                  </>
                ) : (
                  <div className="empty-state">
                    <div className="empty-download">
                      <Download size={30} />
                    </div>
                    <h2>准备好迎接新世界了吗？</h2>
                    <p>选择一个游戏版本，这里会显示完整的下载进度。</p>
                    <button
                      className="primary"
                      onClick={() => setPage("versions")}
                    >
                      探索游戏版本 <ArrowRight size={16} />
                    </button>
                  </div>
                )}
              </section>
              <div className="source-card">
                <Globe2 size={23} />
                <div>
                  <b>
                    {settings.source === "official"
                      ? "Mojang 官方下载源"
                      : "BMCLAPI 下载镜像"}
                  </b>
                  <p>
                    {settings.source === "official"
                      ? "直接从 Mojang 获取游戏文件与资源。"
                      : "下载加速由 BMCLAPI 提供，镜像失败时回退官方源。"}
                  </p>
                </div>
                <button
                  className="text-button"
                  onClick={() => setPage("settings")}
                >
                  切换下载源 <ArrowRight size={15} />
                </button>
              </div>
              <div className="help-grid">
                <div>
                  <ShieldCheck size={21} />
                  <h3>每个文件，都经过校验</h3>
                  <p>依据官方 SHA-1 校验值验证文件完整性。</p>
                </div>
                <div>
                  <RefreshCw size={21} />
                  <h3>中断后，从已有文件继续</h3>
                  <p>再次安装会复用已完成且校验通过的文件。</p>
                </div>
              </div>
            </>
          )}
          {page === "settings" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">MAKE YOURSELF AT HOME</div>
                  <h1>让启动器，适合你。</h1>
                  <p>设置自动保存，下次启动游戏时生效。</p>
                </div>
                <span className="tag">
                  {locked ? "任务结束后可修改" : "自动保存"}
                </span>
              </div>
              <section className="panel settings-panel">
                <div className="setting-title">
                  <Globe2 size={19} />
                  <h3>下载源</h3>
                </div>
                <div className="source-options">
                  {(["official", "bmclapi"] as const).map((s) => (
                    <button
                      className={
                        "source-option " +
                        (settings.source === s ? "chosen" : "")
                      }
                      key={s}
                      disabled={locked}
                      onClick={() => void save({ source: s })}
                    >
                      <div>
                        <b>
                          {s === "official"
                            ? "Mojang 官方源"
                            : "BMCLAPI 镜像源"}
                        </b>
                        <p>
                          {s === "official"
                            ? "官方文件，直接下载"
                            : "国内镜像，失败自动回退官方源"}
                        </p>
                      </div>
                      <span className="radio">
                        {settings.source === s && <span />}
                      </span>
                    </button>
                  ))}
                </div>
                <p className="fine-print">
                  镜像服务由{" "}
                  <button onClick={() => api.openLink("bmclapi")}>
                    BMCLAPI <ExternalLink size={11} />
                  </button>{" "}
                  提供。
                </p>
              </section>
              <section className="panel settings-panel">
                <div className="setting-title">
                  <Cpu size={19} />
                  <h3>运行环境</h3>
                  <button
                    className="text-button"
                    onClick={() => run(() => api.detectJava())}
                  >
                    <RefreshCw size={14} /> 重新检测
                  </button>
                </div>
                <label className="field-label" htmlFor="java">
                  Java 选择
                </label>
                <div className="input-row">
                  <select
                    id="java"
                    value={settings.javaPath}
                    disabled={locked}
                    onChange={(e) => void save({ javaPath: e.target.value })}
                  >
                    <option value="">自动管理 · 根据游戏版本匹配 Java</option>
                    {java.map((j) => (
                      <option key={j.path} value={j.path}>
                        Java {j.version} · {j.arch} · {j.path}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={() => run(() => api.pickJava())}
                  >
                    <FolderOpen size={16} /> 浏览
                  </button>
                </div>
                <p className="field-help">
                  自动模式会匹配相同架构与 Java 主版本，缺失时下载 Eclipse
                  Temurin。
                </p>
                <div className="java-install">
                  <span>安装运行环境</span>
                  <select
                    aria-label="选择 Java 主版本"
                    value={javaMajor}
                    onChange={(e) => setJavaMajor(Number(e.target.value))}
                  >
                    {[8, 17, 21, 25].map((n) => (
                      <option key={n} value={n}>
                        Java {n}
                      </option>
                    ))}
                  </select>
                  <button
                    className="secondary small"
                    disabled={locked}
                    onClick={() =>
                      run(async () => {
                        await api.installJava(javaMajor);
                        setPage("downloads");
                      })
                    }
                  >
                    <Download size={14} /> 下载 Java
                  </button>
                </div>
                <div className="setting-divider" />
                <div className="memory-title">
                  <div>
                    <h4>分配内存</h4>
                    <p>为游戏预留舒适的运行空间。</p>
                  </div>
                  <b>
                    {(settings.memoryMB / 1024).toFixed(1)} <span>GB</span>
                  </b>
                </div>
                <input
                  className="range"
                  aria-label="游戏内存"
                  type="range"
                  min="1024"
                  max={Math.max(
                    1024,
                    Math.min(
                      16384,
                      Math.floor(state.totalMemory / 1024) * 1024 - 2048,
                    ),
                  )}
                  step="512"
                  defaultValue={settings.memoryMB}
                  key={settings.memoryMB}
                  disabled={locked}
                  onPointerUp={(e) =>
                    void save({ memoryMB: Number(e.currentTarget.value) })
                  }
                  onKeyUp={(e) =>
                    void save({ memoryMB: Number(e.currentTarget.value) })
                  }
                />
                <div className="range-labels">
                  <span>1 GB</span>
                  <span>
                    物理内存 {(state.totalMemory / 1024).toFixed(0)} GB
                  </span>
                  <span>
                    {Math.min(16, Math.floor(state.totalMemory / 1024) - 2)} GB
                  </span>
                </div>
              </section>
              <section className="panel settings-panel">
                <div className="setting-title">
                  <FolderOpen size={19} />
                  <h3>游戏文件</h3>
                </div>
                <label className="field-label">存储位置</label>
                <div className="input-row">
                  <div className="path-field">{settings.gameDirectory}</div>
                  <button
                    className="secondary"
                    disabled={locked}
                    onClick={() => run(() => api.pickDirectory())}
                  >
                    更改
                  </button>
                  <button
                    className="icon-button"
                    title="打开游戏目录"
                    onClick={() => run(() => api.openFolder())}
                  >
                    <FolderOpen size={18} />
                  </button>
                </div>
                <p className="field-help">
                  每个版本独立保存存档与配置，共享资源库。更改目录不会移动已有文件。
                </p>
              </section>
              <section className="panel settings-panel">
                <div className="setting-title">
                  <UserRound size={19} />
                  <h3>微软登录配置</h3>
                </div>
                <label className="field-label" htmlFor="client-id">
                  Application Client ID
                </label>
                <div className="input-row">
                  <input
                    id="client-id"
                    placeholder="你的 Microsoft Entra 应用 ID"
                    disabled={locked || loggingIn}
                    defaultValue={settings.microsoftClientId}
                    key={settings.microsoftClientId}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== settings.microsoftClientId)
                        void save({ microsoftClientId: e.target.value.trim() });
                    }}
                  />
                  <button
                    className="secondary"
                    onClick={() => api.openLink("entra")}
                  >
                    <ExternalLink size={14} /> 应用注册
                  </button>
                </div>
                <p className="field-help">
                  使用支持个人 Microsoft 账户、启用公共客户端流且已获 Minecraft
                  API 访问许可的应用。无需 Client
                  Secret。登录后凭据使用系统加密保存。
                </p>
              </section>
              <p className="fine-print">
                Moss Launcher 是独立开发的 Minecraft Java 版启动器，与 Mojang /
                Microsoft 无隶属关系。
              </p>
            </>
          )}
          {page === "accounts" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">THIS IS YOUR STORY</div>
                  <h1>以你的名字，进入世界。</h1>
                  <p>选择本地档案，或连接你的 Microsoft 账户。</p>
                </div>
              </div>
              <div className="accounts-grid">
                <section className="panel account-card">
                  <div className="large-face">
                    <div className="face">
                      <span />
                    </div>
                  </div>
                  <span className="eyebrow">LOCAL PROFILE</span>
                  <h2>离线档案</h2>
                  <p>适合本地单人游戏，无法加入需要正版认证的服务器。</p>
                  <label className="field-label" htmlFor="player-name">
                    游戏角色名
                  </label>
                  <input
                    id="player-name"
                    defaultValue={settings.playerName}
                    key={settings.playerName}
                    disabled={locked}
                    maxLength={16}
                    onBlur={(e) => {
                      if (e.target.value !== settings.playerName)
                        void save({ playerName: e.target.value });
                    }}
                  />
                  <span className="field-help">3–16 位字母、数字或下划线</span>
                  <button
                    className={
                      settings.accountMode === "offline"
                        ? "secondary"
                        : "primary"
                    }
                    disabled={locked || settings.accountMode === "offline"}
                    onClick={() => void save({ accountMode: "offline" })}
                  >
                    {settings.accountMode === "offline" ? (
                      <Check size={17} />
                    ) : (
                      <UserRound size={17} />
                    )}{" "}
                    {settings.accountMode === "offline"
                      ? "当前正在使用"
                      : "使用离线档案"}
                  </button>
                </section>
                <section className="panel account-card">
                  <div className="ms-logo">
                    <i />
                    <i />
                    <i />
                    <i />
                  </div>
                  <span className="eyebrow">MICROSOFT ACCOUNT</span>
                  <h2>{account ? account.name : "连接微软账户"}</h2>
                  <p>
                    {account
                      ? "已连接 Minecraft Java 版游戏档案。"
                      : "登录拥有 Minecraft Java 版的账户，解锁正版联机体验。"}
                  </p>
                  {account ? (
                    <>
                      <div className="account-connected">
                        <ShieldCheck size={18} /> 已安全保存登录状态
                      </div>
                      <button
                        className="primary"
                        disabled={
                          locked || settings.accountMode === "microsoft"
                        }
                        onClick={() => void save({ accountMode: "microsoft" })}
                      >
                        <Check size={16} />
                        {settings.accountMode === "microsoft"
                          ? "当前正在使用"
                          : "使用微软账户"}
                      </button>
                      <button
                        className="text-button logout"
                        disabled={locked}
                        onClick={() => run(() => api.logout())}
                      >
                        <LogOut size={14} /> 退出登录
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="account-connected">
                        <ShieldCheck size={18} /> 在微软官方页面完成登录
                      </div>
                      <button
                        className="primary"
                        disabled={locked || loggingIn}
                        onClick={() =>
                          settings.microsoftClientId
                            ? void startLogin()
                            : setPage("settings")
                        }
                      >
                        {loggingIn ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : (
                          <ArrowUpRight size={17} />
                        )}{" "}
                        {settings.microsoftClientId
                          ? "登录 Microsoft"
                          : "配置微软登录"}
                      </button>
                      <span className="field-help">
                        {settings.microsoftClientId
                          ? "登录令牌仅保存在本机。"
                          : "需先填写你注册的应用 Client ID。"}
                      </span>
                    </>
                  )}
                </section>
              </div>
            </>
          )}
          {page === "logs" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">BEHIND THE BLOCKS</div>
                  <h1>每一步，都有迹可循。</h1>
                  <p>实时游戏输出与任务诊断，敏感登录令牌自动隐藏。</p>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    run(() => api.openFolder(selected || undefined))
                  }
                >
                  <FolderOpen size={16} /> 打开游戏目录
                </button>
              </div>
              <section className="log-panel">
                <div className="log-header">
                  <Terminal size={16} /> SESSION OUTPUT{" "}
                  <span>{running ? "● 游戏运行中" : "等待游戏启动"}</span>
                </div>
                <div className="log-content">
                  {state.logs.length ? (
                    state.logs.map((l, i) => (
                      <div className="log-line" key={i}>
                        <time>
                          {new Date(l.time).toLocaleTimeString("zh-CN", {
                            hour12: false,
                          })}
                        </time>
                        <pre>{l.text}</pre>
                      </div>
                    ))
                  ) : (
                    <p className="log-empty">
                      启动游戏后，运行日志会显示在这里。
                    </p>
                  )}
                </div>
              </section>
            </>
          )}
        </main>
        <footer className="launch-bar">
          <div className="launch-version">
            <div className="mini-cube">
              <Cube size={30} />
            </div>
            <div>
              <span>准备启动</span>
              <div className="select-wrap">
                <select
                  aria-label="选择启动版本"
                  value={selected}
                  disabled={locked || !installed.length}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    void save({ selectedVersion: e.target.value });
                  }}
                >
                  {!installed.length && <option value="">尚未安装游戏</option>}
                  {installed.map((v) => (
                    <option key={v.id} value={v.id}>
                      Minecraft {v.id}
                    </option>
                  ))}
                </select>
                <ChevronDown size={14} />
              </div>
            </div>
          </div>
          <div className="launch-context">
            <span>
              <span className="status-dot" />
              {running
                ? "游戏运行中"
                : busy
                  ? "任务进行中"
                  : selectedInstall
                    ? "准备就绪"
                    : "等待安装"}
            </span>
            <small>
              {selectedInstall
                ? `原版 · Java ${selectedInstall.java} · ${(settings.memoryMB / 1024).toFixed(1)} GB`
                : "安装一个版本，开启新旅程"}
            </small>
          </div>
          <button
            className="launch-button"
            disabled={locked}
            onClick={() =>
              selected ? void launch(selected) : setPage("versions")
            }
          >
            {busy ? (
              <LoaderCircle size={21} className="spin" />
            ) : running ? (
              <Check size={22} />
            ) : (
              <Play size={21} fill="currentColor" />
            )}
            <div>
              <b>
                {running
                  ? "游戏运行中"
                  : busy
                    ? "正在处理…"
                    : selected
                      ? "启动游戏"
                      : "安装游戏"}
              </b>
              <span>
                {running
                  ? "ENJOY YOUR WORLD"
                  : busy
                    ? "GETTING THINGS READY"
                    : "LET THE ADVENTURE BEGIN"}
              </span>
            </div>
            {!locked && <ArrowUpRight size={21} />}
          </button>
        </footer>
      </div>
      {toast && (
        <div role="alert" className="toast">
          <AlertCircle size={18} />
          <span>{toast}</span>
          <button aria-label="关闭提示" onClick={() => setToast("")}>
            <X size={16} />
          </button>
        </div>
      )}
      {device && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="微软账户登录"
          >
            <button
              className="modal-close icon-button"
              aria-label="取消登录"
              onClick={() => void cancelLogin()}
            >
              <X size={20} />
            </button>
            <div className="ms-logo">
              <i />
              <i />
              <i />
              <i />
            </div>
            <h2>连接你的 Microsoft 账户</h2>
            <p>打开微软登录页面，输入下面的验证码。</p>
            <div className="device-code">{device.userCode}</div>
            <button
              className="primary"
              onClick={() => api.openLink("microsoft")}
            >
              打开微软登录页面 <ExternalLink size={16} />
            </button>
            <p className="login-wait">
              <LoaderCircle size={15} className="spin" />{" "}
              等待你完成登录，验证码约 {Math.round(device.expiresIn / 60)}{" "}
              分钟有效。
            </p>
            <button className="text-button" onClick={() => void cancelLogin()}>
              取消登录
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
