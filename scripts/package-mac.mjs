import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const staging = await fs.mkdtemp(path.join(os.tmpdir(), "moss-package-"));
const output = path.resolve("release");
await fs.mkdir(output, { recursive: true });
try {
  // Building outside Documents/iCloud avoids Finder metadata being reattached during signing.
  for (const arch of ["arm64", "x64"]) {
    await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          require.resolve("electron-builder/cli.js"),
          "--mac",
          "dmg",
          "zip",
          "--" + arch,
          "--publish",
          "never",
          "--config.directories.output=" + staging,
        ],
        { stdio: "inherit" },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("macOS packaging failed: " + code)),
      );
    });
  }
  for (const file of await fs.readdir(staging))
    if (/\.(dmg|zip|blockmap)$/.test(file))
      await fs.copyFile(path.join(staging, file), path.join(output, file));
  console.log("macOS packages saved to " + output);
} finally {
  await fs.rm(staging, { recursive: true, force: true });
}
