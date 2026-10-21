import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  allowed,
  context,
  libraryFiles,
  expandArgs,
  safePath,
  safeId,
  sourceURLs,
  offlineUUID,
  atomicJSON,
} from "../electron/core/utils.mjs";
import { download, parallel } from "../electron/core/network.mjs";
import { GameManager } from "../electron/core/launcher.mjs";
import { GameLogDecoder } from "../electron/core/logs.mjs";
const sha1 = (data) => createHash("sha1").update(data).digest("hex");
test("atomic metadata writes tolerate concurrent refreshes", async (t) => {
  const root = await temp(t),
    file = path.join(root, "cache.json");
  await Promise.all(
    Array.from({ length: 12 }, (_, id) => atomicJSON(file, { id })),
  );
  assert.equal(typeof JSON.parse(await fs.readFile(file, "utf8")).id, "number");
  assert.deepEqual(await fs.readdir(root), ["cache.json"]);
});
test("log decoder redacts split secrets and handles split XML and UTF-8", () => {
  const logs = [];
  const decoder = new GameLogDecoder((line) => logs.push(line), "secret-token");
  const data = Buffer.from(
    'hello secret-token\n<log4j:Event level="INFO" thread="Render thread"><log4j:Message><![CDATA[世界 ready secret-token]]></log4j:Message></log4j:Event>\n',
  );
  for (let i = 0; i < data.length; i += 3)
    decoder.write(data.subarray(i, i + 3));
  decoder.end();
  assert.deepEqual(logs, [
    "hello [已隐藏令牌]",
    "[INFO] [Render thread] 世界 ready [已隐藏令牌]",
  ]);
});
async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "moss-test-"));
  t.after(() => fs.rm(dir, { force: true, recursive: true }));
  return dir;
}

test("OS rules preserve order and feature gates on macOS and Windows", () => {
  const rules = [
    { action: "allow" },
    { action: "disallow", os: { name: "osx" } },
  ];
  assert.equal(allowed(rules, context("darwin", "arm64")), false);
  assert.equal(allowed(rules, context("win32", "x64")), true);
  assert.equal(
    allowed([{ action: "allow", features: { is_demo_user: true } }]),
    false,
  );
  assert.equal(
    allowed([{ action: "allow", features: { has_custom_resolution: true } }]),
    true,
  );
  assert.equal(
    allowed(
      [{ action: "allow", os: { arch: "x86" } }],
      context("win32", "x64"),
    ),
    false,
  );
});
test("native libraries choose the JVM architecture instead of all OS variants", () => {
  const libraries = [
    "natives-macos",
    "natives-macos-arm64",
    "natives-macos-patch",
  ].map((c) => ({
    name: "org.lwjgl:lwjgl:3.3.3:" + c,
    rules: [{ action: "allow", os: { name: "osx" } }],
    downloads: { artifact: { path: c + ".jar" } },
  }));
  assert.deepEqual(
    libraryFiles({ libraries }, context("darwin", "arm64")).map((x) => x.path),
    ["natives-macos-arm64.jar"],
  );
  assert.deepEqual(
    libraryFiles({ libraries }, context("darwin", "x64")).map((x) => x.path),
    ["natives-macos.jar", "natives-macos-patch.jar"],
  );
  assert.equal(libraryFiles({ libraries }, context("win32", "x64")).length, 0);
});
test("Windows native classifier maps 32 / 64 bit; modern classifier stays on classpath", () => {
  const lib = {
    name: "legacy:lib:1",
    natives: { windows: "natives-windows-${arch}" },
    downloads: {
      classifiers: {
        "natives-windows-64": { path: "x64.jar" },
        "natives-windows-32": { path: "x86.jar" },
      },
    },
  };
  assert.equal(
    libraryFiles({ libraries: [lib] }, context("win32", "x64"))[0].path,
    "x64.jar",
  );
  assert.equal(
    libraryFiles({ libraries: [lib] }, context("win32", "ia32"))[0].classpath,
    false,
  );
});
test("rejects path traversal, Windows drive paths, invalid version ids", () => {
  const root = path.resolve("game");
  for (const bad of [
    "../escape",
    "/absolute",
    "a/../../escape",
    "C:/Windows/a",
    "a\\..\\b",
    "x\0y",
  ])
    assert.throws(() => safePath(root, bad));
  for (const bad of ["../x", "x/y", "x\\y", "", null])
    assert.throws(() => safeId(bad));
  assert.equal(
    safePath(root, "assets/ab/file"),
    path.join(root, "assets/ab/file"),
  );
  assert.equal(safeId("26.4-snapshot-5"), "26.4-snapshot-5");
});
test("BMCLAPI maps assets, Maven libraries and metadata with official fallback", () => {
  assert.deepEqual(
    sourceURLs("https://libraries.minecraft.net/a/b.jar", "bmclapi"),
    [
      "https://bmclapi2.bangbang93.com/maven/a/b.jar",
      "https://libraries.minecraft.net/a/b.jar",
    ],
  );
  assert.equal(
    sourceURLs(
      "https://resources.download.minecraft.net/ab/abcd",
      "bmclapi",
    )[0],
    "https://bmclapi2.bangbang93.com/assets/ab/abcd",
  );
  assert.equal(
    sourceURLs("https://piston-meta.mojang.com/v1/a.json", "bmclapi")[0],
    "https://bmclapi2.bangbang93.com/v1/a.json",
  );
  assert.throws(() => sourceURLs("http://example.com/file", "official"));
});
test("argument expansion keeps paths with spaces intact and excludes demo arguments", () => {
  const args = [
    "-cp",
    "${classpath}",
    {
      rules: [{ action: "allow", features: { is_demo_user: true } }],
      value: "--demo",
    },
    {
      rules: [{ action: "allow", os: { name: "osx" } }],
      value: ["-XstartOnFirstThread"],
    },
  ];
  assert.deepEqual(
    expandArgs(
      args,
      { classpath: "/a path/library.jar" },
      context("darwin", "arm64"),
    ),
    ["-cp", "/a path/library.jar", "-XstartOnFirstThread"],
  );
  assert.throws(() => expandArgs(["${missing}"], {}));
});
test("offline UUID matches the Java nameUUIDFromBytes convention", () => {
  assert.equal(offlineUUID("Notch"), "b50ad385829d3141a2167e7d7539ba7f");
});
test("downloads repair corrupted cache and skip validated files", async (t) => {
  const root = await temp(t),
    dest = path.join(root, "client.jar"),
    data = Buffer.from("verified game file");
  let calls = 0;
  const item = {
    url: "https://piston-data.mojang.com/client.jar",
    size: data.length,
    sha1: sha1(data),
  };
  const fetcher = async () => {
    calls++;
    return new Response(data);
  };
  await fs.writeFile(dest, "corrupt");
  await download(item, dest, { fetcher });
  assert.equal(await fs.readFile(dest, "utf8"), data.toString());
  const result = await download(item, dest, { fetcher });
  assert.equal(result.cached, true);
  assert.equal(calls, 1);
});
test("hash mismatch retries and never commits unverified data", async (t) => {
  const root = await temp(t),
    dest = path.join(root, "asset"),
    data = Buffer.from("good");
  let calls = 0;
  await download(
    { url: "https://piston-data.mojang.com/a", sha1: sha1(data), size: 4 },
    dest,
    { fetcher: async () => new Response(++calls === 1 ? "evil" : data) },
  );
  assert.equal(calls, 2);
  assert.equal(await fs.readFile(dest, "utf8"), "good");
  assert.deepEqual(await fs.readdir(root), ["asset"]);
});
test("exhausted mirror falls back to official host", async (t) => {
  const root = await temp(t),
    hosts = [];
  await download(
    { url: "https://libraries.minecraft.net/a", sha1: sha1("ok"), size: 2 },
    path.join(root, "a"),
    {
      source: "bmclapi",
      fetcher: async (url) => {
        hosts.push(new URL(url).hostname);
        return new Response(url.includes("bmclapi") ? "failed" : "ok", {
          status: url.includes("bmclapi") ? 503 : 200,
        });
      },
    },
  );
  assert.deepEqual(hosts, [
    "bmclapi2.bangbang93.com",
    "bmclapi2.bangbang93.com",
    "bmclapi2.bangbang93.com",
    "libraries.minecraft.net",
  ]);
});
test("cancelled download removes temporary file and leaves no final file", async (t) => {
  const root = await temp(t),
    dest = path.join(root, "asset"),
    controller = new AbortController();
  const fetcher = async () =>
    new Response(
      new ReadableStream({
        start(stream) {
          stream.enqueue(new Uint8Array([1, 2, 3]));
        },
        cancel() {},
      }),
    );
  const promise = download(
    { url: "https://piston-data.mojang.com/asset", size: 10 },
    dest,
    { signal: controller.signal, fetcher, onBytes: () => controller.abort() },
  );
  await assert.rejects(promise);
  assert.deepEqual(await fs.readdir(root), []);
});
test("concurrent failures drain in-flight work before returning", async () => {
  let finished = false;
  await assert.rejects(
    parallel(
      [1, 2, 3],
      async (n) => {
        if (n === 1) {
          await delay(10);
          throw new Error("failure");
        }
        await delay(50);
        finished = true;
      },
      { concurrency: 2 },
    ),
  );
  assert.equal(finished, true);
});
test("preparation isolates game directories and includes required client/JVM arguments", async (t) => {
  const root = await temp(t),
    id = "1.21.1";
  await atomicJSON(path.join(root, "versions", id, id + ".json"), {
    type: "release",
    assetIndex: { id: "17" },
    libraries: [],
    mainClass: "net.minecraft.client.main.Main",
    arguments: {
      jvm: ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"],
      game: [
        "--username",
        "${auth_player_name}",
        "--gameDir",
        "${game_directory}",
        "--accessToken",
        "${auth_access_token}",
      ],
    },
  });
  const result = await new GameManager(root).prepare(
    id,
    { memoryMB: 4096 },
    {
      name: "Player",
      id: offlineUUID("Player"),
      type: "offline",
      accessToken: "0",
    },
    { arch: process.arch },
  );
  assert.equal(result.cwd, path.join(root, "instances", id));
  assert.ok(result.args.includes("-Xmx4096M"));
  assert.ok(result.args.includes("net.minecraft.client.main.Main"));
  assert.ok(result.args.includes(path.join(root, "versions", id, id + ".jar")));
  assert.equal(result.args.at(-1), "0");
});
