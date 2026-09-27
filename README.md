# 老派拼豆之必要

面向手机、平板和电脑的拼豆画板。打开网页即可创作，也可以安装到 iPad 主屏幕，在联网后缓存资源，断网继续使用本机作品。

## 可以做什么

- 使用 MARD291 色库，按色号前缀分组，支持搜索、色系筛选、最近使用和色号显示。
- 创建 1–200 格的自定义画布，也可以使用常用尺寸预设。
- 使用画笔、填色、画布取色和多尺寸橡皮擦完成绘制。
- 使用 1×1、2×2、4×4、8×8 橡皮擦，并查看最近一笔擦除范围。
- 撤回和反撤回绘制、填色、擦除、清空、镜像和选区操作。
- 使用矩形选区移动色块、删除选区颜色，以及导出当前选区。
- 调整辅助线间隔、线型、深浅度和中心线颜色；四边标尺随画布移动保持连续编号。
- 显示或隐藏格内色号，字号随缩放变化并保持可读范围。
- 进入拼豆模式，同时选择多个颜色，只显示需要制作的颜色。
- 查看总颗数和各色用量，导出时可附加用色统计。
- 导出带网格的图纸或透明背景的色块图，也可以下载可继续编辑的 `.pindou` 文件。
- 使用屏幕取色、图片取色或 RGB/HEX 输入，并从 MARD 色库中选择相近颜色。
- 本机自动保存、刷新恢复和多作品管理；登录后可保存、打开、重命名和删除云端作品。

## 本地运行

环境要求：Node.js 22 或更新版本、Go 1.24 或更新版本。

在项目根目录执行：

```powershell
npm --prefix web ci
cd server
go mod download
cd ..
npm run dev
```

打开终端显示的地址，默认是 `http://localhost:5173/`。开发服务会同时启动前端和 Go API，按 `Ctrl+C` 停止。

预览正式构建：

```powershell
npm start
```

默认地址为 `http://localhost:4173/`。手机或平板与电脑连接同一 Wi-Fi 后，可以使用终端显示的局域网地址访问。

## 保存方式

- 本机保存：浏览器会自动保存当前草稿，作品也可以下载为 `.pindou` 文件。
- 云端保存：登录账号后，在顶部“画布操作”中选择“保存”，作品保存在服务器数据库中。
- PNG 导出：适合查看和分享；需要继续编辑时，请使用 `.pindou` 文件或云端作品。

本机作品属于当前设备和浏览器。清理网站数据、使用隐私浏览或更换网址后，本机列表可能不同；重要作品建议同时下载文件或保存云端。

## 部署

生产环境建议使用 HTTPS。后端监听本机地址，由 Caddy 或其他反向代理提供网页、API 和免费 HTTPS 证书。

部署文件位于 [`deploy/`](deploy/)：

- `pindou.env.example`：服务器环境变量模板。
- `pindou.service`：systemd 服务模板。
- `Caddyfile`：反向代理配置示例。
- [`IPAD_INSTALL.md`](deploy/IPAD_INSTALL.md)：服务器发布、添加到 iPad 主屏幕、离线验收和更新步骤。

典型发布流程：

1. 构建前端：`npm run build`。
2. 构建后端：`cd server; go build -trimpath -o bin/pindou-server ./cmd/server`。
3. 将 `web/dist`、后端程序和 `deploy` 配置上传到服务器。
4. 配置 `PUBLIC_ORIGIN`、数据库目录和网页目录，启动 `pindou.service`。
5. 配置域名和 HTTPS，使用 Safari 打开网址并添加到主屏幕。

服务器数据库默认为 SQLite，位于部署目录的数据文件中。定期执行项目提供的备份程序，并在备份前确认数据目录权限。

## 开发检查

```powershell
npm test
npm run build
cd server
go test ./...
go vet ./...
```

浏览器端到端测试：

```powershell
cd web
npm run test:e2e
```

运行端到端测试前，请先在另一个终端启动 `npm run dev`，并按 Playwright 提示安装浏览器运行环境。

## 技术概览

- 前端：React、TypeScript、Canvas、Vite、PWA。
- 后端：Go、SQLite、HTTP API。
- 本地数据：IndexedDB、浏览器缓存和可下载的 `.pindou` 文件。
- 云端数据：账号隔离的 SQLite 作品存储。

## 许可与色库

MARD291 色库来源、依赖许可和版权信息见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。色值用于屏幕预览，实际制作请以拼豆色卡为准。
