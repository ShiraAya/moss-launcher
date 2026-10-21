import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import {
  mergeVersion,
  libraryFiles,
  atomicJSON,
  validFile,
} from "../electron/core/utils.mjs";
import { GameManager } from "../electron/core/launcher.mjs";
import {
  neoMinecraft,
  validateInstall,
  runProcessor,
} from "../electron/core/loaders.mjs";
import {
  packPath,
  inspectPack,
  importPack,
  resolveCurseForge,
  matchManualFiles,
} from "../electron/core/modpacks.mjs";
import { httpsFetch } from "../electron/core/network.mjs";
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moss-mods-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function zipFile(root, files, name = "pack.zip") {
  const zip = new AdmZip();
  for (const [n, data] of Object.entries(files))
    zip.addFile(
      n,
      Buffer.from(typeof data === "string" ? data : JSON.stringify(data)),
    );
  const file = path.join(root, name);
  zip.writeZip(file);
  return file;
}
const index = (files = []) => ({
  formatVersion: 1,
  game: "minecraft",
  name: "林间小屋",
  versionId: "1",
  dependencies: { minecraft: "1.21.1", "fabric-loader": "0.16.14" },
  files,
});
const file = (p, env) => ({
  path: p,
  hashes: { sha1: "a".repeat(40), sha512: "b".repeat(128) },
  env,
  downloads: ["https://cdn.modrinth.com/a.jar"],
  fileSize: 10,
});
const installStub = async (manager, r) => {
  await atomicJSON(path.join(manager.root, "versions", r.id, r.id + ".json"), {
    id: r.id,
    inheritsFrom: r.minecraft,
  });
  return { ...r, installedAt: new Date().toISOString() };
};
test("Maven artifacts and inherited versions retain base client, override libraries and merge args", async (t) => {
  const root = await temp(t);
  const parent = {
    id: "1.21.1",
    arguments: { game: ["--base"], jvm: ["-cp", "${classpath}"] },
    libraries: [{ name: "g:a:1" }, { name: "g:n:1:natives-osx-arm64" }],
  };
  const child = {
    id: "fabric",
    inheritsFrom: "1.21.1",
    mainClass: "Knot",
    arguments: { game: ["--mod"], jvm: [] },
    libraries: [{ name: "g:a:2", url: "https://maven.fabricmc.net/" }],
  };
  const meta = mergeVersion(parent, child);
  assert.equal(meta.clientVersion, "1.21.1");
  assert.deepEqual(meta.arguments.game, ["--base", "--mod"]);
  assert.deepEqual(
    meta.libraries.map((l) => l.name),
    ["g:n:1:natives-osx-arm64", "g:a:2"],
  );
  assert.equal(
    libraryFiles(meta).find((l) => l.path.endsWith("a-2.jar")).url,
    "https://maven.fabricmc.net/g/a/2/a-2.jar",
  );
  for (const m of [parent, child])
    await atomicJSON(path.join(root, "versions", m.id, m.id + ".json"), m);
  await fs.writeFile(path.join(root, "versions/1.21.1/1.21.1.jar"), "client");
  await atomicJSON(path.join(root, "versions/fabric/moss-installed.json"), {
    id: "fabric",
    installedAt: "2026-10-21",
  });
  const manager = new GameManager(root);
  assert.equal((await manager.metadata("fabric")).clientVersion, "1.21.1");
  assert.equal((await manager.installed()).length, 1);
  await atomicJSON(path.join(root, "versions/1.21.1/1.21.1.json"), {
    id: "1.21.1",
    inheritsFrom: "fabric",
  });
  await assert.rejects(manager.metadata("fabric"), /继承/);
});
test("loader version mapping and input validation reject unsupported dependencies", () => {
  assert.equal(neoMinecraft("21.1.172"), "1.21.1");
  assert.equal(neoMinecraft("20.2.86"), "1.20.2");
  assert.equal(neoMinecraft("21.0.1-beta"), "1.21");
  assert.equal(neoMinecraft("26.1.0.10"), "26.1");
  assert.equal(neoMinecraft("26.1.2.121"), "26.1.2");
  assert.throws(() =>
    validateInstall({ minecraft: "1.21.1", loader: "quilt" }),
  );
  assert.throws(() =>
    validateInstall({
      minecraft: "1.21.1",
      loader: "forge",
      loaderVersion: "../x",
    }),
  );
});
test("pack paths reject traversal, Windows devices and ambiguous names", () => {
  for (const value of [
    "../evil",
    "C:/evil",
    "mods\\a.jar",
    "/etc/hosts",
    "mods/CON.jar",
    "mods/a.",
    "mods//a",
    "mods/./a",
    "mods/a:ads",
    "mods/a\0b",
  ])
    assert.throws(() => packPath(value), value);
  assert.equal(packPath("config/中文配置.json"), "config/中文配置.json");
});
test("Modrinth identifies dependencies, excludes server files and applies client overrides last", async (t) => {
  const root = await temp(t);
  const p = await inspectPack(
    await zipFile(root, {
      "wrapped/modrinth.index.json": index([
        file("mods/a.jar", { client: "required" }),
        file("mods/b.jar", { client: "optional" }),
        file("mods/server.jar", { client: "unsupported" }),
      ]),
      "wrapped/overrides/config/example.json": "base",
      "wrapped/client-overrides/config/example.json": "client",
      "wrapped/server-overrides/config/only-server": "skip",
    }),
  );
  assert.equal(p.name, "林间小屋");
  assert.equal(p.minecraft, "1.21.1");
  assert.equal(p.loader, "fabric");
  assert.equal(p.downloadable.length, 2);
  assert.equal(p.downloadable[1].optional, true);
  assert.deepEqual(
    p.copies.map((c) => c.entry),
    [
      "wrapped/overrides/config/example.json",
      "wrapped/client-overrides/config/example.json",
    ],
  );
});
test("archives reject case collisions, symlinks, traversal and invalid checksums", async (t) => {
  const root = await temp(t);
  await assert.rejects(
    inspectPack(await zipFile(root, { "mods/A.jar": "a", "mods/a.jar": "b" })),
    /冲突/,
  );
  const z = new AdmZip();
  z.addFile("mods/link", Buffer.from("outside"));
  z.getEntry("mods/link").attr = (0o120777 << 16) >>> 0;
  z.writeZip(path.join(root, "symlink.zip"));
  await assert.rejects(inspectPack(path.join(root, "symlink.zip")), /链接/);
  const bad = file("mods/bad.jar");
  bad.hashes.sha512 = "broken";
  await assert.rejects(
    inspectPack(await zipFile(root, { "modrinth.index.json": index([bad]) })),
    /哈希/,
  );
  const traversal = file("../outside.jar");
  await assert.rejects(
    inspectPack(
      await zipFile(root, { "modrinth.index.json": index([traversal]) }),
    ),
    /安全/,
  );
});
test("plain and MultiMC ZIP recognize nested Minecraft directories without importing launcher state", async (t) => {
  const root = await temp(t);
  const plain = await inspectPack(
    await zipFile(root, {
      ".minecraft/mods/a.jar": "mod",
      ".minecraft/config/a.json": "config",
      "launcher_accounts.json": "secret",
    }),
  );
  assert.equal(plain.format, "plain");
  assert.equal(plain.copies.length, 2);
  const multi = await inspectPack(
    await zipFile(root, {
      "mmc-pack.json": {
        formatVersion: 1,
        components: [
          { uid: "net.minecraft", version: "1.21.1" },
          { uid: "net.neoforged", version: "21.1.172" },
        ],
      },
      ".minecraft/mods/a.jar": "mod",
      "instance.cfg": "ignored",
    }),
  );
  assert.equal(multi.loader, "neoforge");
  assert.deepEqual(
    multi.copies.map((c) => c.path),
    ["mods/a.jar"],
  );
});
test("import commits an isolated instance and leaves existing saves unchanged", async (t) => {
  const root = await temp(t);
  const pack = await inspectPack(
    await zipFile(root, {
      "mods/a.jar": "mod",
      "config/a.json": "configuration",
    }),
  );
  const manager = new GameManager(path.join(root, "game"));
  await fs.mkdir(path.join(manager.root, "instances/existing/saves"), {
    recursive: true,
  });
  await fs.writeFile(
    path.join(manager.root, "instances/existing/saves/world"),
    "keep",
  );
  const record = await importPack(
    manager,
    pack,
    { minecraft: "1.21.1", loader: "vanilla", name: "My pack" },
    { install: installStub },
  );
  assert.equal(record.name, "My pack");
  assert.equal(
    await fs.readFile(
      path.join(manager.root, "instances", record.id, "mods/a.jar"),
      "utf8",
    ),
    "mod",
  );
  assert.equal(
    await fs.readFile(
      path.join(manager.root, "instances/existing/saves/world"),
      "utf8",
    ),
    "keep",
  );
  assert.equal(
    (await fs.readdir(path.join(manager.root, "imports"))).length,
    0,
  );
  assert.ok(
    await fs.stat(
      path.join(manager.root, "versions", record.id, "moss-installed.json"),
    ),
  );
});
test("failed and cancelled imports roll back staging and version markers", async (t) => {
  const root = await temp(t);
  const pack = await inspectPack(await zipFile(root, { "mods/a.jar": "mod" }));
  const manager = new GameManager(path.join(root, "game"));
  await assert.rejects(
    importPack(
      manager,
      pack,
      { minecraft: "1.21.1", loader: "vanilla" },
      {
        install: async (m, r) => {
          await installStub(m, r);
          throw new Error("processor failed");
        },
      },
    ),
    /processor failed/,
  );
  assert.deepEqual(await fs.readdir(path.join(manager.root, "imports")), []);
  assert.deepEqual(await fs.readdir(path.join(manager.root, "versions")), []);
  const c = new AbortController();
  c.abort();
  await assert.rejects(
    importPack(
      manager,
      pack,
      { minecraft: "1.21.1", loader: "vanilla" },
      { signal: c.signal, install: installStub },
    ),
  );
  assert.deepEqual(await fs.readdir(path.join(manager.root, "imports")), []);
});
test("CurseForge honors download restrictions and verifies manually supplied files", async (t) => {
  const root = await temp(t),
    data = Buffer.from("mod-data"),
    sha1 = createHash("sha1").update(data).digest("hex");
  let pack = await inspectPack(
    await zipFile(root, {
      "manifest.json": {
        manifestType: "minecraftModpack",
        manifestVersion: 1,
        minecraft: {
          version: "1.21.1",
          modLoaders: [{ id: "forge-52.0.16", primary: true }],
        },
        files: [{ projectID: 123, fileID: 456, required: true }],
        overrides: "overrides",
      },
      "overrides/config/a.json": "a",
    }),
  );
  await assert.rejects(resolveCurseForge(pack, ""), /API Key/);
  pack = await resolveCurseForge(pack, "test-key", {
    request: async (url) => ({
      data: url.endsWith("/files/456")
        ? {
            id: 456,
            modId: 123,
            fileName: "a.jar",
            fileLength: data.length,
            hashes: [{ algo: 1, value: sha1 }],
            downloadUrl: null,
          }
        : {
            classId: 6,
            links: {
              websiteUrl: "https://www.curseforge.com/minecraft/mc-mods/test",
            },
          },
    }),
  });
  assert.equal(pack.downloadable[0].manual, true);
  assert.deepEqual(pack.downloadable[0].urls, []);
  assert.equal(
    pack.downloadable[0].page,
    "https://www.curseforge.com/minecraft/mc-mods/test/files/456",
  );
  await assert.rejects(importPack(new GameManager(root), pack, {}), /补齐/);
  const local = path.join(root, "a.jar");
  await fs.writeFile(local, data);
  pack = await matchManualFiles(pack, [local]);
  assert.equal(pack.localFiles["mods/a.jar"], local);
  await fs.writeFile(local, "bad");
  await assert.rejects(matchManualFiles(pack, [local]), /校验失败/);
});
test("SHA-512 corruption is detected and cross-origin redirects strip credentials", async (t) => {
  const root = await temp(t),
    f = path.join(root, "file");
  await fs.writeFile(f, "hello");
  const sha512 = createHash("sha512").update("hello").digest("hex");
  assert.equal(await validFile(f, { sha512 }), true);
  await fs.writeFile(f, "other");
  assert.equal(await validFile(f, { sha512 }), false);
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    calls.push({ url, headers: { ...opts.headers } });
    return calls.length === 1
      ? new Response("", {
          status: 302,
          headers: { location: "https://cdn.example.com/a" },
        })
      : new Response("ok");
  });
  await httpsFetch("https://api.example.com/a", {
    headers: { "x-api-key": "secret", Authorization: "bearer secret" },
  });
  assert.equal(calls[0].headers["x-api-key"], "secret");
  assert.equal(calls[1].headers["x-api-key"], undefined);
  assert.equal(calls[1].headers.Authorization, undefined);
});
test("cancellation terminates the owned installer process", async () => {
  const c = new AbortController();
  const promise = runProcessor(
    { executable: process.execPath, args: ["-e", "setInterval(()=>{},1000)"] },
    c.signal,
  );
  setTimeout(() => c.abort(), 80);
  await assert.rejects(promise);
});

test("NeoForge ignoreList targets the shared base client JAR instead of the instance ID", async (t) => {
  const root = await temp(t);
  await atomicJSON(path.join(root, "versions/1.21.1/1.21.1.json"), {
    id: "1.21.1",
    libraries: [],
    assetIndex: { id: "17" },
    arguments: { jvm: ["-cp", "${classpath}"], game: [] },
  });
  await atomicJSON(path.join(root, "versions/pack-123/pack-123.json"), {
    id: "pack-123",
    inheritsFrom: "1.21.1",
    libraries: [],
    mainClass: "Bootstrap",
    arguments: {
      jvm: ["-DignoreList=client-extra,${version_name}.jar"],
      game: [],
    },
  });
  const result = await new GameManager(root).prepare(
    "pack-123",
    { memoryMB: 2048 },
    { name: "Player", id: "uuid" },
    { arch: process.arch },
  );
  assert.ok(result.args.includes("-DignoreList=client-extra,1.21.1.jar"));
  assert.ok(!result.args.some((a) => a.includes("pack-123.jar")));
});
