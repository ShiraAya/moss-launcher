# 0.2.0 验收记录

验证日期：2026-10-21。测试机：macOS / Apple Silicon，16 GB 内存。

## GitHub 发布后的补充验证

- 原始 `v0.1.0` / `v0.2.0` 标签在 GitHub 的 macOS runner 上通过测试和打包。
- Windows runner 发现两个历史版本的并发元数据写入测试出现 `EPERM`：同一目标文件的多个原子重命名发生竞争；其余测试通过。两个历史 Release 保留原始安装包，并标明此问题。
- `main` 的未发布修复将同一目标文件的写入串行化，并对 Windows 的短暂文件占用做有限重试。新增失败写入不阻塞后续写入的回归测试，本地 **28 项测试**与 TypeScript / Vite 构建通过。

## 已通过

- **27 项自动化核心测试**：平台规则与特性开关、macOS / Windows 原生库架构选择、路径安全、BMCLAPI 地址映射、离线 UUID、启动参数与隔离目录、哈希修复、缓存复用、镜像回退、取消清理、并发任务收尾、并发元数据写入、跨数据块日志脱敏。
- 新增覆盖：Maven 坐标、继承版本与客户端 JAR、NeoForge ignoreList、ZIP 路径与链接检查、大小写冲突、Modrinth 依赖与客户端覆盖、普通 ZIP / MultiMC 识别、导入提交与回滚、CurseForge 分发限制及手动文件校验、SHA-512、跨域重定向移除凭据、取消安装处理器。
- **TypeScript 检查及 Vite 生产构建**。
- **开发模式 GUI**：Electron + Vite 成功渲染，无页面运行时异常；开发 CSP 与生产 CSP 分别处理。
- **Mojang / BMCLAPI 联网读取**：实际读取版本清单，验证搜索与最新正式版元数据，非静态演示数据。
- **完整安装 Minecraft 1.21.1**：从官方源下载并校验 3,945 个去重文件，清单内游戏、依赖和资源共约 915 MB（十进制）。
- **真实 Java 21 游戏启动**：图形后端 LWJGL、OpenAL 音频及 GUI / 世界纹理图集初始化成功。测试完成后主动结束测试游戏进程。
- **Java 25 自动安装**：通过 Adoptium API 下载 Temurin arm64 JRE、SHA-256 校验、解包，并成功执行 Java 检查命令。
- **打包后的 Mac arm64 应用端到端测试**：打开窗口、读取账户与环境、搜索版本、切换下载源并持久化、编辑离线角色名、点击启动游戏，确认游戏图集初始化；页面异常为 0。
- **Mac arm64 / x64 应用**：`codesign --verify --deep --strict` 通过。
- **Mac arm64 / x64 磁盘镜像**：`hdiutil verify` 校验通过。

## 新组件与整合包实际测试

在同一台 Apple Silicon Mac 上，使用 Minecraft **1.21.1** / Java **21.0.6 arm64** 完成真实网络下载、安装和进程启动，均确认 `textures/atlas/gui.png-atlas` 初始化成功后结束自己的测试进程：

| 组件 | 测试版本 | 结果 |
| --- | --- | --- |
| Fabric | 0.16.14 | 下载、安装、启动通过 |
| Forge | 52.0.16 | 安装处理器通过；关闭早期加载窗口后启动通过 |
| NeoForge | 21.1.172 | 安装处理器通过；共享客户端 JAR 的 ignoreList 修复后启动通过 |
| OptiFine | HD_U_J1 | BMCLAPI 下载、补丁生成、启动通过，日志显示 OptiFine 加载 |
| Modrinth 整合包 | Minecraft 1.21.1 + Fabric 0.16.14 + Fabric API 0.116.1 | 导入示例 `.mrpack`，下载并校验真实 Fabric API，配置落盘，启动日志确认加载该模组并完成 GUI 图集初始化 |

**0.2.0 打包后的 Mac arm64 应用**端到端测试通过版本页入口、四个在线组件列表、导入预览、实例名称编辑、导入任务、已安装列表和底部启动按钮，页面运行时异常为 0。新图标在安装卡片、版本列表和底部启动栏共享同一组件。

打包应用实际获取的 Minecraft 1.21.1 组件清单：Fabric 255 项、Forge 69 项、NeoForge 259 项、OptiFine 8 项；数量会随上游发布变化。

## 验证边界

- CurseForge 清单解析、禁止自动下载及手动补齐使用固定 API 响应进行自动化验证；没有用户 API Key，未做真实账户的 CurseForge 远程下载验收。MultiMC 与普通 ZIP 使用本地 ZIP 用例验证；没有逐一验证第三方大型整合包。
- 微软登录已经实现设备码 → Xbox → XSTS → Minecraft → 游戏档案的链路与令牌刷新，但没有提供用户自己的 Client ID 和正版测试账户，**尚未完成真人登录验收**。
- Windows x64 安装包采用交叉构建；测试覆盖 Windows 参数和原生库规则，**没有 Windows 真机安装、启动游戏的结果**。
- Mac Intel x64 完成打包与签名校验，**没有 Intel Mac 的游戏运行测试**。
- 最新清单和 Java 25 安装分别经过验证；**没有逐一启动所有可下载的游戏版本**。
- Mac 为 ad-hoc 签名开发构建，未通过 Apple 公证；Windows 未配置发布者证书。

## 本次使用的技术版本

- Electron 45.0.0
- React 19.3.1
- Vite 8.3.5
- TypeScript 5.9.3
- electron-builder 26.15.3
- pnpm 11.25.0 / Node.js 24
- @xmcl/installer 6.3.6 / @xmcl/core 2.16.2，发布入口补丁随源码提供

精确依赖版本与完整性信息见 `pnpm-lock.yaml`。运行 `pnpm test` 与 `pnpm build` 可重跑本地自动检查。
