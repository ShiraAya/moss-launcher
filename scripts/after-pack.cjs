const { execFileSync } = require("node:child_process");
const path = require("node:path");
// Remove Finder metadata from our freshly built bundle before macOS code signing.
module.exports = async (context) => {
  if (context.electronPlatformName === "darwin") {
    const bundle = path.join(
      context.appOutDir,
      context.packager.appInfo.productFilename + ".app",
    );
    execFileSync("/usr/bin/xattr", ["-cr", bundle]);
  }
};
