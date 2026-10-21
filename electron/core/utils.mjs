import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";

export const MANIFEST_URL =
  "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
export const context = (platform = process.platform, arch = process.arch) => ({
  os: { darwin: "osx", win32: "windows", linux: "linux" }[platform],
  arch,
  version: os.release(),
  features: { has_custom_resolution: true },
});
export function safeId(id) {
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(id))
    throw new Error("无效的版本名称");
  return id;
}
export function safePath(root, relative) {
  if (
    typeof relative !== "string" ||
    relative.includes("\\") ||
    relative.includes("\0") ||
    relative.includes(":") ||
    path.posix.isAbsolute(relative) ||
    relative.split("/").includes("..")
  )
    throw new Error("文件路径不安全");
  const dest = path.resolve(root, relative);
  if (
    dest !== path.resolve(root) &&
    !dest.startsWith(path.resolve(root) + path.sep)
  )
    throw new Error("文件超出目标目录");
  return dest;
}
export async function atomicJSON(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}
export async function readJSON(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (e) {
    if (fallback !== undefined) return fallback;
    throw e;
  }
}
export async function digest(file, algorithm = "sha1") {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
export async function validFile(file, item) {
  try {
    const st = await fs.stat(file);
    if (item.size && st.size !== item.size) return false;
    const algorithm = ["sha512", "sha256", "sha1", "md5"].find((a) => item[a]);
    const hash = algorithm && item[algorithm];
    if (!hash) return st.size > 0;
    return (await digest(file, algorithm)) === hash.toLowerCase();
  } catch {
    return false;
  }
}
export function offlineUUID(name) {
  const b = createHash("md5")
    .update("OfflinePlayer:" + name)
    .digest();
  b[6] = (b[6] & 15) | 48;
  b[8] = (b[8] & 63) | 128;
  return b.toString("hex");
}
export function allowed(rules, ctx = context()) {
  if (!rules) return true;
  let result = false;
  for (const r of rules) {
    const arch =
      { x64: "x86_64", ia32: "x86", arm64: "aarch64" }[ctx.arch] || ctx.arch;
    const matches =
      (!r.os?.name || r.os.name === ctx.os) &&
      (!r.os?.arch ||
        [ctx.arch, arch, ctx.arch === "x64" ? "amd64" : ""].includes(
          r.os.arch,
        )) &&
      (!r.os?.version || new RegExp(r.os.version).test(ctx.version)) &&
      Object.entries(r.features || {}).every(
        ([k, v]) => (ctx.features?.[k] ?? false) === v,
      );
    if (matches) result = r.action === "allow";
  }
  return result;
}
export function libraryFiles(meta, ctx = context()) {
  const out = [];
  for (const lib of meta.libraries || []) {
    if (!allowed(lib.rules, ctx)) continue;
    // Modern metadata includes native jars for several architectures under the same OS rule.
    const classifier = lib.name.split(":")[3] || "";
    if (classifier.startsWith("natives-")) {
      const arch = classifier.includes("arm64")
        ? "arm64"
        : classifier.includes("x86") && !classifier.includes("x86_64")
          ? "ia32"
          : "x64";
      if (arch !== ctx.arch) continue;
    }
    const artifact =
      lib.downloads?.artifact || (!lib.downloads && mavenArtifact(lib));
    if (artifact)
      out.push({
        ...artifact,
        native: classifier.startsWith("natives-"),
        classpath: true,
      });
    if (lib.natives?.[ctx.os]) {
      const key = lib.natives[ctx.os].replace(
        "${arch}",
        ctx.arch === "ia32" ? "32" : "64",
      );
      const native = lib.downloads?.classifiers?.[key];
      if (!native) throw new Error("版本缺少本机原生库：" + lib.name);
      out.push({
        ...native,
        native: true,
        classpath: false,
        exclude: lib.extract?.exclude || [],
      });
    }
  }
  return [...new Map(out.map((x) => [x.path, x])).values()];
}
export function mavenArtifact(lib) {
  const [coordinate, extension = "jar"] = lib.name.split("@");
  const [group, name, version, classifier] = coordinate.split(":");
  if (!group || !name || !version) throw new Error("无效的 Maven 坐标");
  const relative = `${group.replaceAll(".", "/")}/${name}/${version}/${name}-${version}${classifier ? "-" + classifier : ""}.${extension}`;
  safePath("/libraries", relative);
  const host = (lib.url || "https://libraries.minecraft.net/").replace(
    /^http:/,
    "https:",
  );
  return {
    path: relative,
    url: host.replace(/\/$/, "") + "/" + relative,
    sha1: lib.sha1,
    size: lib.size,
  };
}
export function mergeVersion(parent, child) {
  const key = (lib) => {
    const p = lib.name.split(":");
    return [p[0], p[1], p[3] || ""].join(":");
  };
  const overrides = new Set((child.libraries || []).map(key));
  return {
    ...parent,
    ...child,
    clientVersion: parent.clientVersion || parent.id,
    libraries: [
      ...(parent.libraries || []).filter((l) => !overrides.has(key(l))),
      ...(child.libraries || []),
    ],
    arguments: {
      game: [
        ...(parent.arguments?.game || []),
        ...(child.arguments?.game || []),
      ],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    },
  };
}
export function sourceURLs(url, source) {
  const u = new URL(url);
  if (u.protocol !== "https:") throw new Error("下载地址必须使用 HTTPS");
  if (source !== "bmclapi") return [url];
  const host = u.hostname;
  let mirror;
  if (
    [
      "piston-meta.mojang.com",
      "piston-data.mojang.com",
      "launchermeta.mojang.com",
      "launcher.mojang.com",
    ].includes(host)
  )
    mirror = "https://bmclapi2.bangbang93.com" + u.pathname + u.search;
  else if (host === "libraries.minecraft.net")
    mirror = "https://bmclapi2.bangbang93.com/maven" + u.pathname;
  else if (["maven.minecraftforge.net", "maven.fabricmc.net"].includes(host))
    mirror = "https://bmclapi2.bangbang93.com/maven" + u.pathname;
  else if (host === "resources.download.minecraft.net")
    mirror = "https://bmclapi2.bangbang93.com/assets" + u.pathname;
  return mirror ? [mirror, url] : [url];
}
export function expandArgs(args, variables, ctx = context()) {
  return (args || [])
    .flatMap((a) =>
      typeof a === "string"
        ? [a]
        : allowed(a.rules, ctx)
          ? [].concat(a.value)
          : [],
    )
    .map((a) =>
      a.replace(/\$\{([^}]+)\}/g, (_, k) => {
        if (!(k in variables)) throw new Error("暂不支持启动参数：" + k);
        return String(variables[k]);
      }),
    );
}
