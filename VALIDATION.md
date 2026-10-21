# 0.1.0 验收记录

验证日期：2026-10-21。测试机：macOS / Apple Silicon，16 GB 内存。

## 已通过

- **15 项自动化核心测试**：平台规则与特性开关、macOS / Windows 原生库架构选择、路径安全、BMCLAPI 地址映射、离线 UUID、启动参数与隔离目录、哈希修复、缓存复用、镜像回退、取消清理、并发任务收尾、并发元数据写入、跨数据块日志脱敏。
- **TypeScript 检查及 Vite 生产构建**。
- **开发模式 GUI**：Electron + Vite 成功渲染，无页面运行时异常；开发 CSP 与生产 CSP 分别处理。
- **Mojang / BMCLAPI 联网读取**：实际读取版本清单，验证搜索与最新正式版元数据，非静态演示数据。
- **完整安装 Minecraft 1.21.1**：从官方源下载并校验 3,945 个去重文件，清单内游戏、依赖和资源共约 915 MB（十进制）。
- **真实 Java 21 游戏启动**：图形后端 LWJGL、OpenAL 音频及 GUI / 世界纹理图集初始化成功。测试完成后主动结束测试游戏进程。
- **Java 25 自动安装**：通过 Adoptium API 下载 Temurin arm64 JRE、SHA-256 校验、解包，并成功执行 Java 检查命令。
- **打包后的 Mac arm64 应用端到端测试**：打开窗口、读取账户与环境、搜索版本、切换下载源并持久化、编辑离线角色名、点击启动游戏，确认游戏图集初始化；页面异常为 0。
- **Mac arm64 / x64 应用**：`codesign --verify --deep --strict` 通过。
- **Mac arm64 / x64 磁盘镜像**：`hdiutil verify` 校验通过。

## 验证边界

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

精确依赖版本与完整性信息见 `pnpm-lock.yaml`。运行 `pnpm test` 与 `pnpm build` 可重跑本地自动检查。

## 发布源码恢复验证

建立 Git 历史时，旧源码压缩包已被 0.2.0 替换。本标签的 0.1.0 源码从发布安装包与同次开发文件恢复；使用相同依赖重新构建后，生成的 `dist/index.html`、JavaScript、CSS 与 0.1.0 Mac arm64 安装包逐字节一致，`electron/` 全部运行时代码也逐字节一致，15 项测试通过。构建工具及说明文件恢复为对应版本的配置，未将 0.2.0 功能混入 0.1.0 标签。
