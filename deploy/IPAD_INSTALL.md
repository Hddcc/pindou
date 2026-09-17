# iPad 安装与离线使用

本项目按 iPadOS 14.7.1 / Safari 14 做了兼容实现：使用实际可见高度限制编辑页，顶部操作区和底部工具栏留在屏幕内；提供旧版 Safari 的保存和弹窗兼容路径。自动化检查包含现代 WebKit 引擎以及旧版缺失接口的模拟，最终仍需要在你的 iPad 上验收。

离线自动化检查会缓存正式构建、关闭独立临时服务，再验证缓存启动、恢复作品、继续编辑与本地下载。Windows WebKit 的驱动断网切换会产生导航内部错误，因此该引擎用服务器不可达的方式验证；iPad 真正开启飞行模式的验收步骤见第四节。

交付方式为 PWA：先将程序发布到 HTTPS 网址，再通过 Safari 添加到主屏幕。无需 App Store 账号、苹果开发者会员或安装描述文件。首次联网缓存后可以离线绘图和保存本机作品；云作品操作需要联网。

## 一、先在当前 iPad 检查适配

1. 先用“保存 → 保存到本地”下载重要作品的 `.pindou` 文件，检查它出现在“文件”App 中。
2. 在与电脑同一 Wi-Fi 下打开当前测试网址 `http://192.168.110.159:4173/`。电脑地址变化后，以电脑最新的局域网地址为准。
3. 刷新页面；如果显示“新版本已准备好”，点击“更新”。
4. 竖屏和横屏各检查一次：顶部保存、撤回与底部工具栏同时可见；中间画布可缩放、平移；上下滑动画布不会把整个编辑页滚走。
5. 打开色板、保存、导出、作品列表和取色窗口，确认可关闭并返回画板。选择图片后测试返回，取消选择也应保留当前作品。
6. 修改作品，等到“已自动保存”，刷新后确认内容恢复。

这个 HTTP 地址用于局域网测试，离线缓存和正式安装请使用下一节的可信 HTTPS 地址。切换网址、换设备、换浏览器或从 Safari 网页切到主屏幕应用时，本机存储可能独立；使用 `.pindou` 文件迁移作品。

## 二、发布到已有云服务器

以下示例适用于使用 systemd 的 Linux 服务器。需要一个域名或平台提供的稳定 HTTPS 域名。将示例 `beads.example.com` 替换为你的实际域名。已有其他网站时，请保留原站点配置和数据。

### 1. 准备域名、端口和工具

- 为域名配置 DNS A 记录，指向服务器公网 IPv4。配置 AAAA 记录时，请确认服务器 IPv6 同样可达。
- 在云服务器安全组及系统防火墙中放行 TCP 80、443。
- 后端监听 `127.0.0.1:8080`，无需向公网开放 8080。
- 服务器构建后端需要 Go 1.24 或更新版本。
- 安装 Caddy；Ubuntu/Debian 的安装步骤参考 [Caddy 官方说明](https://caddyserver.com/docs/install)。Caddy 可自动申请和续期免费 HTTPS 证书。
- 中国大陆服务器使用自有域名公开提供网站服务时，请先确认云厂商的备案要求。

### 2. 构建和上传

在本机项目根目录运行：

```powershell
npm.cmd run build
```

通过 SFTP 上传以下内容到服务器的一个发布目录，例如 `/srv/pindou-release`：

- `web/dist`，保留其中全部文件与子目录。
- `server` 的源代码，包括 `go.mod`、`go.sum`、`assets.go`、`cmd`、`internal`、`migrations`，以及 `server/data/mard291.json` 默认色库。仅上传这个色库 JSON，不上传该目录中的数据库、WAL 等开发数据文件。
- `deploy` 配置模板。

正式发布使用新的服务器数据库，避免上传开发测试账号和测试作品。已有正式数据库时请保留并先备份。

在服务器运行：

```sh
cd /srv/pindou-release/server
go build -trimpath -o bin/pindou-server ./cmd/server
```

后端编译时嵌入 `server/migrations/*.sql` 和 `server/data/mard291.json`，请确认它们已包含在上传内容中。无需上传 `node_modules`、浏览器测试结果或本机数据库。

### 3. 创建专用目录和服务账号

下面的账号创建命令用于首次部署，已有 `pindou` 账号时可跳过。

```sh
sudo useradd --system --home-dir /opt/pindou --shell /usr/sbin/nologin pindou
sudo mkdir -p /opt/pindou/web /opt/pindou/bin /opt/pindou/data /opt/pindou/backups
sudo chown pindou:pindou /opt/pindou/data /opt/pindou/backups
sudo install -m 755 /srv/pindou-release/server/bin/pindou-server /opt/pindou/bin/pindou-server
sudo cp -r /srv/pindou-release/web/dist/. /opt/pindou/web/
```

静态网页应对 Caddy 的运行账号可读。更新时保留服务器数据库；复制新构建时保留旧的哈希资源一段时间，方便已经打开的页面平稳更新。

### 4. 配置并启动后端

将 `deploy/pindou.env.example` 放到 `/opt/pindou/pindou.env`，内容如下，域名替换成实际值：

```dotenv
HTTP_ADDR=127.0.0.1:8080
PUBLIC_ORIGIN=https://beads.example.com
COOKIE_SECURE=true
DB_PATH=/opt/pindou/data/pindou.db
WEB_DIR=/opt/pindou/web
SESSION_TTL=720h
MAX_WORKS_PER_USER=200
MAX_WORK_BYTES=2097152
```

`PUBLIC_ORIGIN` 必须与用户实际访问的 HTTPS 域名一致，末尾不加 `/`。建议配置文件权限为 600。

将 `deploy/pindou.service` 放到 `/etc/systemd/system/pindou.service`，然后运行：

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now pindou
sudo systemctl status pindou
```

启动失败时检查：

```sh
sudo journalctl -u pindou -n 80 --no-pager
```

### 5. 配置 HTTPS 网站

将 `deploy/Caddyfile` 中的站点块加入 `/etc/caddy/Caddyfile`，把 `beads.example.com` 替换为实际域名。保留模板中的 API 反向代理和 `sw.js` / 首页不缓存配置。

```sh
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

通过手机移动网络打开 `https://beads.example.com`，确认页面无证书警告，绘图、注册/登录和云保存正常。自签名证书或忽略证书警告无法提供可靠的安装与离线体验。

已有反向代理时可以沿用，只需满足同域 HTTPS、`/api/*` 转发到后端、`sw.js` 与 HTML 正确更新、其他静态文件可访问。域名和流量成本按你的套餐计算。

## 三、在 iPad 添加到主屏幕

1. 用 Safari 打开正式 HTTPS 网址，等待画板加载完成。
2. 点击 Safari 的分享按钮，即方框向上箭头。
3. 在分享菜单中向下找“添加到主屏幕”，名称可以保留“拼豆画板”，点击“添加”。
4. 回到 iPad 主屏幕，点击新图标。第一次从这个图标进入时保持联网。
5. 等到画布下方显示“离线可用”。它表示程序资源已缓存，本机作品保存状态仍以“已自动保存”为准。
6. 如需迁移旧作品，在此窗口中打开“我的作品 → 本地打开”，选择之前下载的 `.pindou` 文件。

Safari 14 没有桌面浏览器式的自动安装按钮；通过分享菜单添加即可。这个应用入口以独立窗口运行，服务器负责初次分发、更新及云存储。

## 四、断网验收

1. 在主屏幕应用中画几格，等到“已自动保存”，并确认“离线可用”。
2. 开启飞行模式，再检查 Wi-Fi 已关闭。
3. 从应用切换器关闭拼豆画板，再点击主屏幕图标重新打开。
4. 确认作品恢复，测试画笔、撤回、橡皮擦、选区和色板。
5. 测试“保存到本地”和 PNG 导出；在“文件”App 中核对下载结果。
6. 继续绘图并等到自动保存，再关闭重开，确认断网期间的修改仍在。
7. 恢复网络后，登录并手动保存云端。当前版本不会自动把离线修改上传到云端。

首次访问尚未完成缓存、清理网站数据、删除主屏幕入口或系统清理存储，都可能导致离线资源或本机作品丢失。重要作品定期下载文件并保存云端；本机保存只在当前设备中生效。

## 五、更新和故障检查

- 安装新版：先构建并上传，用户下次联网打开会检查更新，出现提示时点击“更新”。更新前会先尝试保存草稿。
- 找不到“离线可用”：检查是否为可信 HTTPS、是否使用正式构建、是否开启隐私浏览或限制了存储；保持联网关闭并重开一次，然后再检查。
- 添加后断网无法打开：先恢复网络，从主屏幕图标进入并完成缓存，再重新执行断网验收。
- 更换域名后作品列表为空：旧域名的本机数据仍留在原存储空间，先从旧地址下载 `.pindou` 文件，再导入新地址。
- Safari 内有作品但主屏幕应用没有：两个运行环境可能使用独立存储，使用作品文件迁移。
- 顶部或底部仍被裁切：记录横竖屏、Safari 页面缩放设置、是否在主屏幕应用中，并提供完整屏幕截图。自动化 WebKit 检查不能覆盖 iPadOS 14.7.1 的全部系统行为。

数据库备份与恢复方式见根目录 `README.md`。公网部署前建议安排每日备份，并结合服务器资源评估用户数量和防滥用措施。
