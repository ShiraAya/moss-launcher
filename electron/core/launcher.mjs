import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import {
  MANIFEST_URL,
  safeId,
  safePath,
  atomicJSON,
  readJSON,
  libraryFiles,
  context,
  expandArgs,
  mergeVersion,
} from "./utils.mjs";
import { download, jsonRequest, parallel } from "./network.mjs";
import { GameLogDecoder } from "./logs.mjs";

export class GameManager {
  constructor(root, { emit = () => {}, log = () => {} } = {}) {
    this.root = root;
    this.emit = emit;
    this.log = log;
  }
  async manifest(source = "official", signal) {
    try {
      const m = await jsonRequest(MANIFEST_URL, { source, signal });
      if (!m.versions?.length) throw new Error("版本列表为空");
      await atomicJSON(path.join(this.root, "manifest-cache.json"), m);
      return { ...m, cached: false };
    } catch (e) {
      signal?.throwIfAborted();
      const cache = await readJSON(
        path.join(this.root, "manifest-cache.json"),
        null,
      );
      if (cache) return { ...cache, cached: true };
      throw new Error("无法获取游戏版本，请检查网络或切换下载源。" + e.message);
    }
  }
  async installed() {
    let names;
    try {
      names = await fs.readdir(path.join(this.root, "versions"));
    } catch {
      return [];
    }
    const list = [];
    for (const id of names) {
      try {
        safeId(id);
        const record = await readJSON(
          path.join(this.root, "versions", id, "moss-installed.json"),
          null,
        );
        if (record) {
          const meta = await this.metadata(id);
          const client = safeId(meta.clientVersion || id);
          await fs.access(
            path.join(this.root, "versions", client, `${client}.jar`),
          );
          list.push(record);
        }
      } catch {}
    }
    return list.sort((a, b) => b.installedAt.localeCompare(a.installedAt));
  }
  async metadata(id, seen = new Set()) {
    safeId(id);
    if (seen.has(id) || seen.size > 12) throw new Error("版本继承关系无效");
    seen.add(id);
    const meta = await readJSON(
      path.join(this.root, "versions", id, `${id}.json`),
    );
    return meta.inheritsFrom
      ? mergeVersion(await this.metadata(meta.inheritsFrom, seen), meta)
      : { ...meta, clientVersion: meta.id || id };
  }
  async install(id, { source = "official", signal } = {}) {
    safeId(id);
    this.emit({
      phase: "metadata",
      detail: "获取游戏清单",
      percent: 0,
      version: id,
    });
    const manifest = await this.manifest(source, signal);
    signal?.throwIfAborted();
    const version = manifest.versions.find((v) => v.id === id);
    if (!version) throw new Error("此版本不在官方清单中");
    const base = path.join(this.root, "versions", id);
    await fs.rm(path.join(base, "moss-installed.json"), { force: true });
    const metaPath = path.join(base, `${id}.json`);
    await download(version, metaPath, { source, signal });
    const meta = await readJSON(metaPath);
    if (!meta.arguments || !meta.downloads?.client)
      throw new Error("目前支持 1.13 及之后的原版 Java 版，请选择较新的版本。");
    const libs = libraryFiles(meta);
    if (
      process.arch === "arm64" &&
      libs.some((l) => l.native && !l.path.includes("arm64"))
    )
      throw new Error(
        "此版本缺少 ARM64 原生库，请使用 1.19 及之后版本或在 Intel 设备上启动。",
      );
    const indexPath = safePath(
      this.root,
      `assets/indexes/${safeId(meta.assetIndex.id)}.json`,
    );
    await download(meta.assetIndex, indexPath, { source, signal });
    const index = await readJSON(indexPath);
    const jobs = [
      { ...meta.downloads.client, dest: path.join(base, `${id}.jar`) },
      ...libs.map((l) => ({
        ...l,
        dest: safePath(path.join(this.root, "libraries"), l.path),
      })),
    ];
    if (meta.logging?.client?.file) {
      const l = meta.logging.client.file;
      jobs.push({
        ...l,
        dest: safePath(path.join(this.root, "assets/log_configs"), l.id),
      });
    }
    for (const asset of Object.values(index.objects)) {
      if (!/^[a-f0-9]{40}$/.test(asset.hash))
        throw new Error("资源索引含有无效哈希");
      const relative = `${asset.hash.slice(0, 2)}/${asset.hash}`;
      jobs.push({
        url: `https://resources.download.minecraft.net/${relative}`,
        sha1: asset.hash,
        size: asset.size,
        dest: path.join(this.root, "assets/objects", relative),
      });
    }
    const unique = [...new Map(jobs.map((j) => [j.dest, j])).values()];
    let done = 0,
      bytes = 0,
      completedBytes = 0;
    const totalBytes = unique.reduce((n, j) => n + (j.size || 0), 0);
    const started = Date.now();
    const report = (detail) =>
      this.emit({
        phase: "download",
        version: id,
        detail,
        percent: Math.min(99, (completedBytes / Math.max(1, totalBytes)) * 100),
        files: done,
        totalFiles: unique.length,
        bytes,
        totalBytes,
        speed: bytes / Math.max(1, (Date.now() - started) / 1000),
      });
    await parallel(
      unique,
      async (job) => {
        await download(job, job.dest, {
          source,
          signal,
          onBytes: (n) => {
            bytes += n;
            report(path.basename(job.dest));
          },
        });
        done++;
        completedBytes += job.size || 0;
        report(path.basename(job.dest));
      },
      { signal },
    );
    if (index.virtual || index.map_to_resources) {
      for (const [name, asset] of Object.entries(index.objects)) {
        signal?.throwIfAborted();
        const src = path.join(
          this.root,
          "assets/objects",
          asset.hash.slice(0, 2),
          asset.hash,
        );
        const dest = safePath(
          index.map_to_resources
            ? path.join(this.root, "instances", id, "resources")
            : path.join(this.root, "assets/virtual", meta.assetIndex.id),
          name,
        );
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(src, dest);
      }
    }
    signal?.throwIfAborted();
    const record = {
      id,
      type: meta.type,
      installedAt: new Date().toISOString(),
      java: meta.javaVersion?.majorVersion || 8,
      arch: process.arch,
    };
    await atomicJSON(path.join(base, "moss-installed.json"), record);
    this.emit({
      phase: "complete",
      version: id,
      detail: "安装完成，可以出发了",
      percent: 100,
      files: done,
      totalFiles: unique.length,
      bytes,
      totalBytes,
    });
    return record;
  }
  async prepare(id, settings, account, java) {
    const meta = await this.metadata(id);
    const ctx = context(process.platform, java.arch);
    const base = path.join(this.root, "versions", safeId(id));
    const natives = path.join(base, `natives-${process.platform}-${java.arch}`);
    const gameDir = path.join(this.root, "instances", id);
    await fs.mkdir(gameDir, { recursive: true });
    const forgeLike = meta.libraries.some((l) =>
      /^net\.(minecraftforge|neoforged):/.test(l.name),
    );
    if (process.platform === "darwin" && forgeLike) {
      const config = path.join(gameDir, "config/fml.toml");
      await fs.mkdir(path.dirname(config), { recursive: true });
      let original = "";
      try {
        original = await fs.readFile(config, "utf8");
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      const value = `earlyWindowControl = ${settings.macCompatibility === false}`;
      const next = /^earlyWindowControl\s*=.*$/m.test(original)
        ? original.replace(/^earlyWindowControl\s*=.*$/m, value)
        : value + "\n" + original;
      if (original !== next) {
        if (original)
          await fs
            .writeFile(config + ".moss-backup", original, { flag: "wx" })
            .catch((e) => {
              if (e.code !== "EEXIST") throw e;
            });
        await fs.writeFile(config, next);
      }
      if (settings.macCompatibility !== false)
        this.log("macOS 图形兼容模式：关闭 Forge / NeoForge 早期加载窗口。");
    }
    await fs.rm(natives, { force: true, recursive: true });
    await fs.mkdir(natives, { recursive: true });
    const libs = libraryFiles(meta, ctx);
    for (const lib of libs) {
      const jar = safePath(path.join(this.root, "libraries"), lib.path);
      try {
        await fs.access(jar);
      } catch {
        throw new Error("游戏文件缺失，请在版本管理中修复此版本。");
      }
      if (lib.native) {
        const zip = new AdmZip(jar);
        for (const entry of zip.getEntries()) {
          if (
            entry.isDirectory ||
            entry.entryName.startsWith("META-INF/") ||
            (lib.exclude || []).some((x) => entry.entryName.startsWith(x))
          )
            continue;
          if (!/\.(dll|dylib|jnilib|so(?:\.\d+)*)$/.test(entry.entryName))
            continue;
          const dest = safePath(natives, entry.entryName);
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, entry.getData());
        }
      }
    }
    const classpath = [
      ...libs
        .filter((l) => l.classpath)
        .map((l) => safePath(path.join(this.root, "libraries"), l.path)),
      path.join(
        this.root,
        "versions",
        safeId(meta.clientVersion),
        `${meta.clientVersion}.jar`,
      ),
    ].join(path.delimiter);
    const vars = {
      auth_player_name: account.name,
      version_name: meta.clientVersion,
      game_directory: gameDir,
      assets_root: path.join(this.root, "assets"),
      assets_index_name: meta.assetIndex.id,
      auth_uuid: account.id,
      auth_access_token: account.accessToken || "0",
      auth_xuid: account.xuid || "",
      clientid: settings.microsoftClientId || "",
      user_type: account.type === "microsoft" ? "msa" : "legacy",
      version_type: meta.type,
      natives_directory: natives,
      launcher_name: "Moss",
      launcher_version: "0.2.0",
      classpath,
      classpath_separator: path.delimiter,
      library_directory: path.join(this.root, "libraries"),
      resolution_width: 1280,
      resolution_height: 800,
      user_properties: "{}",
    };
    const jvm = expandArgs(meta.arguments.jvm, vars, ctx);
    const game = expandArgs(meta.arguments.game, vars, ctx);
    const args = [`-Xms512M`, `-Xmx${settings.memoryMB}M`, ...jvm];
    if (
      process.platform === "darwin" &&
      forgeLike &&
      settings.macCompatibility !== false
    )
      args.push("-Dfml.earlyprogresswindow=false");
    if (meta.logging?.client) {
      const logging = meta.logging.client;
      args.push(
        logging.argument.replace(
          "${path}",
          safePath(path.join(this.root, "assets/log_configs"), logging.file.id),
        ),
      );
    }
    args.push(meta.mainClass, ...game);
    return { args, cwd: gameDir };
  }
  async launch(id, settings, account, java, onExit) {
    const { args, cwd } = await this.prepare(id, settings, account, java);
    // Java argument files avoid the Windows 32k command-line limit and keep tokens out of the process list.
    const argsPath = path.join(this.root, "versions", id, "launch.args");
    let spawnArgs = args;
    if (java.major >= 9) {
      const quoted = args
        .map(
          (a) =>
            '"' +
            String(a)
              .replace(/\\/g, "\\\\")
              .replace(/"/g, '\\"')
              .replace(/\n/g, "\\n")
              .replace(/\r/g, "\\r") +
            '"',
        )
        .join("\n");
      await fs.writeFile(argsPath, quoted, { mode: 0o600 });
      spawnArgs = ["@" + argsPath];
    }
    this.log(
      `启动 Minecraft ${id} · Java ${java.version} · ${java.arch} · ${settings.memoryMB} MB`,
    );
    const child = spawn(java.path, spawnArgs, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });
    for (const stream of [child.stdout, child.stderr]) {
      const decoder = new GameLogDecoder(this.log, account.accessToken);
      stream.on("data", (data) => decoder.write(data));
      stream.on("end", () => decoder.end());
    }
    await new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    }).catch(async (e) => {
      await fs.rm(argsPath, { force: true });
      throw new Error("无法启动 Java：" + e.message);
    });
    child.once("exit", async (code, signal) => {
      await fs.rm(argsPath, { force: true });
      this.log(`游戏已退出（${signal || code}）`);
      onExit?.({ code, signal });
    });
    return child;
  }
}
