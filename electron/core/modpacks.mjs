import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import AdmZip from "adm-zip";
import { safePath, safeId, atomicJSON, validFile } from "./utils.mjs";
import { jsonRequest, download, parallel } from "./network.mjs";
import { installProfile, validateInstall } from "./loaders.mjs";

const MiB = 1024 * 1024;
const MAX_ZIP = 512 * MiB,
  MAX_TOTAL = 4 * 1024 * MiB,
  MAX_ENTRY = 256 * MiB,
  MAX_FILES = 20000;
export function packPath(value) {
  safePath("/pack", value);
  const segments = value.replace(/\/$/, "").split("/");
  if (
    !segments.length ||
    segments.some(
      (s) =>
        !s ||
        s === "." ||
        /[<>"|?*\x00-\x1f]/.test(s) ||
        /[. ]$/.test(s) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s),
    )
  )
    throw new Error("整合包包含不兼容或不安全的路径：" + value);
  return segments.join("/");
}
function parsed(entry) {
  if (entry.header.size > 2 * MiB) throw new Error("整合包清单过大");
  return JSON.parse(entry.getData().toString("utf8"));
}
export async function inspectPack(file) {
  const st = await fs.stat(file);
  if (st.size > MAX_ZIP)
    throw new Error("ZIP 超过 512 MB，请拆分大型存档后重试。");
  const zip = new AdmZip(file);
  const entries = zip.getEntries();
  if (entries.length > MAX_FILES) throw new Error("ZIP 文件数量超过 20,000 个");
  let total = 0;
  const seen = new Set();
  for (const entry of entries) {
    const name = packPath(entry.entryName);
    const mode = (entry.attr >>> 16) & 0o170000;
    if (mode && ![0o100000, 0o040000].includes(mode))
      throw new Error("ZIP 不允许符号链接或特殊文件");
    if (seen.has(name.toLowerCase()))
      throw new Error("ZIP 包含重复或大小写冲突路径：" + name);
    seen.add(name.toLowerCase());
    total += entry.header.size;
    if (entry.header.size > MAX_ENTRY || total > MAX_TOTAL)
      throw new Error("ZIP 解压大小超出限制（单文件 256 MB / 合计 4 GB）");
  }
  // Accept an export wrapped in one top-level directory.
  const files = entries.filter(
    (e) =>
      !e.isDirectory &&
      !e.entryName.startsWith("__MACOSX/") &&
      !e.entryName.endsWith(".DS_Store"),
  );
  const first = files[0]?.entryName.split("/")[0];
  const prefix =
    first &&
    files.every((e) => e.entryName.startsWith(first + "/")) &&
    ![
      "mods",
      "config",
      "overrides",
      "client-overrides",
      ".minecraft",
      "minecraft",
    ].includes(first)
      ? first + "/"
      : "";
  const byName = new Map(
    files.map((e) => [e.entryName.slice(prefix.length), e]),
  );
  let format = "plain",
    name = path.basename(file).replace(/\.(zip|mrpack)$/i, ""),
    minecraft = "",
    loader = "vanilla",
    loaderVersion = "",
    manifest = null,
    overrides = "",
    downloadable = [];
  if (byName.has("modrinth.index.json")) {
    format = "modrinth";
    manifest = parsed(byName.get("modrinth.index.json"));
    if (
      manifest.formatVersion !== 1 ||
      manifest.game !== "minecraft" ||
      !Array.isArray(manifest.files)
    )
      throw new Error("不支持的 Modrinth 整合包格式");
    name = manifest.name || name;
    minecraft = manifest.dependencies?.minecraft;
    const deps = Object.entries(manifest.dependencies || {}).filter(
      ([k]) => k !== "minecraft",
    );
    if (deps.length > 1)
      throw new Error("整合包声明了多个加载器，无法确定启动方式");
    for (const [k, v] of deps) {
      loader = {
        "fabric-loader": "fabric",
        forge: "forge",
        neoforge: "neoforge",
      }[k];
      if (!loader) throw new Error("暂不支持整合包依赖：" + k);
      loaderVersion = v;
    }
    downloadable = manifest.files
      .filter((f) => f.env?.client !== "unsupported")
      .map((f) => {
        const dest = packPath(f.path);
        if (
          !Array.isArray(f.downloads) ||
          !f.downloads.length ||
          f.downloads.some((u) => new URL(u).protocol !== "https:")
        )
          throw new Error("整合包下载地址无效");
        if (
          !/^[a-f0-9]{40}$/i.test(f.hashes?.sha1) ||
          !/^[a-f0-9]{128}$/i.test(f.hashes?.sha512) ||
          !Number.isSafeInteger(f.fileSize) ||
          f.fileSize <= 0 ||
          f.fileSize > MAX_ENTRY
        )
          throw new Error("整合包文件缺少有效的哈希或大小");
        return {
          path: dest,
          urls: f.downloads,
          sha512: f.hashes.sha512,
          size: f.fileSize,
          optional: f.env?.client === "optional",
        };
      });
    overrides = "overrides";
  } else if (byName.has("manifest.json")) {
    manifest = parsed(byName.get("manifest.json"));
    if (
      manifest.manifestType !== "minecraftModpack" ||
      manifest.manifestVersion !== 1 ||
      !Array.isArray(manifest.files)
    )
      throw new Error("manifest.json 不是受支持的 CurseForge 整合包清单");
    format = "curseforge";
    name = manifest.name || name;
    minecraft = manifest.minecraft?.version;
    const primary =
      manifest.minecraft?.modLoaders?.find((l) => l.primary) ||
      manifest.minecraft?.modLoaders?.[0];
    if (primary) {
      const match = /^(forge|neoforge|fabric)-(.+)$/.exec(primary.id);
      if (!match) throw new Error("整合包加载器暂不支持：" + primary.id);
      [, loader, loaderVersion] = match;
    }
    overrides = packPath(manifest.overrides || "overrides");
    downloadable = manifest.files.map((f) => {
      if (
        !Number.isSafeInteger(f.projectID) ||
        f.projectID <= 0 ||
        !Number.isSafeInteger(f.fileID) ||
        f.fileID <= 0
      )
        throw new Error("CurseForge 文件 ID 无效");
      return {
        projectID: f.projectID,
        fileID: f.fileID,
        optional: f.required === false,
      };
    });
  } else if (byName.has("mmc-pack.json")) {
    format = "multimc";
    manifest = parsed(byName.get("mmc-pack.json"));
    minecraft = manifest.components?.find(
      (c) => c.uid === "net.minecraft",
    )?.version;
    for (const c of manifest.components || []) {
      if (["net.minecraft", "org.lwjgl", "org.lwjgl3"].includes(c.uid))
        continue;
      const type = {
        "net.minecraftforge": "forge",
        "net.neoforged": "neoforge",
        "net.fabricmc.fabric-loader": "fabric",
      }[c.uid];
      if (!type || loader !== "vanilla")
        throw new Error("MultiMC / Prism 实例包含暂不支持的组件：" + c.uid);
      loader = type;
      loaderVersion = c.version;
    }
    overrides = ".minecraft";
  } else {
    if (
      ![...byName.keys()].some((n) =>
        /^(?:\.?minecraft\/)?(?:mods|config|saves|resourcepacks|shaderpacks|defaultconfigs|kubejs|scripts)\//.test(
          n,
        ),
      )
    )
      throw new Error(
        "ZIP 中没有识别到游戏目录或整合包清单。请使用客户端整合包。",
      );
    overrides = [...byName.keys()].some((n) => n.startsWith(".minecraft/"))
      ? ".minecraft"
      : [...byName.keys()].some((n) => n.startsWith("minecraft/"))
        ? "minecraft"
        : "";
  }
  if (format !== "plain") validateInstall({ minecraft, loader, loaderVersion });
  const copies = [];
  for (const [n, e] of byName) {
    if (
      n === "modrinth.index.json" ||
      n === "manifest.json" ||
      n === "mmc-pack.json" ||
      n === "instance.cfg"
    )
      continue;
    let dest;
    if (overrides && n.startsWith(overrides + "/"))
      dest = n.slice(overrides.length + 1);
    else if (format === "modrinth" && n.startsWith("client-overrides/"))
      continue; // Applied last, below.
    else if (
      format === "plain" &&
      !overrides &&
      /^(mods|config|saves|resourcepacks|shaderpacks|defaultconfigs|kubejs|scripts|patchouli_books)\//.test(
        n,
      )
    )
      dest = n;
    else if (
      format === "plain" &&
      !overrides &&
      ["options.txt", "servers.dat"].includes(n)
    )
      dest = n;
    if (dest) copies.push({ entry: e.entryName, path: packPath(dest) });
  }
  if (format === "modrinth")
    for (const [n, e] of byName)
      if (n.startsWith("client-overrides/"))
        copies.push({ entry: e.entryName, path: packPath(n.slice(17)) });
  if (
    downloadable.length > MAX_FILES ||
    downloadable.reduce((n, f) => n + (f.size || 0), 0) > MAX_TOTAL
  )
    throw new Error("整合包下载清单超出限制");
  return {
    file,
    fingerprint: `${st.size}:${st.mtimeMs}`,
    name: String(name).slice(0, 80),
    format,
    minecraft,
    loader,
    loaderVersion,
    downloadable,
    copies,
    total,
    zip,
  };
}
export function packSummary(pack, token) {
  return {
    token,
    name: pack.name,
    format: pack.format,
    minecraft: pack.minecraft,
    loader: pack.loader,
    loaderVersion: pack.loaderVersion,
    files: pack.copies.length,
    downloads: pack.downloadable.length,
    optional: pack.downloadable.filter((f) => f.optional).length,
    size: pack.total,
    manual: pack.downloadable
      .filter((f) => f.manual)
      .map((f) => ({ path: f.path, url: f.page })),
  };
}
export async function resolveCurseForge(
  pack,
  key,
  { signal, request = jsonRequest } = {},
) {
  if (pack.format !== "curseforge" || pack.resolved) return pack;
  if (!key?.trim())
    throw new Error(
      "CurseForge 清单下载需要你自己的 API Key。也可以导入包含完整 mods 文件的普通 ZIP。",
    );
  const resolved = [];
  await parallel(
    pack.downloadable,
    async (f) => {
      const response = await request(
        `https://api.curseforge.com/v1/mods/${f.projectID}/files/${f.fileID}`,
        { signal, headers: { "x-api-key": key.trim() } },
      );
      const data = response.data;
      if (!data || data.id !== f.fileID || data.modId !== f.projectID)
        throw new Error("CurseForge 文件信息不匹配");
      if (
        !Number.isSafeInteger(data.fileLength) ||
        data.fileLength <= 0 ||
        data.fileLength > MAX_ENTRY
      )
        throw new Error("CurseForge 文件大小超出限制");
      const sha1 = data.hashes?.find((h) => h.algo === 1)?.value,
        md5 = data.hashes?.find((h) => h.algo === 2)?.value;
      if (!(
        /^[a-f0-9]{40}$/i.test(sha1 || "") || /^[a-f0-9]{32}$/i.test(md5 || "")
      ))
        throw new Error("CurseForge 文件缺少校验信息");
      if (packPath(data.fileName).includes("/"))
        throw new Error("CurseForge 文件名无效");
      const project = await request(
        `https://api.curseforge.com/v1/mods/${f.projectID}`,
        { signal, headers: { "x-api-key": key.trim() } },
      );
      const folder = { 6: "mods", 12: "resourcepacks", 6552: "shaderpacks" }[
        project.data?.classId
      ];
      if (!folder)
        throw new Error(
          "整合包包含无法自动放置的 CurseForge 项目：" + f.projectID,
        );
      const website = project.data?.links?.websiteUrl;
      if (
        !website ||
        new URL(website).protocol !== "https:" ||
        new URL(website).hostname !== "www.curseforge.com"
      )
        throw new Error("CurseForge 项目链接无效");
      resolved.push({
        ...f,
        path: folder + "/" + data.fileName,
        size: data.fileLength,
        sha1,
        md5,
        urls: data.downloadUrl ? [data.downloadUrl] : [],
        manual: !data.downloadUrl,
        page: website.replace(/\/$/, "") + `/files/${f.fileID}`,
      });
    },
    { signal, concurrency: 4 },
  );
  if (resolved.reduce((n, f) => n + f.size, 0) > MAX_TOTAL)
    throw new Error("整合包下载总大小超过 4 GB");
  return { ...pack, downloadable: resolved, resolved: true };
}
export async function matchManualFiles(pack, paths) {
  const additions = { ...pack.localFiles };
  for (const file of paths) {
    let found = false;
    for (const item of pack.downloadable.filter((f) => f.manual))
      if (await validFile(file, item)) {
        additions[item.path] = file;
        found = true;
        break;
      }
    if (!found)
      throw new Error(`文件不属于此整合包或校验失败：${path.basename(file)}`);
  }
  return { ...pack, localFiles: additions };
}
export async function importPack(
  manager,
  pack,
  options,
  { source = "official", signal, ensureJava, install = installProfile } = {},
) {
  const st = await fs.stat(pack.file);
  if (`${st.size}:${st.mtimeMs}` !== pack.fingerprint)
    throw new Error("ZIP 已更改，请重新选择文件");
  const request = validateInstall(
    pack.format === "plain"
      ? options
      : {
          minecraft: pack.minecraft,
          loader: pack.loader,
          loaderVersion: pack.loaderVersion,
        },
  );
  if (pack.format === "curseforge" && !pack.resolved)
    throw new Error("请先解析 CurseForge 下载清单");
  const files = pack.downloadable.filter(
    (f) => !f.optional || options.includeOptional,
  );
  const missing = files.filter((f) => f.manual && !pack.localFiles?.[f.path]);
  if (missing.length)
    throw new Error(
      `还需手动补齐 ${missing.length} 个禁止第三方自动下载的文件，请先选择已下载的文件。`,
    );
  const ids = new Set();
  for (const f of files) {
    const p = packPath(f.path).toLowerCase();
    if (ids.has(p)) throw new Error("下载清单含重复路径");
    ids.add(p);
  }
  const id = safeId("pack-" + randomUUID().slice(0, 12));
  const staging = path.join(manager.root, "imports", id),
    target = path.join(manager.root, "instances", id),
    versionDir = path.join(manager.root, "versions", id);
  let moved = false,
    committed = false;
  try {
    await fs.mkdir(staging, { recursive: true });
    let done = 0;
    const count = files.length + pack.copies.length;
    const report = (detail) =>
      manager.emit({
        phase: "modpack",
        version: id,
        detail,
        percent: Math.min(95, (done / Math.max(1, count)) * 95),
        files: done,
        totalFiles: count,
        bytes: 0,
        totalBytes: 0,
        speed: 0,
      });
    report("准备整合包文件");
    await parallel(
      files,
      async (item) => {
        const dest = safePath(staging, packPath(item.path));
        if (item.manual) {
          const local = pack.localFiles[item.path];
          if (!(await validFile(local, item)))
            throw new Error("手动文件校验失败：" + item.path);
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(local, dest);
        } else await download(item, dest, { signal });
        done++;
        report("下载整合包 · " + item.path);
      },
      { signal, concurrency: 6 },
    );
    for (const copy of pack.copies) {
      signal?.throwIfAborted();
      const dest = safePath(staging, copy.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const entry = pack.zip.getEntry(copy.entry);
      const data = entry.getData();
      if (data.length !== entry.header.size)
        throw new Error("ZIP 文件大小校验失败");
      await fs.writeFile(dest, data);
      done++;
      report("导入 · " + copy.path);
    }
    const name = (options.name || pack.name).trim().slice(0, 80) || pack.name;
    const record = await install(
      manager,
      {
        ...request,
        id,
        name,
        modpack: { format: pack.format, importedAt: new Date().toISOString() },
      },
      { source, signal, ensureJava, mark: false },
    );
    signal?.throwIfAborted();
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.rename(staging, target);
    moved = true;
    await atomicJSON(path.join(versionDir, "moss-installed.json"), record);
    committed = true;
    manager.emit({
      phase: "complete",
      detail: `${name} 导入完成`,
      percent: 100,
      version: id,
    });
    return record;
  } finally {
    await fs.rm(staging, { force: true, recursive: true });
    if (!committed) {
      await fs.rm(versionDir, { force: true, recursive: true });
      if (moved) await fs.rm(target, { force: true, recursive: true });
    }
  }
}
