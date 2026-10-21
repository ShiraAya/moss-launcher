import fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { jsonRequest, httpsFetch } from "./network.mjs";
import { atomicJSON, readJSON } from "./utils.mjs";
const AUTH = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const scope = "XboxLive.signin offline_access";
const form = (data) => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(data).toString(),
});
const post = (url, body, signal) =>
  jsonRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal,
  });
export class MicrosoftAuth {
  constructor(file, storage) {
    this.file = file;
    this.storage = storage;
    this.session = null;
  }
  async restore() {
    try {
      const data = await readJSON(this.file);
      this.session = JSON.parse(
        this.storage.decryptString(Buffer.from(data.encrypted, "base64")),
      );
    } catch {
      this.session = null;
    }
    return this.publicAccount();
  }
  publicAccount() {
    return this.session
      ? { name: this.session.name, id: this.session.id, type: "microsoft" }
      : null;
  }
  async save(session) {
    if (!this.storage.isEncryptionAvailable())
      throw new Error("系统凭据加密不可用，无法安全保存登录状态。");
    await atomicJSON(this.file, {
      encrypted: this.storage
        .encryptString(JSON.stringify(session))
        .toString("base64"),
    });
    this.session = session;
  }
  async logout() {
    this.session = null;
    await fs.rm(this.file, { force: true });
  }
  async begin(clientId, signal) {
    if (!/^[a-f0-9-]{36}$/i.test(clientId))
      throw new Error("请先在设置中填写你注册的 Microsoft 应用 Client ID。");
    return jsonRequest(AUTH + "/devicecode", {
      ...form({ client_id: clientId, scope }),
      signal,
    });
  }
  async finish(clientId, device, signal) {
    const deadline = Date.now() + device.expires_in * 1000;
    let interval = (device.interval || 5) * 1000;
    while (Date.now() < deadline) {
      await delay(interval, undefined, { signal });
      const res = await httpsFetch(AUTH + "/token", {
        ...form({
          client_id: clientId,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: device.device_code,
        }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      });
      const data = await res.json();
      if (data.error === "authorization_pending") continue;
      if (data.error === "slow_down") {
        interval += 5000;
        continue;
      }
      if (!res.ok) throw new Error(data.error_description || "微软登录失败");
      const session = await this.exchange(data, clientId, signal);
      signal.throwIfAborted();
      await this.save(session);
      return this.publicAccount();
    }
    throw new Error("登录验证码已过期，请重新登录。");
  }
  async exchange(token, clientId, signal) {
    const xbox = await post(
      "https://user.auth.xboxlive.com/user/authenticate",
      {
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: "d=" + token.access_token,
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      },
      signal,
    );
    let xsts;
    try {
      xsts = await post(
        "https://xsts.auth.xboxlive.com/xsts/authorize",
        {
          Properties: { SandboxId: "RETAIL", UserTokens: [xbox.Token] },
          RelyingParty: "rp://api.minecraftservices.com/",
          TokenType: "JWT",
        },
        signal,
      );
    } catch {
      throw new Error(
        "Xbox 验证失败。请确认账户已建立 Xbox 档案，且满足家庭账户的访问要求。",
      );
    }
    const uhs = xsts.DisplayClaims.xui[0].uhs;
    const mc = await post(
      "https://api.minecraftservices.com/authentication/login_with_xbox",
      { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` },
      signal,
    );
    let profile;
    try {
      profile = await jsonRequest(
        "https://api.minecraftservices.com/minecraft/profile",
        { headers: { Authorization: "Bearer " + mc.access_token }, signal },
      );
    } catch {
      throw new Error(
        "未能读取 Minecraft Java 版档案，请确认此账户拥有游戏并已创建角色。",
      );
    }
    return {
      name: profile.name,
      id: profile.id,
      type: "microsoft",
      accessToken: mc.access_token,
      refreshToken: token.refresh_token,
      clientId,
      expiresAt: Date.now() + (mc.expires_in - 120) * 1000,
      xuid: xsts.DisplayClaims.xui[0].xid || "",
    };
  }
  async account(signal) {
    if (!this.session) throw new Error("请先登录微软账户");
    if (this.session.expiresAt > Date.now()) return this.session;
    const token = await jsonRequest(AUTH + "/token", {
      ...form({
        client_id: this.session.clientId,
        grant_type: "refresh_token",
        refresh_token: this.session.refreshToken,
        scope,
      }),
      signal,
    });
    token.refresh_token ||= this.session.refreshToken;
    const session = await this.exchange(token, this.session.clientId, signal);
    await this.save(session);
    return session;
  }
}
