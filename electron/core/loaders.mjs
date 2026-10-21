import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { MinecraftFolder } from "@xmcl/core";
import {
  createModernForgeInstallWorkflow,
  createNodeInstallRuntime,
  executeInstallWorkflow,
  executeInstallManifest,
  resolveOptifineInstallManifest,
} from "@xmcl/installer";
import { httpsFetch, jsonRequest, download, parallel } from "./network.mjs";
import {
  safeId,
  safePath,
  atomicJSON,
  readJSON,
  libraryFiles,
  validFile,
} from "./utils.mjs";

export const LOADERS = ["vanilla", "fabric", "forge", "neoforge", "optifine"];
const NAMES = {
  vanilla: "原版",
  fabric: "Fabric",
  forge: "Forge",
  neoforge: "NeoForge",
  optifine: "OptiFine",
};
const cache = new Map();
async function textRequest(url, signal) {
  const res = await httpsFetch(url, {
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
      : AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`获取组件列表失败（HTTP ${res.status}）`);
  return res.text();
}
const sortVersions = (a, b) =>
  b.version.localeCompare(a.version, "en", { numeric: true });
export function neoMinecraft(version) {
  const parts = version.split(".");
  return Number(parts[0]) < 26
    ? `1.${parts[0]}.${parts[1]}`.replace(/\.0$/, "")
    : `${parts[0]}.${parts[1]}.${parts[2]}`.replace(/\.0$/, "");
}
export async function loaderVersions(
  minecraft,
  loader,
  { source = "official", signal } = {},
) {
  safeId(minecraft);
  if (!LOADERS.includes(loader)) throw new Error("未知加载器");
  if (loader === "vanilla") return [];
  const key = [minecraft, loader, source].join("/");
  if (cache.get(key)?.expires > Date.now()) return cache.get(key).items;
  let items;
  if (loader === "fabric") {
    const data = await jsonRequest(
      `https://meta.fabricmc.net/v2/versions/loader/${minecraft}`,
      { signal },
    );
    items = data.map((v) => ({
      version: v.loader.version,
      label: v.loader.version + (v.loader.stable ? " · 稳定版" : " · 预览版"),
    }));
  } else if (loader === "forge") {
    // The official Maven listing also contains archived versions; filter by exact Minecraft prefix.
    try {
      const xml = await textRequest(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml",
        signal,
      );
      items = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
        .map((m) => m[1])
        .filter((v) => v.startsWith(minecraft + "-"))
        .map((v) => ({
          version: v.slice(minecraft.length + 1),
          label: v.slice(minecraft.length + 1),
        }));
    } catch (e) {
      if (source !== "bmclapi" || signal?.aborted) throw e;
      const data = await jsonRequest(
        `https://bmclapi2.bangbang93.com/forge/minecraft/${minecraft}`,
        { signal },
      );
      items = data.map((v) => ({ version: v.version, label: v.version }));
    }
    items.sort(sortVersions);
  } else if (loader === "neoforge") {
    const xml = await textRequest(
      "https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml",
      signal,
    );
    items = [...xml.matchAll(/<version>([^<]+)<\/version>/g)]
      .map((m) => m[1])
      .filter((v) => neoMinecraft(v) === minecraft)
      .map((version) => ({ version, label: version }))
      .sort(sortVersions);
    // NeoForge 1.20.1 was published under the original forge artifact.
    if (minecraft === "1.20.1") {
      const old = await textRequest(
        "https://maven.neoforged.net/releases/net/neoforged/forge/maven-metadata.xml",
        signal,
      );
      items = [...old.matchAll(/<version>([^<]+)<\/version>/g)]
        .map((m) => m[1])
        .filter((v) => v.startsWith("1.20.1-"))
        .map((version) => ({ version, label: version.replace("1.20.1-", "") }))
        .sort(sortVersions);
    }
  } else {
    const data = await jsonRequest(
      `https://bmclapi2.bangbang93.com/optifine/${minecraft}`,
      { signal },
    );
    items = data.map((v) => ({
      version: `${v.type}_${v.patch}`,
      label: `${v.type} ${v.patch}`,
      type: v.type,
      patch: v.patch,
    }));
  }
  items = [...new Map(items.map((v) => [v.version, v])).values()];
  cache.set(key, { items, expires: Date.now() + 300000 });
  return items;
}
export function validateInstall(request) {
  if (!request || typeof request !== "object") throw new Error("安装配置无效");
  safeId(request.minecraft);
  const loader = request.loader || "vanilla";
  if (!LOADERS.includes(loader)) throw new Error("不支持此加载器：" + loader);
  if (loader !== "vanilla") safeId(request.loaderVersion);
  if (request.id) safeId(request.id);
  return { ...request, loader };
}
export async function installProfile(
  manager,
  input,
  { source = "official", signal, ensureJava, mark = true } = {},
) {
  const request = validateInstall(input);
  const { minecraft, loader, loaderVersion } = request;
  let selected;
  if (loader !== "vanilla") {
    selected = (
      await loaderVersions(minecraft, loader, { source, signal })
    ).find((v) => v.version === loaderVersion);
    if (!selected)
      throw new Error(
        `${NAMES[loader]} ${loaderVersion} 不支持 Minecraft ${minecraft}，请重新选择组件版本。`,
      );
  }
  const id = safeId(
    request.id ||
      (loader === "vanilla"
        ? minecraft
        : `${minecraft}-${loader}-${loaderVersion}`),
  );
  const dir = path.join(manager.root, "versions", id);
  const previous = await readJSON(path.join(dir, "moss-installed.json"), null);
  // A failed repair must not expose an incomplete installation as ready.
  await fs.rm(path.join(dir, "moss-installed.json"), { force: true });
  try {
    await manager.install(minecraft, { source, signal });
    const base = await manager.metadata(minecraft);
    if (id !== minecraft) {
      manager.emit({
        phase: "loader",
        detail: `安装 ${NAMES[loader]} ${loaderVersion || ""}`,
        percent: 0,
        version: id,
        files: 0,
        totalFiles: 0,
        bytes: 0,
        totalBytes: 0,
        speed: 0,
      });
      if (loader === "vanilla") {
        await atomicJSON(path.join(dir, `${id}.json`), {
          id,
          inheritsFrom: minecraft,
        });
      } else if (loader === "fabric") {
        const meta = await jsonRequest(
          `https://meta.fabricmc.net/v2/versions/loader/${minecraft}/${loaderVersion}/profile/json`,
          { signal },
        );
        if (meta.inheritsFrom !== minecraft || !meta.mainClass)
          throw new Error("Fabric 返回了不匹配的启动配置");
        await atomicJSON(path.join(dir, `${id}.json`), { ...meta, id });
      } else {
        const java = await ensureJava(
          base.javaVersion?.majorVersion || 8,
          signal,
        );
        const runtime = createNodeInstallRuntime({
          signal,
          download: async (files) => {
            let done = 0;
            await parallel(
              files,
              async (file) => {
                signal?.throwIfAborted();
                const checksum = file.checksum
                  ? { [file.checksum.algorithm]: file.checksum.value }
                  : {};
                const item = {
                  urls: file.urls,
                  size: file.size > 0 ? file.size : undefined,
                  ...checksum,
                };
                if (!file.urls.length && (await validFile(file.path, item)))
                  return;
                if (file.replace) await fs.rm(file.path, { force: true });
                await download(item, file.path, { source, signal });
                manager.emit({
                  phase: "loader",
                  detail: `${NAMES[loader]} · ${path.basename(file.path)}`,
                  percent: Math.min(
                    95,
                    (++done / Math.max(1, files.length)) * 95,
                  ),
                  files: done,
                  totalFiles: files.length,
                });
              },
              { signal, concurrency: 6 },
            );
          },
          runJava: (command) => runProcessor(command, signal, manager.log),
        });
        const onEvent = (e) => {
          signal?.throwIfAborted();
          if (e.type === "task-start" && e.task.type === "java")
            manager.emit({
              phase: "loader",
              detail: `${NAMES[loader]} 正在处理游戏文件，首次安装可能需要几分钟…`,
              percent: 65,
              files: 0,
              totalFiles: 0,
            });
        };
        if (loader === "optifine") {
          const installer = path.join(
            manager.root,
            "installers",
            `OptiFine-${minecraft}-${loaderVersion}.jar`,
          );
          await download(
            {
              url: `https://bmclapi2.bangbang93.com/optifine/${minecraft}/${selected.type}/${selected.patch}`,
            },
            installer,
            { signal },
          );
          const { plan } = await resolveOptifineInstallManifest(
            installer,
            manager.root,
            { versionId: id, inheritsFrom: minecraft, java: java.path, signal },
          );
          for (const task of plan.tasks)
            if (task.type === "java")
              for (const output of task.outputs)
                await fs.mkdir(path.dirname(output.path), { recursive: true });
          await executeInstallManifest(plan, runtime, { signal, onEvent });
        } else {
          const artifact =
            loader === "forge"
              ? `${minecraft}-${loaderVersion}`
              : loaderVersion;
          const project =
            loader === "forge" || minecraft === "1.20.1" ? "forge" : "neoforge";
          const host =
            loader === "forge"
              ? "https://maven.minecraftforge.net/net/minecraftforge"
              : "https://maven.neoforged.net/releases/net/neoforged";
          const url = `${host}/${project}/${artifact}/${project}-${artifact}-installer.jar`;
          const sha1 = (await textRequest(url + ".sha1", signal))
            .trim()
            .split(/\s+/)[0];
          if (!/^[a-f0-9]{40}$/i.test(sha1))
            throw new Error("安装器校验信息无效");
          const workflow = createModernForgeInstallWorkflow({
            id: loader,
            minecraft: new MinecraftFolder(manager.root),
            minecraftVersion: minecraft,
            artifactVersion: artifact,
            java: java.path,
            side: "client",
            installer: {
              path: path.join(
                manager.root,
                "installers",
                `${loader}-${artifact}.jar`,
              ),
              urls: [url],
              checksum: { algorithm: "sha1", value: sha1 },
              validator: "zip",
            },
            installOptions: { versionId: id, inheritsFrom: minecraft, signal },
          });
          await executeInstallWorkflow(workflow, runtime, { signal, onEvent });
        }
      }
      // Fabric/OptiFine profiles use Maven coordinates; generated Forge libraries may have empty URLs.
      const libs = libraryFiles(await manager.metadata(id));
      await parallel(
        libs,
        async (lib) => {
          const dest = safePath(path.join(manager.root, "libraries"), lib.path);
          if (await validFile(dest, lib)) return;
          if (!lib.url) throw new Error("安装处理器未生成依赖：" + lib.path);
          await download(lib, dest, { source, signal });
        },
        { signal },
      );
    }
    signal?.throwIfAborted();
    const record = {
      id,
      type: base.type,
      java: base.javaVersion?.majorVersion || 8,
      arch: process.arch,
      installedAt: new Date().toISOString(),
      minecraft,
      loader,
      loaderVersion: loader === "vanilla" ? undefined : loaderVersion,
      name:
        request.name ||
        previous?.name ||
        (loader === "vanilla"
          ? `Minecraft ${minecraft}`
          : `${NAMES[loader]} ${minecraft}`),
      modpack: request.modpack || previous?.modpack,
    };
    if (mark) {
      await atomicJSON(path.join(dir, "moss-installed.json"), record);
      manager.emit({
        phase: "complete",
        percent: 100,
        version: id,
        detail: `${record.name} 已安装，可以出发了`,
      });
    }
    return record;
  } catch (e) {
    if (id !== minecraft)
      await fs.rm(path.join(dir, "moss-installed.json"), { force: true });
    throw e;
  }
}
export function runProcessor(command, signal, log = () => {}) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: { ...process.env, ...command.env },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    let tail = "";
    const capture = (b) => {
      tail = (tail + b.toString()).slice(-6000);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    let killTimer;
    const abort = () => {
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 3000);
    };
    const timeout = setTimeout(abort, 10 * 60 * 1000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const clean = () => {
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", abort);
    };
    child.once("error", (e) => {
      clean();
      reject(e);
    });
    child.once("close", (code) => {
      clean();
      if (signal?.aborted) reject(signal.reason);
      else if (code !== 0) {
        log(tail);
        reject(new Error("组件安装处理器失败，请查看启动日志。"));
      } else resolve();
    });
  });
}
