import { useEffect, useRef, useState } from "react";
import {
  X,
  PackageOpen,
  Layers3,
  Download,
  LoaderCircle,
  Check,
  AlertCircle,
  ExternalLink,
  FolderOpen,
} from "lucide-react";
import LoaderIcon from "./LoaderIcon";
import type { Loader, LoaderVersion, Manifest, PackPreview } from "./types";
const api = window.moss!;
const loaders: { id: Loader; name: string; hint: string }[] = [
  { id: "vanilla", name: "原版", hint: "纯粹的方块世界" },
  { id: "fabric", name: "Fabric", hint: "轻巧、灵活的生态" },
  { id: "forge", name: "Forge", hint: "经典模组加载器" },
  { id: "neoforge", name: "NeoForge", hint: "新一代模组生态" },
  { id: "optifine", name: "OptiFine", hint: "画质与性能优化" },
];
const formats: Record<string, string> = {
  plain: "普通 ZIP",
  modrinth: "Modrinth",
  curseforge: "CurseForge",
  multimc: "MultiMC / Prism",
};
export default function InstallDialog({
  version,
  pack,
  manifest,
  onClose,
  onStarted,
}: {
  version?: string;
  pack?: PackPreview;
  manifest: Manifest | null;
  onClose: () => void;
  onStarted: () => void;
}) {
  const [preview, setPreview] = useState(pack),
    [minecraft, setMinecraft] = useState(
      pack?.minecraft || version || manifest?.latest.release || "",
    ),
    [loader, setLoader] = useState<Loader>(pack?.loader || "vanilla"),
    [loaderVersion, setLoaderVersion] = useState(pack?.loaderVersion || ""),
    [versions, setVersions] = useState<LoaderVersion[]>([]),
    [fetching, setFetching] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [name, setName] = useState(pack?.name || ""),
    [optional, setOptional] = useState(false),
    [key, setKey] = useState(""),
    [resolved, setResolved] = useState(pack?.format !== "curseforge"),
    [matched, setMatched] = useState(0),
    [retry, setRetry] = useState(0);
  const root = useRef<HTMLElement>(null);
  const fixed = !!pack && pack.format !== "plain";
  useEffect(() => {
    root.current?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
      if (e.key === "Tab") {
        const all = root.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]",
        );
        if (!all?.length) return;
        const first = all[0],
          last = all[all.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === root.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === root.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [pending, onClose]);
  useEffect(() => {
    if (fixed || loader === "vanilla") {
      setFetching(false);
      setVersions([]);
      return;
    }
    let active = true;
    setFetching(true);
    setError("");
    setVersions([]);
    const timer = setTimeout(() => {
      api
        .loaderVersions(minecraft, loader)
        .then((data) => {
          if (active) {
            setVersions(data);
            setLoaderVersion((v) =>
              data.some((i) => i.version === v) ? v : data[0]?.version || "",
            );
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        })
        .finally(() => {
          if (active) setFetching(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [minecraft, loader, fixed, retry]);
  const attempt = async (fn: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : String(e)).replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setPending(false);
    }
  };
  const start = () =>
    attempt(async () => {
      const request = { minecraft, loader, loaderVersion };
      if (preview)
        await api.importPack(preview.token, {
          ...request,
          name,
          includeOptional: optional,
        });
      else await api.install(request);
      onStarted();
    });
  const ready =
    !!minecraft &&
    !fetching &&
    !pending &&
    (loader === "vanilla" || !!loaderVersion) &&
    (fixed ||
      loader === "vanilla" ||
      versions.some((v) => v.version === loaderVersion)) &&
    (!preview || resolved);
  return (
    <div className="modal-backdrop">
      <section
        ref={root}
        tabIndex={-1}
        className="modal install-modal"
        role="dialog"
        aria-modal="true"
        aria-label={preview ? "导入整合包" : "安装游戏"}
      >
        <button
          className="modal-close icon-button"
          aria-label="关闭安装窗口"
          disabled={pending}
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <div className="install-heading">
          <div className="install-symbol">
            {preview ? <PackageOpen size={25} /> : <Layers3 size={25} />}
          </div>
          <div>
            <span className="eyebrow">
              {preview ? "BRING YOUR WORLD" : "MAKE IT YOUR OWN"}
            </span>
            <h2>{preview ? "把整个世界，带进来。" : "为冒险，挑选装备。"}</h2>
          </div>
        </div>
        <p className="install-intro">
          {preview
            ? "识别游戏依赖，导入独立实例，保存包内的配置与模组。"
            : `Minecraft ${minecraft} · 选择原版，或添加一个兼容的组件。`}
        </p>
        {preview && (
          <>
            <div className="pack-summary">
              <span className="tag green">{formats[preview.format]}</span>
              <span>{preview.files} 个包内文件</span>
              <span>{preview.downloads} 个下载项</span>
            </div>
            <label className="field-label" htmlFor="pack-name">
              实例名称
            </label>
            <input
              id="pack-name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              disabled={pending}
            />
          </>
        )}
        {preview && !fixed && (
          <>
            <label className="field-label" htmlFor="pack-minecraft">
              Minecraft 版本
            </label>
            <input
              id="pack-minecraft"
              list="mc-versions"
              value={minecraft}
              onChange={(e) => {
                setMinecraft(e.target.value);
                setLoaderVersion("");
              }}
              disabled={pending}
              placeholder="例如 1.21.1"
            />
            <datalist id="mc-versions">
              {manifest?.versions
                .filter((v) => v.type === "release")
                .map((v) => (
                  <option key={v.id} value={v.id} />
                ))}
            </datalist>
            <p className="field-help">
              普通 ZIP 不含依赖信息，请按整合包作者的要求选择游戏与加载器版本。
            </p>
          </>
        )}
        {fixed ? (
          <div className="pack-dependencies">
            <div>
              <span>游戏版本</span>
              <b>Minecraft {minecraft}</b>
            </div>
            <div>
              <span>加载组件</span>
              <b>
                {loaders.find((l) => l.id === loader)?.name} {loaderVersion}
              </b>
            </div>
          </div>
        ) : (
          <>
            <label className="field-label">游戏组件</label>
            <div className="loader-grid" role="group" aria-label="选择加载器">
              {loaders.map((l) => (
                <button
                  key={l.id}
                  className={"loader-card " + (loader === l.id ? "chosen" : "")}
                  aria-pressed={loader === l.id}
                  disabled={pending}
                  onClick={() => {
                    setLoader(l.id);
                    setLoaderVersion("");
                    setError("");
                  }}
                >
                  <span className={"loader-glyph " + l.id}>
                    <LoaderIcon loader={l.id} size={35} />
                  </span>
                  <b>{l.name}</b>
                  <small>{l.hint}</small>
                  {loader === l.id && (
                    <Check size={14} className="loader-check" />
                  )}
                </button>
              ))}
            </div>
            {loader !== "vanilla" && (
              <div className="loader-version">
                <label className="field-label" htmlFor="loader-version">
                  组件版本
                </label>
                {fetching ? (
                  <p className="install-loading">
                    <LoaderCircle size={16} className="spin" />
                    正在查找兼容版本…
                  </p>
                ) : versions.length ? (
                  <select
                    id="loader-version"
                    value={loaderVersion}
                    onChange={(e) => setLoaderVersion(e.target.value)}
                  >
                    {versions.map((v) => (
                      <option key={v.version} value={v.version}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="inline-message">
                    {error
                      ? "列表暂时无法加载"
                      : "这个游戏版本暂无可用的组件版本。"}
                    <button
                      className="text-button"
                      onClick={() => setRetry((v) => v + 1)}
                    >
                      重新查询
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
        {loader === "optifine" && (
          <p className="field-help">
            OptiFine 是画质优化组件，作为独立实例安装，下载由 BMCLAPI
            提供。与其他加载器混装不在此流程内。
          </p>
        )}
        {loader === "fabric" && !fixed && (
          <p className="field-help">
            需要 Fabric API 的模组，请另行把对应版本的 Fabric API 放入实例的
            mods 文件夹。
          </p>
        )}
        {preview?.optional ? (
          <label className="check-field">
            <input
              type="checkbox"
              checked={optional}
              onChange={(e) => setOptional(e.target.checked)}
              disabled={pending}
            />
            同时安装 {preview.optional} 个可选文件
          </label>
        ) : null}
        {preview?.format === "curseforge" && !resolved && (
          <div className="curse-panel">
            <label className="field-label" htmlFor="curse-key">
              CurseForge API Key
            </label>
            <div className="input-row">
              <input
                id="curse-key"
                type="password"
                autoComplete="off"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="你的 CurseForge 开发者 API Key"
                disabled={pending}
              />
              <button
                className="secondary"
                disabled={pending || !key.trim()}
                onClick={() =>
                  void attempt(async () => {
                    setPreview(await api.resolvePack(preview.token, key));
                    setResolved(true);
                    setKey("");
                  })
                }
              >
                解析清单
              </button>
            </div>
            <p className="field-help">
              仅发送到 CurseForge 官方 API，本次使用后不保存。完整 mods ZIP 和
              Modrinth 包无需此 Key。
            </p>
          </div>
        )}
        {preview?.manual.length ? (
          <div className="manual-files">
            <b>需要手动下载 {preview.manual.length} 个文件</b>
            <p>
              作者限制第三方自动下载。请从下方官网页面下载，再选择文件进行哈希校验。
            </p>
            {preview.manual.map((f, i) => (
              <button
                className="text-button"
                key={f.path}
                onClick={() =>
                  void attempt(async () => {
                    await api.openPackLink(preview.token, i);
                  })
                }
              >
                {f.path.replace("mods/", "")}
                <ExternalLink size={12} />
              </button>
            ))}
            <button
              className="secondary small"
              disabled={pending}
              onClick={() =>
                void attempt(async () => {
                  const result = await api.pickPackFiles(preview.token);
                  if (result) setMatched(result.matched);
                })
              }
            >
              <FolderOpen size={15} />
              选择已下载文件 {matched > 0 ? `· 已匹配 ${matched} 个` : ""}
            </button>
          </div>
        ) : null}
        {error && (
          <div className="install-error" role="alert">
            <AlertCircle size={17} />
            <span>{error}</span>
          </div>
        )}
        <div className="install-bottom">
          <p>
            {preview
              ? "每次导入都会创建新实例，不覆盖已有游戏。"
              : "自动下载游戏、依赖库和所需 Java。"}
          </p>
          <button
            className="primary"
            disabled={!ready}
            onClick={() => void start()}
          >
            {pending ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Download size={17} />
            )}{" "}
            {preview ? "导入并安装" : "开始安装"}
          </button>
        </div>
      </section>
    </div>
  );
}
