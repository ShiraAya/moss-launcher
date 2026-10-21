# 苔原 Moss Launcher

为 macOS 和 Windows 制作的 Minecraft **Java 版**桌面启动器，基于 Electron + React + TypeScript。

当前版本：**0.2.0**。

`v0.1.0` / `v0.2.0` 标签和 Release 安装包保留原始版本。这两个版本在 Windows 上并发刷新同一份元数据时可能出现 `EPERM` 写入错误；`main` 已加入按文件排队写入和短暂文件占用重试，尚未包含在历史安装包中。

## 已实现

- Mojang 实时版本清单、正式版 / 快照筛选、版本搜索和本地已安装列表。
- Mojang 官方源与 BMCLAPI 镜像切换；镜像请求失败后回退官方源。
- 下载客户端、依赖库、平台原生库、资源索引、全部游戏资源和日志配置。
- 安装时可选 Fabric、Forge、NeoForge、OptiFine；从在线清单读取与 Minecraft 匹配的版本，完成依赖下载和安装处理器执行。
- 支持 Modrinth `.mrpack` / ZIP、CurseForge 清单 ZIP、MultiMC / Prism 实例 ZIP、普通客户端 mods/config ZIP 导入。
- Fabric 使用布料图标，Forge 使用铁砧，NeoForge 使用狐狸；安装卡片、本地版本列表与底部启动栏一致显示。
- SHA-1 完整性校验、最多 8 路并发、失败重试、取消下载、复用已校验文件、重新校验与修复。
- macOS Intel / Apple Silicon、Windows x64 的独立打包配置与原生库选择。
- 检测已安装 Java，手动指定 Java，或从 Eclipse Adoptium 自动下载匹配的 Temurin JRE 8 / 17 / 21 / 25，使用 SHA-256 校验。
- 独立版本存档与配置目录，共享游戏资源和依赖；内存配置、目录选择与打开。
- 离线角色档案；Microsoft 设备码登录、Xbox / XSTS / Minecraft 档案验证与令牌刷新。
- 登录令牌使用 Electron `safeStorage` 在本机加密保存，不传入渲染进程。
- 游戏进程状态与实时日志；处理分块 UTF-8 / Log4j XML，并隐藏登录令牌。
- 沙盒化渲染进程、上下文隔离、有限 IPC 接口、HTTPS 下载和路径越界检查。

## 下载安装包

| 版本 | Mac Apple Silicon | Mac Intel | Windows x64 |
| --- | --- | --- | --- |
| [v0.2.0](https://github.com/ShiraAya/moss-launcher/releases/tag/v0.2.0) | [DMG](https://github.com/ShiraAya/moss-launcher/releases/download/v0.2.0/Moss-Launcher-0.2.0-mac-arm64.dmg) | [DMG](https://github.com/ShiraAya/moss-launcher/releases/download/v0.2.0/Moss-Launcher-0.2.0-mac-x64.dmg) | [EXE](https://github.com/ShiraAya/moss-launcher/releases/download/v0.2.0/Moss-Launcher-0.2.0-win-x64.exe) |
| [v0.1.0](https://github.com/ShiraAya/moss-launcher/releases/tag/v0.1.0) | [DMG](https://github.com/ShiraAya/moss-launcher/releases/download/v0.1.0/Moss-Launcher-0.1.0-mac-arm64.dmg) | [DMG](https://github.com/ShiraAya/moss-launcher/releases/download/v0.1.0/Moss-Launcher-0.1.0-mac-x64.dmg) | [EXE](https://github.com/ShiraAya/moss-launcher/releases/download/v0.1.0/Moss-Launcher-0.1.0-win-x64.exe) |

## 安装与开始游戏

1. **Mac**：打开对应处理器的 DMG，把 **Moss Launcher.app** 拖到 Applications。Apple Silicon 选择 `arm64`，Intel 选择 `x64`。
2. **Windows x64**：运行 `.exe` 安装程序，选择安装位置。
3. 在「我的账户」中设置离线角色名，或按下文配置并登录 Microsoft 账户。
4. 到「游戏版本」选择正式版并安装；网络不佳时可在「启动器设置」切换 BMCLAPI。
5. 点击底部「启动游戏」。自动管理会选择匹配的 Java；本机缺失时会下载运行环境。

Mac 使用 ad-hoc 签名，尚未做 Apple 公证；Windows 未配置发布者签名。系统可能要求在隐私与安全设置中允许打开这个应用。

关闭窗口时若游戏、下载或登录仍在进行，窗口会隐藏以保留任务；再次打开应用即可恢复窗口。可先取消下载或关闭游戏后退出。

## 安装模组组件

1. 在「游戏版本」点击「安装」，选择原版 / Fabric / Forge / NeoForge / OptiFine。
2. 选择兼容的组件版本，点击「开始安装」。Forge / NeoForge / OptiFine 首次安装会运行各自安装处理器，可能需要几分钟；可以取消。
3. 已安装的版本旁有 **＋** 按钮，可以基于同一 Minecraft 版本再安装其他组件。
4. 用「打开游戏目录」进入实例，将对应版本的模组放入 `mods/`。需要 Fabric API 的模组须另行安装匹配的 Fabric API；整合包中已声明的文件会随包下载。
5. 圆形箭头会校验、修复游戏和加载器，保留实例中的模组、配置和存档；不会重新下载整合包模组。

Mac 默认开启图形兼容模式，在实例 `config/fml.toml` 中关闭 Forge / NeoForge 的早期加载窗口，避免部分 Mac 显示器初始化失败；首次修改已有配置时保留 `.moss-backup`。可以在「启动器设置」切换。

## 导入整合包

在「游戏版本 → 导入整合包」选择 `.zip` 或 `.mrpack`，检查实例名称和依赖，点击「导入并安装」。每次导入创建新实例，共享资源和依赖库，存档与配置互相隔离。

| 格式 | 导入行为 |
| --- | --- |
| Modrinth | 识别 `modrinth.index.json`，安装游戏和加载器，按 SHA-512 校验下载；忽略服务端专用文件，可选文件由用户勾选；依次应用 `overrides` 和 `client-overrides`。 |
| CurseForge | 识别 `manifest.json`，用用户自己的 CurseForge API Key 解析文件并下载安装；Key 只在本次解析中发往官方 API，不写入设置。禁止第三方分发的文件提供官网链接，用户下载后选择文件并校验哈希。 |
| MultiMC / Prism | 识别 `mmc-pack.json` 的原版 / Fabric / Forge / NeoForge 组件，导入 `.minecraft` 内容。不执行实例脚本，不导入账户或 Java 启动设置。 |
| 普通 ZIP | 识别根目录、`.minecraft` 或 `minecraft` 中的 `mods`、`config`、`saves` 等游戏内容。没有版本清单时手动选择 Minecraft 与组件版本。也支持单一外层目录。 |

CurseForge 模组、资源包和光影会放入各自目录；无法获得 API Key 时，可使用已经包含完整 mods/config 的普通 ZIP。Quilt、服务端包、自定义启动脚本或多个加载器组合不在支持范围内，界面会报出具体原因，不假装导入成功。

导入上限为 ZIP 512 MB、单个解压/下载文件 256 MB、包内解压总量 4 GB、下载文件总量 4 GB、包内 20,000 个条目。会拒绝越界路径、符号链接、特殊文件、大小写冲突和 Windows 保留文件名。失败或取消会清理尚未完成的实例；已校验的共享游戏资源可复用。整合包需来自你信任的作者，启动时其中的模组会作为游戏代码运行。

## 从源码运行

需要 Node.js **24** 和 pnpm **11.25.0**。使用 lockfile 可复现依赖。

```sh
pnpm install --frozen-lockfile
pnpm dev
```

生产模式：

```sh
pnpm build
pnpm start
```

直接用浏览器打开 HTML 不具备下载、文件和进程能力，必须通过 Electron 桌面窗口运行。

## 打包

```sh
# macOS 上执行，顺序生成 Apple Silicon 与 Intel 的 DMG / ZIP
pnpm dist:mac

# Windows 安装程序；也可在 macOS 上交叉打包
pnpm dist:win

# 只生成当前平台的应用目录
pnpm pack
```

产物位于 `release/`。Mac 脚本先在系统临时目录中完成构建与签名，再复制安装包，避免 Documents / iCloud 自动附加 Finder 属性导致签名失败；两种架构按顺序生成，避免磁盘镜像占用冲突。提供 `.github/workflows/build.yml`，支持手动运行或推送 `v*` 标签，在 macOS / Windows runner 上分别测试和打包。没有配置自动发布或上传到任何外部账户。

## 微软账户接入

此项目没有内置、借用其他启动器的 Client ID，也不要求填写 Client Secret。

1. 注册你自己的 Microsoft Entra 公共客户端应用，支持**个人 Microsoft 账户**，开启公共客户端设备码流程。
2. 确保你的应用有权访问 Minecraft 服务；如 Minecraft 开发者应用准入政策要求审核，需要先完成相应审批。
3. 把 Application (client) ID 填入「启动器设置 → 微软登录配置」。
4. 在「我的账户」点击登录，在微软官方网页输入验证码。
5. 使用拥有 Minecraft Java 版且已有游戏档案的账户。

由于没有提供可用的 Client ID 与测试账户，微软认证链路尚未做真人端到端验收。离线档案可用于本地单人游戏，不能加入要求正版认证的服务器。

## 支持范围

- 当前实现原版 Java 版 **1.13 及之后**版本；Apple Silicon 建议 **1.19+**，缺少 ARM64 原生库的旧版本会明确提示。
- 当前官方最新版本从网络读取，不硬编码“最新版本号”。运行环境主版本根据 Mojang 元数据选择。
- Windows 提供 x64 安装包；不提供原生 Windows ARM64 包。
- 已集成 Fabric / Forge / NeoForge / OptiFine 和上述整合包导入；尚未集成 Quilt、模组市场浏览、皮肤管理、Bedrock 或启动器自动更新。
- 本地安装记录只识别 Moss 完整安装的版本，不自动导入其他启动器目录。
- 下载恢复按**完整文件**进行，未完成文件会重新下载，不声称支持字节级断点续传。
- 更改游戏目录不会搬移旧数据；移回原目录即可重新读取该目录中的已安装版本。
- 不把游戏本体或 Java 二进制包含在源码包或启动器安装包中；用户按需从对应源下载。

## 存储结构

设置、加密账户文件与 Java 运行环境默认保存在系统的应用数据目录。游戏根目录可在界面修改。

```text
game/
  versions/<id>/         # 元数据、客户端 JAR、原生库、完整安装标记
  libraries/             # 共享依赖
  assets/                # 资源对象、索引和日志配置
  instances/<id>/        # 该版本的存档、配置、截图和游戏日志
  installers/            # Forge / NeoForge / OptiFine 安装器缓存
  imports/               # 整合包临时目录，结束后清理
  manifest-cache.json    # 网络失败时可读取的版本清单
```

## 开发与验证

```sh
pnpm test     # 核心行为回归测试，无需联网或安装 Java
pnpm build    # TypeScript 检查 + 生产构建
pnpm check    # 两项一起执行
```

源码目录：

```text
src/                 React 界面、样式、矢量场景与类型
electron/main.mjs    桌面窗口、IPC、设置、任务和进程状态
electron/preload.cjs 有限的 renderer / main 通信桥
electron/core/      下载、校验、安装、启动、Java、认证和日志
tests/              核心行为测试
build/              自绘应用图标
scripts/            开发启动脚本
```

本次验收结果见项目中的 `VALIDATION.md`。

安装与处理器流程使用 MIT 授权的 `@xmcl/installer` / `@xmcl/core`。当前发布包存在两个入口引用问题，已通过 `patches/` 与 pnpm `patchedDependencies` 固定修复（unzip 的 main 入口、installer 引用未发布的 core/utils）。请使用提供的 pnpm lockfile 安装，不要跳过补丁。

## 参考与鸣谢

- [Mojang 版本清单](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json)
- [XMCL 安装器](https://xmcl.app/en/core/installer)
- [Fabric Meta API](https://meta.fabricmc.net/)
- [Forge Maven](https://maven.minecraftforge.net/)
- [NeoForge Maven](https://maven.neoforged.net/releases/)
- [Modrinth 整合包格式](https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack)
- [CurseForge API](https://docs.curseforge.com/rest-api/)
- [BMCLAPI 文档及服务](https://bmclapidoc.bangbang93.com/)：界面中已标注来源。
- [Eclipse Adoptium API](https://api.adoptium.net/q/swagger-ui/)
- [Microsoft 设备授权流程](https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-device-code)
- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)

Moss 为独立项目，与 Mojang、Microsoft、BMCLAPI 或 Eclipse Adoptium 无隶属关系。项目代码和自绘图形使用 MIT License；Minecraft 与各运行时、依赖的权利归各自权利人。
