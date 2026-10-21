import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import AdmZip from "adm-zip";
import { x as untar } from "tar";
import { download, jsonRequest } from "./network.mjs";
import { safePath } from "./utils.mjs";
const exec = promisify(execFile);

export async function probeJava(binary) {
  try {
    const { stdout, stderr } = await exec(
      binary,
      ["-XshowSettings:properties", "-version"],
      { timeout: 8000, windowsHide: true, maxBuffer: 128 * 1024 },
    );
    const output = stdout + stderr;
    const version = output.match(
      /(?:java\.version\s*=\s*|version ")([\d._+\-a-zA-Z]+)/,
    )?.[1];
    if (!version) return null;
    const major = Number(
      version.startsWith("1.") ? version.split(".")[1] : version.split(".")[0],
    );
    const a = output.match(/os\.arch\s*=\s*(\S+)/)?.[1];
    const arch = /aarch64|arm64/.test(a)
      ? "arm64"
      : /amd64|x86_64/.test(a)
        ? "x64"
        : "ia32";
    return { path: binary, version, major, arch };
  } catch {
    return null;
  }
}
async function findJava(root, depth = 5) {
  if (depth < 0) return [];
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (
      entry.isFile() &&
      /^java(?:\.exe)?$/.test(entry.name) &&
      path.basename(root) === "bin"
    )
      found.push(full);
    else if (entry.isDirectory())
      found.push(...(await findJava(full, depth - 1)));
  }
  return found;
}
export async function detectJava(runtimeDir, custom = "") {
  const candidates = [
    custom,
    process.env.JAVA_HOME &&
      path.join(
        process.env.JAVA_HOME,
        "bin",
        process.platform === "win32" ? "java.exe" : "java",
      ),
  ];
  for (const dir of (process.env.PATH || "").split(path.delimiter))
    candidates.push(
      path.join(dir, process.platform === "win32" ? "java.exe" : "java"),
    );
  const roots =
    process.platform === "darwin"
      ? [
          "/Library/Java/JavaVirtualMachines",
          path.join(os.homedir(), "Library/Java/JavaVirtualMachines"),
          "/opt/homebrew/opt/openjdk/libexec/openjdk.jdk",
          "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk",
        ]
      : process.platform === "win32"
        ? [
            path.join(process.env.ProgramFiles || "C:\\Program Files", "Java"),
            path.join(
              process.env.ProgramFiles || "C:\\Program Files",
              "Eclipse Adoptium",
            ),
            path.join(
              process.env.ProgramFiles || "C:\\Program Files",
              "Microsoft",
            ),
          ]
        : ["/usr/lib/jvm"];
  for (const root of [runtimeDir, ...roots])
    candidates.push(...(await findJava(root)));
  const results = await Promise.all(
    [...new Set(candidates.filter(Boolean))].map(probeJava),
  );
  return results.filter(Boolean).sort((a, b) => b.major - a.major);
}
export async function installJava(major, runtimeDir, { signal, emit }) {
  if (![8, 17, 21, 25].includes(major))
    throw new Error(`请在设置中选择 Java ${major}，自动安装暂不支持此版本。`);
  const platform = { darwin: "mac", win32: "windows", linux: "linux" }[
    process.platform
  ];
  const arch = { arm64: "aarch64", x64: "x64" }[process.arch];
  if (!platform || !arch) throw new Error("当前平台需要手动指定 Java");
  emit({ phase: "java", detail: `正在获取 Java ${major}`, percent: 0 });
  const list = await jsonRequest(
    `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${platform}&vendor=eclipse`,
    { signal },
  );
  const pkg = list[0]?.binary?.package;
  if (!pkg)
    throw new Error("没有找到对应的 Java 运行环境，请在设置中选择 Java");
  const archive = safePath(runtimeDir, pkg.name);
  let bytes = 0;
  await download(
    { url: pkg.link, sha256: pkg.checksum, size: pkg.size },
    archive,
    {
      signal,
      onBytes: (n) => {
        bytes += n;
        emit({
          phase: "java",
          detail: `正在下载 Java ${major}`,
          percent: Math.min(95, (bytes / pkg.size) * 95),
          bytes,
          totalBytes: pkg.size,
        });
      },
    },
  );
  const target = path.join(runtimeDir, `temurin-${major}-${process.arch}`),
    temp = target + ".extracting";
  await fs.rm(temp, { recursive: true, force: true });
  await fs.mkdir(temp, { recursive: true });
  try {
    signal?.throwIfAborted();
    if (pkg.name.endsWith(".zip")) {
      const zip = new AdmZip(archive);
      for (const entry of zip.getEntries()) {
        signal?.throwIfAborted();
        const dest = safePath(temp, entry.entryName);
        if (entry.isDirectory) {
          await fs.mkdir(dest, { recursive: true });
          continue;
        }
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, entry.getData());
      }
    } else
      await untar({
        file: archive,
        cwd: temp,
        strict: true,
        preservePaths: false,
        filter: (entryPath, entry) => {
          safePath(temp, entryPath);
          if (["SymbolicLink", "Link"].includes(entry.type)) {
            const linked = path.posix.normalize(
              path.posix.join(path.posix.dirname(entryPath), entry.linkpath),
            );
            safePath(temp, linked);
          }
          return true;
        },
      });
    const binaries = await findJava(temp, 7);
    if (!binaries[0]) throw new Error("Java 压缩包没有可执行文件");
    if (process.platform !== "win32") await fs.chmod(binaries[0], 0o755);
    const probe = await probeJava(binaries[0]);
    if (!probe || probe.major !== major || probe.arch !== process.arch)
      throw new Error("Java 安装后验证失败");
    const relative = path.relative(temp, binaries[0]);
    signal?.throwIfAborted();
    await fs.rm(target, { recursive: true, force: true });
    await fs.rename(temp, target);
    await fs.rm(archive, { force: true });
    return { ...probe, path: path.join(target, relative) };
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
}
