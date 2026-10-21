import fs from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { sourceURLs, validFile } from "./utils.mjs";

export async function httpsFetch(url, options = {}) {
  options = { ...options, headers: { ...options.headers } };
  for (let n = 0; n < 8; n++) {
    if (new URL(url).protocol !== "https:")
      throw new Error("服务器返回了不安全的下载地址");
    const res = await fetch(url, {
      ...options,
      redirect: "manual",
      headers: { "User-Agent": "MossLauncher/0.2.0", ...options.headers },
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      await res.body?.cancel();
      const next = new URL(res.headers.get("location"), url);
      if (next.origin !== new URL(url).origin) {
        for (const key of Object.keys(options.headers))
          if (
            ["authorization", "x-api-key", "cookie"].includes(key.toLowerCase())
          )
            delete options.headers[key];
      }
      url = next.href;
      continue;
    }
    return res;
  }
  throw new Error("服务器重定向次数过多");
}
export async function jsonRequest(
  url,
  { source = "official", signal, ...options } = {},
) {
  let last;
  for (const candidate of sourceURLs(url, source))
    try {
      const res = await httpsFetch(candidate, {
        ...options,
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000),
      });
      const data = await res.json();
      if (!res.ok)
        throw new Error(
          data.error_description ||
            data.errorMessage ||
            data.error ||
            `HTTP ${res.status}`,
        );
      return data;
    } catch (e) {
      if (signal?.aborted) throw e;
      last = e;
    }
  throw last;
}
export async function download(
  item,
  dest,
  {
    source = "official",
    signal,
    onBytes = () => {},
    fetcher = httpsFetch,
  } = {},
) {
  signal?.throwIfAborted();
  if (await validFile(dest, item)) return { cached: true };
  await fs.mkdir(path.dirname(dest), { recursive: true });
  let last;
  for (const url of [
    ...new Set((item.urls || [item.url]).flatMap((u) => sourceURLs(u, source))),
  ])
    for (let attempt = 0; attempt < 3; attempt++) {
      signal?.throwIfAborted();
      const temp = dest + "." + randomUUID() + ".part";
      try {
        const timeout = AbortSignal.timeout(180000);
        const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
        const res = await fetcher(url, { signal: combined });
        if (!res.ok) {
          await res.body?.cancel();
          throw new Error(`HTTP ${res.status}`);
        }
        let received = 0;
        const meter = new Transform({
          transform(chunk, encoding, cb) {
            received += chunk.length;
            if (item.size && received > item.size) {
              cb(new Error("文件大小与清单不一致"));
              return;
            }
            onBytes(chunk.length);
            cb(null, chunk);
          },
        });
        await pipeline(
          Readable.fromWeb(res.body),
          meter,
          createWriteStream(temp),
          { signal: combined },
        );
        if (!(await validFile(temp, item))) throw new Error("文件校验失败");
        signal?.throwIfAborted();
        await fs.rm(dest, { force: true });
        await fs.rename(temp, dest);
        return { cached: false };
      } catch (e) {
        await fs.rm(temp, { force: true });
        if (signal?.aborted) throw e;
        last = e;
      }
    }
  throw new Error(`下载失败：${path.basename(dest)}（${last?.message}）`);
}
export async function parallel(items, job, { concurrency = 8, signal } = {}) {
  let cursor = 0,
    failure;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (!failure && cursor < items.length) {
        try {
          signal?.throwIfAborted();
          const item = items[cursor++];
          await job(item);
        } catch (e) {
          failure ??= e;
        }
      }
    }),
  );
  if (failure) throw failure;
  signal?.throwIfAborted();
}
