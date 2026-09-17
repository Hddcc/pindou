# 拼豆画板技术方案分析

本文基于 [拼豆软件PRD.md](D:/APP/Path_for_ide/Go/item/pindou/拼豆软件PRD.md)，配套实现说明见 [拼豆画板-implementation.md](D:/APP/Path_for_ide/Go/item/pindou/拼豆画板-implementation.md)。

## 1. 需求拆解

### 1.1 产品目标到技术责任

| 产品要求 | 后端责任 | 前端/PWA 责任 | 验收方式 |
| --- | --- | --- | --- |
| 手机和平板公开访问 | 提供 HTTPS、静态资源和 `/api/v1` 接口 | 响应式布局、主屏幕安装、触屏交互 | 手机流量和 Wi-Fi 打开公开链接 |
| 自由绘制方格图 | 保存和校验宽高、坐标、MARD291 色号 | Canvas 渲染、画笔、橡皮擦、取色器、油漆桶、缩放平移 | 100 × 100 画布手动编辑 |
| 撤回/反撤回 | 无 | 浏览器内维护编辑命令历史 | 普通填色、擦除、区域填充各执行撤回和反撤回 |
| 临时保存 | 无 | IndexedDB 防抖保存和恢复提示 | 刷新、切后台、重新打开后恢复 |
| 本地文件保存 | 无 | 生成和解析 `.pindou` JSON 文件 | 下载后再次导入，作品内容一致 |
| 云端保存 | 账号、会话、作品增删改查、版本冲突校验 | 登录、保存状态、失败重试和冲突选择 | 设备 A 保存，设备 B 打开；并发修改可发现 |
| 两种 PNG 导出 | 无 | Canvas 本地生成带网格/无网格 PNG | 像素尺寸、格线和透明空格符合 PRD |
| MARD291 色板 | 提供可校验的色号数据查询 | 搜索、排序、当前色、最近使用色 | 色号搜索与填色结果一致 |
| 低成本运行 | 单机轻量进程、SQLite、备份和日志 | 静态资源尽量小，渲染和导出在设备端完成 | 服务器重启后网页和云作品可用 |

### 1.2 明确的边界

- 公开绘制、导出和本地保存不要求登录。
- 云端作品属于登录用户，首版采用用户名和密码登录，不依赖短信或邮件服务。
- 首版账号不绑定邮箱或手机号，因此不提供自动找回密码；注册页明确提示用户妥善保存密码。
- 作品数据使用稀疏格子数组保存，空格不写入数组。
- PNG 在客户端生成，服务端只接收作品结构数据。
- 首版不做实时协同、社区、参考图片识别、支付和原生 App/小程序客户端。

### 1.3 已采用的技术假设

1. 现有云服务器可以运行一个长期进程，能够绑定 80/443 或由已有反向代理转发。
2. 正式公开访问使用域名和 HTTPS；公网 IP 仅用于临时测试。
3. MARD291 色库由产品方提供可合法使用的 JSON 数据，色号是历史作品的稳定标识。
4. 单个作品限制为 1 至 200 格宽高，最大 40,000 个非空格子；单作品请求体上限 2 MiB。
5. 首版最多保留 200 个云端作品/用户，达到上限后返回明确错误，避免免费服务器被无限占用。

## 2. 当前代码现状

### 2.1 仓库事实

仓库根目录目前只有产品需求文件 [拼豆软件PRD.md](D:/APP/Path_for_ide/Go/item/pindou/拼豆软件PRD.md)。未发现 Go 模块、`package.json`、前端入口、后端入口、HTTP 路由、数据库、配置文件、部署文件和测试文件。

因此以下内容全部属于新增技术方案：目录、类型、函数、接口、数据库表、错误码和部署配置均不能视为现有实现。implementation 文档会使用“新增”标识，方便后续建立第一版代码基线。

### 2.2 技术组件清单

| 组件 | 当前状态 | 方案用途 |
| --- | --- | --- |
| React + TypeScript + Vite | 新增计划 | 手机/平板界面、编辑器状态和构建 |
| 浏览器 Canvas 与 Pointer Events | 新增计划 | 方格绘制、缩放、平移和 PNG 导出 |
| PWA Service Worker | 新增计划 | 编辑器资源缓存、主屏幕启动 |
| Go 1.25 `net/http` | 新增计划 | 轻量 HTTP API 和静态部署配合 |
| SQLite + `modernc.org/sqlite` | 新增计划 | 用户、会话、作品和色库数据；纯 Go 驱动便于部署 |
| Caddy | 新增计划 | HTTPS、静态文件和 API 反向代理 |
| Go `testing`、Vitest、Playwright | 新增计划 | 单元、接口和移动端验收测试 |

## 3. 候选方案与最终选择

### 3.1 首版客户端形态

| 方案 | 实现路径 | 优点 | 代价与风险 |
| --- | --- | --- | --- |
| 响应式 Web + PWA | 服务器提供静态文件，浏览器使用 Canvas 和 IndexedDB | 一套前端覆盖 Android/iOS/平板/电脑；链接即可访问；无需应用商店；最适合复用现有服务器 | iOS 的主屏幕安装入口由系统控制；本地缓存可能被清理，必须提供文件下载 |
| 微信/支付宝小程序 | 注册平台主体和 AppID，配置合法域名，重写 Canvas/文件 API | 微信内传播方便，平台入口集中 | 需要平台审核和域名白名单；文件导入导出、存储和 Canvas API 受平台限制；用户必须在对应平台内使用 |
| 原生 App | 使用跨端框架打包 Android/iOS | 系统文件和离线能力更完整 | 需要打包、签名、商店发布和双端适配，首版成本高 |

**最终选择：响应式 Web + PWA。** 产品核心是公开链接可用和低成本部署，Web 方案可以直接复用云服务器。数据结构和 API 保持平台无关，未来增加小程序时复用云端服务。

### 3.2 前端技术

| 方案 | 取舍 |
| --- | --- |
| React + TypeScript + Vite | 组件生态成熟，适合工具栏、抽屉和作品列表；TypeScript 约束色号和作品数据；Vite 构建结果适合 Caddy 静态部署 |
| 原生 TypeScript | 依赖少，但复杂编辑器状态、页面状态和测试边界需要自行维护 |
| Canvas 库（Konva/Fabric 等） | 可减少部分绘制代码，但会增加包体和触屏/大画布行为的适配层 |

采用 React + TypeScript + Vite，绘图核心使用原生 Canvas 和 Pointer Events。画布只需要方格渲染和命中测试，原生 API 能减少依赖和运行开销。

### 3.3 后端与数据库

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| Go `net/http` + SQLite | 单二进制、内存占用小、部署简单；SQLite 足以支持作品结构数据；标准库可控 | 需要自行组织路由、验证和错误映射 |
| Node.js + Express/Fastify + SQLite | 前后端语言统一，生态丰富 | 运行时和依赖更多，原生 SQLite 模块可能带来构建问题 |
| Python FastAPI + SQLite | 接口开发快，文档工具成熟 | 需要 Python 虚拟环境和进程管理，单机资源略高 |
| 托管数据库 | 运维和备份更方便 | 免费额度、网络依赖和额外服务配置增加成本 |

采用 Go 1.25、`net/http`、`database/sql` 和 `modernc.org/sqlite`。SQLite 运行在同一台服务器，作品数据量小时无需购买独立数据库；通过 WAL、事务和每日备份保障基本可靠性。数据增长后可替换仓储实现迁移到 PostgreSQL，HTTP 契约保持不变。

### 3.4 账号与会话

| 方案 | 取舍 |
| --- | --- |
| 用户名+密码、自有会话 | 无短信/邮件费用，跨设备直接可用；Argon2id 保存密码摘要 | 需要处理密码安全、登录限流和会话失效 |
| 第三方 OAuth | 用户注册方便 | 依赖平台审核、回调配置和平台可用性 |
| 设备码/匿名云作品 | 无注册流程 | 设备丢失或清理数据后难以恢复，云端权限边界弱 |

采用用户名+密码和 HttpOnly 会话 Cookie。游客本地创作与账号流程完全分离，登录只在云保存时触发。

### 3.5 云保存一致性

| 方案 | 取舍 |
| --- | --- |
| 每个格子一个 API 操作 | 网络请求多，断线和撤回同步复杂 |
| 全量快照 PUT + 版本号 | 作品最大 2 MiB，移动网络下请求次数少；实现简单，可通过版本号发现并发修改 |
| 服务端保存操作日志 | 可追踪每一步，但存储和回放逻辑明显增加 |

采用全量快照保存。客户端每次保存发送作品名称、完整稀疏快照和基准版本。服务端对规范化名称与快照计算 SHA-256 摘要，随后在事务内校验当前版本：版本一致则递增保存，版本不一致且服务端现有摘要相同则视为重复重试，摘要不同则返回冲突。

## 4. 总体方案和完整调用链

### 4.1 部署拓扑

```text
手机/平板浏览器或 PWA
        │ HTTPS
        ▼
      Caddy
   ┌────┴─────────────┐
   │                  │
静态前端 dist      /api/v1 反向代理
                        │ HTTP 127.0.0.1
                        ▼
                 Go HTTP 服务
                        │
                        ▼
                  SQLite 数据库
```

前端渲染、临时保存和 PNG 导出都在设备端完成。Go 服务只处理色库读取、账号会话和云端作品结构数据。

### 4.2 分层设计

#### 前端

1. **页面展示层 `presentation`**：工作台、编辑器、色板、登录框、云作品列表、导出面板和状态提示。
2. **应用编排层 `application`**：把用户手势转换为编辑命令，编排本地保存、文件读写、云保存和冲突恢复。
3. **领域层 `domain`**：作品快照、格子坐标、颜色校验、油漆桶、撤回/反撤回和导出参数。该层不依赖 React 和浏览器 DOM，便于单元测试。
4. **基础设施层 `infrastructure`**：Canvas 适配、IndexedDB、`.pindou` 文件、PNG、HTTP 客户端和 PWA 注册。

#### 后端

1. **接入层 `internal/http`**：路由、请求解析、鉴权、限流、请求 ID、错误转换和 JSON 返回。
2. **应用层 `internal/app`**：注册登录、色库查询、作品创建/读取/保存/重命名/删除和版本冲突判断。
3. **领域层 `internal/domain`**：作品快照校验、名称/尺寸规则、色号引用规则和业务错误。
4. **仓储层 `internal/repository`**：用户、会话、作品、色库的 SQLite 读写和事务。
5. **配置与启动层 `internal/config`、`cmd/server`**：环境变量读取、数据库迁移、HTTP 服务挂载和优雅退出。

编辑器运行时使用按坐标索引的内存网格（`Map<y * width + x, colorCode>`），Canvas 命中和油漆桶读取均为 O(1)。稀疏 `cells` 数组只在加载、保存、文件导出和云端请求边界转换，避免手机端每次绘制线性扫描全部格子。

### 4.3 打开页面与加载色库

```text
浏览器请求 /
→ Caddy 返回 index.html 和静态资源
→ React 启动并注册 Service Worker
→ ColorClient.list()
→ GET /api/v1/colors
→ ColorHandler.List
→ ColorService.List
→ ColorRepository.ListAll
→ JSON 返回色号、名称、HEX、排序值和 active
→ 色板只展示 active=true 的颜色，历史作品可继续使用停用色号
```

色库只有 291 条左右数据，首版一次性返回全部颜色，搜索和排序在前端完成。成功响应同时写入 IndexedDB；离线时读取最近一次缓存的色库，保证本地作品仍可编辑。

### 4.4 编辑、撤回和临时保存

```text
用户单指点击/拖动
→ CanvasController.toCell(pointer)
→ EditorStore.dispatch(PaintCommand/EraseCommand/FillCommand)
→ EditorDomain.applyCommand
→ History.push
→ CanvasRenderer.render
→ LocalSaveCoordinator.schedule(1 秒防抖)
→ IndexedDB WorkRepository.putDraft
```

双指手势只更新视图变换矩阵，不生成编辑命令。一次连续拖动和一次油漆桶操作各生成一个历史命令。

### 4.5 本地文件保存和恢复

```text
点击“保存到本地”
→ PindouFileService.serialize(WorkDocument)
→ Blob + 浏览器下载

点击“本地打开”并选择文件
→ FileReader/Blob.text
→ PindouFileService.parse
→ WorkDomain.validateSnapshot
→ EditorStore.replaceDocument
→ IndexedDB 保存最近作品
```

解析失败只影响导入流程，当前编辑器文档保持不变。

### 4.6 云端登录和保存

```text
点击云保存
→ AuthStore.ensureSession
→ POST /api/v1/auth/login 或注册
→ HttpOnly Cookie 建立会话
→ WorkClient.create/update
→ WorkHandler
→ WorkService.validateAndSave
→ SQLite 事务读取当前 revision
→ 版本一致则写入并递增；冲突则返回 409
→ 前端更新保存状态或显示版本冲突面板
```

云端保存采用手动点击触发。编辑过程始终自动保存本地；网络失败时保留待上传快照并提供重试按钮。

### 4.7 PNG 导出

```text
点击导出
→ ExportService.render(snapshot, mode)
→ 创建离屏 Canvas
→ 按固定 cellPixelSize 绘制颜色块
→ grid 模式绘制格线，clean 模式保留透明空格
→ canvas.toBlob('image/png')
→ 浏览器下载作品名-grid.png 或作品名-clean.png
```

## 5. 接口和协议设计

### 5.1 HTTP 约定

- 基础路径：`/api/v1`。
- 请求和响应均使用 UTF-8 JSON；成功响应统一包含 `code`、`data`、`requestId`。
- 客户端可发送 `X-Request-ID`，服务端为空时生成并在响应中返回。
- 写操作要求 `Content-Type: application/json`；服务端限制 JSON 请求体 3 MiB。
- `POST /works` 要求 `Idempotency-Key` 请求头，值为客户端为本地作品生成的 UUID；同一用户重复提交同一个键时返回首次创建的作品。
- 会话使用 `pindou_session` Cookie：随机 32 字节令牌的哈希存入数据库；Cookie 使用 `HttpOnly`、`Secure`、`SameSite=Lax`，有效期 30 天。
- 所有时间使用 UTC RFC3339 字符串。
- API 不跨域部署，前端和 API 由同一个 HTTPS 域名提供，避免开放 CORS。
- `POST`、`PUT`、`PATCH`、`DELETE` 必须携带与 `PUBLIC_ORIGIN` 完全一致的 `Origin`，缺失或不一致时返回 `403 ORIGIN_FORBIDDEN`。

### 5.2 通用响应

成功示例：

```json
{
  "code": "OK",
  "data": {},
  "requestId": "01J..."
}
```

失败示例：

```json
{
  "code": "WORK_VERSION_CONFLICT",
  "message": "作品已在其他设备更新",
  "details": {
    "serverRevision": 8,
    "serverUpdatedAt": "2026-09-17T02:00:00Z"
  },
  "requestId": "01J..."
}
```

### 5.3 领域数据结构

```typescript
type Cell = {
  x: number;          // 0 <= x < width
  y: number;          // 0 <= y < height
  colorCode: string;  // MARD291 色号，例如 M001
};

type WorkSnapshot = {
  schemaVersion: 1;
  width: number;
  height: number;
  cells: Cell[];      // 按 y、x 升序；坐标不重复
};

type WorkDocument = {
  fileType: "pindou";
  schemaVersion: 1;
  name: string;
  snapshot: WorkSnapshot;
  updatedAt: string;
};
```

服务端保存 `WorkSnapshot` 的规范化 JSON、`name`、`contentHash` 和 `revision`。`contentHash` 计算对象固定为 `{name,snapshot}`；名称先按产品规则去除首尾空白，快照按字段顺序序列化。规范化步骤包括坐标边界校验、去重拒绝、按 `y,x` 排序和色号存在性校验。

### 5.4 公开接口

#### `GET /api/v1/healthz`

用途：部署探活，无需鉴权。Handler 使用 1 秒超时执行数据库 `PingContext`；成功返回 `200`，数据库不可用时返回 `503 DB_UNAVAILABLE`。

响应 `200`：

```json
{
  "code": "OK",
  "data": { "status": "ok" },
  "requestId": "01J..."
}
```

#### `GET /api/v1/colors`

用途：一次性读取全部 MARD291 色号。停用色号仍返回并标记 `active=false`，用于兼容历史作品；搜索、排序和可选颜色过滤由客户端本地完成。

响应 `200`：

```json
{
  "code": "OK",
  "data": {
    "version": "sha256:...",
    "items": [
      { "code": "M001", "name": "黑色", "hex": "#1A1A1A", "sortOrder": 1, "active": true }
    ]
  },
  "requestId": "01J..."
}
```

### 5.5 鉴权接口

#### `POST /api/v1/auth/register`

请求：

```json
{ "username": "pindou_user", "password": "至少8位密码" }
```

规则：用户名 3 至 32 个 ASCII 字母、数字、下划线；密码 8 至 72 个字符。成功创建用户并设置会话 Cookie。

响应 `201`：

```json
{
  "code": "OK",
  "data": {
    "user": { "id": "usr_...", "username": "pindou_user" },
    "expiresAt": "2026-10-17T02:00:00Z"
  },
  "requestId": "01J..."
}
```

#### `POST /api/v1/auth/login`

请求字段与注册一致。成功响应与注册一致；密码错误统一返回 `AUTH_INVALID_CREDENTIALS`，避免泄露用户名是否存在。

#### `POST /api/v1/auth/logout`

不要求会话仍然有效。服务端在 Cookie 存在时删除对应会话记录，并始终清除 Cookie、返回 `200`；重复退出也返回成功。

#### `GET /api/v1/me`

需要当前会话。响应返回当前用户 ID、用户名和会话到期时间。

### 5.6 云端作品接口

#### `GET /api/v1/works?limit=20&cursor=`

需要当前会话。`limit` 默认 20，最大 50；`cursor` 为服务端返回的不透明分页游标。

响应：

```json
{
  "code": "OK",
  "data": {
    "items": [
      {
        "id": "wrk_...",
        "name": "小房子",
        "width": 32,
        "height": 32,
        "revision": 4,
        "updatedAt": "2026-09-17T02:00:00Z"
      }
    ],
    "nextCursor": null
  },
  "requestId": "01J..."
}
```

#### `POST /api/v1/works`

需要当前会话。创建云端作品，请求头包含 `Idempotency-Key: <UUID>`，请求体为：

```json
{
  "name": "小房子",
  "snapshot": {
    "schemaVersion": 1,
    "width": 32,
    "height": 32,
    "cells": [{ "x": 1, "y": 1, "colorCode": "M001" }]
  },
  "clientUpdatedAt": "2026-09-17T02:00:00Z"
}
```

首次创建响应 `201`，相同幂等键重试响应 `200`；两者都返回同一个完整 `Work`：`id`、`name`、`snapshot`、`revision=1`、`contentHash`、`createdAt`、`updatedAt`。

#### `GET /api/v1/works/{workId}`

需要当前会话且只能读取自己的作品。作品不存在或不属于当前用户时统一返回 `404 WORK_NOT_FOUND`；存在时响应 `200` 返回完整 `Work`。

#### `PUT /api/v1/works/{workId}`

需要当前会话。全量替换作品，请求：

```json
{
  "name": "小房子-修改",
  "snapshot": {
    "schemaVersion": 1,
    "width": 32,
    "height": 32,
    "cells": [{ "x": 1, "y": 1, "colorCode": "M002" }]
  },
  "baseRevision": 4,
  "clientUpdatedAt": "2026-09-17T02:01:00Z"
}
```

事务内规则：当前 `revision` 等于 `baseRevision` 时保存并递增；当前摘要等于服务端根据本次请求计算出的摘要时返回当前作品，支持移动网络重试；其余情况返回 `409 WORK_VERSION_CONFLICT`。

#### `PATCH /api/v1/works/{workId}`

需要当前会话。仅重命名，请求：

```json
{ "name": "新名称", "baseRevision": 4 }
```

成功后递增 `revision` 并返回完整作品元数据。

#### `DELETE /api/v1/works/{workId}?baseRevision=4`

需要当前会话。前端确认后携带当前看到的版本删除作品；服务端版本不同则返回 `409 WORK_VERSION_CONFLICT`，避免旧设备删除其他设备的新修改。成功响应 `200`，`data` 为 `{ "deleted": true }`。

### 5.7 错误码

| HTTP | 错误码 | 触发条件 | 客户端处理 |
| --- | --- | --- | --- |
| 400 | `INVALID_JSON` | JSON 无法解析 | 提示请求无效，保留当前作品 |
| 400 | `INVALID_ARGUMENT` | 查询参数或字段格式错误 | 定位字段并提示 |
| 400 | `AUTH_USERNAME_INVALID` | 用户名不符合规则 | 注册表单提示 |
| 400 | `AUTH_PASSWORD_WEAK` | 密码长度不符合要求 | 注册表单提示 |
| 400 | `WORK_NAME_INVALID` | 名称为空或超过 80 字符 | 名称输入框提示 |
| 400 | `WORK_SIZE_INVALID` | 宽高不在 1 至 200 | 新建画布提示 |
| 400 | `WORK_SNAPSHOT_INVALID` | 坐标重复、越界、排序或结构不合法 | 保留本地版本并提示文件/作品无效 |
| 400 | `WORK_COLOR_UNKNOWN` | 色号不在色库 | 更新色库或修复本地文件 |
| 401 | `AUTH_REQUIRED` | 需要登录但没有有效会话 | 打开登录框，保留本地作品 |
| 401 | `AUTH_SESSION_EXPIRED` | 会话已过期 | 重新登录，保留待上传快照 |
| 401 | `AUTH_INVALID_CREDENTIALS` | 用户名或密码错误 | 显示统一登录失败提示 |
| 403 | `ORIGIN_FORBIDDEN` | 写请求的 Origin 与公开地址不匹配 | 停止请求并提示重新打开公开链接 |
| 404 | `WORK_NOT_FOUND` | 作品不存在或已删除 | 刷新云端列表 |
| 409 | `AUTH_USERNAME_TAKEN` | 用户名已存在 | 提示更换用户名 |
| 409 | `WORK_VERSION_CONFLICT` | 多设备修改版本不同 | 拉取服务器版本，提供保留本地/云端选择 |
| 409 | `WORK_LIMIT_REACHED` | 用户作品数达到 200 | 提示删除旧作品 |
| 413 | `PAYLOAD_TOO_LARGE` | 请求超过 3 MiB 或作品超过 2 MiB | 提示减小画布或拆分作品 |
| 429 | `RATE_LIMITED` | 登录/注册请求过频 | 显示稍后重试倒计时 |
| 500 | `INTERNAL_ERROR` | 未分类服务错误 | 显示 requestId，支持重试 |
| 503 | `DB_UNAVAILABLE` | 数据库不可用或锁超时 | 保留本地版本，稍后重试 |

错误响应始终包含 `code`、面向用户的 `message`、可选 `details` 和 `requestId`。数据库、密码摘要等内部信息只写服务端日志。

客户端本地错误不经过 API：

| 错误码 | 触发条件 | 处理 |
| --- | --- | --- |
| `LOCAL_FILE_INVALID` | `.pindou` 文件解析、版本或内容校验失败 | 保持当前作品不变，提示重新选择文件 |
| `EXPORT_TOO_LARGE` | 当前设备 Canvas 无法创建目标像素尺寸 | 提示降低导出单格尺寸或缩小画布 |

## 6. 数据、配置和异步设计

### 6.1 SQLite 表

#### `users`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | TEXT | 主键，`usr_` 前缀的随机 ID |
| `username` | TEXT | 唯一，保存规范化小写值 |
| `password_hash` | TEXT | Argon2id 摘要 |
| `created_at` | INTEGER | Unix 毫秒 |
| `updated_at` | INTEGER | Unix 毫秒 |

#### `sessions`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id_hash` | TEXT | 主键，Cookie 令牌 SHA-256 |
| `user_id` | TEXT | 外键 `users.id` |
| `expires_at` | INTEGER | Unix 毫秒，建立索引 |
| `created_at` | INTEGER | Unix 毫秒 |

#### `colors`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `code` | TEXT | 主键，MARD291 色号 |
| `name` | TEXT | 颜色名称，可为空 |
| `hex` | TEXT | `#RRGGBB` 展示值 |
| `sort_order` | INTEGER | 色板排序 |
| `active` | INTEGER | 1 可选，0 停用 |
| `updated_at` | INTEGER | Unix 毫秒 |

#### `works`

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `id` | TEXT | 主键，`wrk_` 前缀的随机 ID |
| `user_id` | TEXT | 外键 `users.id` |
| `name` | TEXT | 作品名称 |
| `width` | INTEGER | 1 至 200 |
| `height` | INTEGER | 1 至 200 |
| `snapshot_json` | TEXT | 规范化 `WorkSnapshot` JSON |
| `content_hash` | TEXT | SHA-256，含 `sha256:` 前缀 |
| `create_key` | TEXT | 创建幂等键；同一用户内唯一 |
| `revision` | INTEGER | 从 1 开始递增 |
| `created_at` | INTEGER | Unix 毫秒 |
| `updated_at` | INTEGER | Unix 毫秒 |

约束和索引：`users.username` 唯一；`works(user_id, create_key)` 唯一；`works(user_id, updated_at DESC)` 索引；`sessions(expires_at)` 索引；外键开启。删除用户时级联删除会话和作品，首版不提供用户注销入口。

### 6.2 配置

| 环境变量 | 默认值 | 作用 |
| --- | --- | --- |
| `HTTP_ADDR` | `127.0.0.1:8080` | Go 服务监听地址 |
| `DB_PATH` | `./data/pindou.db` | SQLite 文件路径 |
| `SESSION_TTL` | `720h` | 会话有效期 |
| `COOKIE_SECURE` | `true` | HTTPS 环境启用 Secure Cookie |
| `MAX_WORKS_PER_USER` | `200` | 单用户作品数量上限 |
| `MAX_WORK_BYTES` | `2097152` | 单作品快照上限 |
| `LOG_LEVEL` | `info` | `slog` 日志级别 |
| `PUBLIC_ORIGIN` | 必填 | Caddy 公开 HTTPS 地址，用于 Origin 校验和部署检查 |

生产环境通过 systemd EnvironmentFile 注入，密钥和数据库路径不提交仓库。开发环境允许 `COOKIE_SECURE=false`，只用于本机 HTTP。

### 6.3 事务、幂等和异步

- 注册在一个事务中完成用户名检查、用户写入和会话写入；唯一索引负责最后一道并发保护。
- `PUT /works/{id}` 在一个 SQLite 事务中读取当前版本、校验摘要、更新内容和递增版本。
- 创建作品先按用户与幂等键查找已有记录，再在一个事务中统计作品数并插入，保证网络重试不重复创建、并发创建不越过 200 件上限。
- 删除作品使用单事务 `DELETE ... WHERE id=? AND user_id=? AND revision=?`；作品存在但版本不同返回 `WORK_VERSION_CONFLICT`，作品不存在返回 `WORK_NOT_FOUND`。
- `PUT` 重试通过 `content_hash` 判断重复请求，避免新增请求日志表。
- 服务端首版没有消息队列、事件总线和后台业务任务。客户端本地保存使用 1 秒防抖、10 秒兜底定时器；云端保存由用户点击触发。
- 过期会话在鉴权请求中按概率或每次查询顺便清理；清理失败不影响当前请求。
- SQLite 使用单写连接，连接建立时启用 `foreign_keys=ON`、WAL 和 5 秒 `busy_timeout`，避免连接池中的新连接绕过约束或锁等待设置。

## 7. 前端和客户端联调

### 7.1 前端消费约定

- `GET /colors` 返回的 `code` 是唯一业务标识，`hex` 用于显示和渲染；`active=false` 的颜色不进入新作品色板，但仍用于历史作品解析。
- Service Worker 只预缓存带内容哈希的前端静态资源和离线壳；`/api/*` 使用网络请求，账号和云作品响应不进入 Cache Storage。
- 编辑器只向本地领域层提交坐标和色号，不直接操作 API。
- 云端保存成功后，以服务端返回的 `revision`、`updatedAt` 和 `contentHash` 更新本地云状态。
- `AUTH_REQUIRED` 和 `AUTH_SESSION_EXPIRED` 打开登录流程，当前画布和待上传快照保存在 IndexedDB。
- `WORK_VERSION_CONFLICT` 先调用 `GET /works/{id}`，用户选择服务器版本或本地版本；选择本地版本后以最新服务器 `revision` 作为下一次保存的 `baseRevision`。
- `DB_UNAVAILABLE`、网络超时和离线状态都显示“已保留本地版本”，提供重试。

### 7.2 触屏联调事项

- Canvas 使用 Pointer Events，监听 `pointerdown/move/up/cancel`，通过 `touch-action: none` 避免页面滚动抢夺单指绘画。
- 双指存在时暂停画笔命中，更新 `scale`、`translateX`、`translateY`；手指数量恢复为 1 后再允许绘画。
- 手机端工具栏触摸目标至少 44 × 44px；色板抽屉打开时画布缩放比例和中心点保持不变。
- 竖屏、横屏、刘海和底部手势区域由前端处理，服务端只返回数据和状态。
- 文件下载在 iOS 上可能弹出系统预览，客户端提供“分享/存储到文件”入口作为消费路径。

### 7.3 客户端独立决定事项

以下事项不改变后端契约：工具图标、色板具体视觉、格线颜色、单格像素尺寸、导出预览布局、登录弹窗样式和 PWA 安装提示文案。前端负责保证这些决定符合 PRD 的触屏可用性要求。

## 8. 风险、兼容和发布

### 8.1 风险处理

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 浏览器清理 IndexedDB | 游客临时作品丢失 | 自动提示下载 `.pindou`；主动下载作为明确的本地保存能力 |
| iOS PWA 安装入口差异 | 用户找不到主屏幕入口 | PWA 安装为可选增强，公开链接始终可用 |
| MARD291 色值来源或授权不清 | 色板发布和法律风险 | 仅发布产品方有权使用的数据，保留色号来源记录 |
| SQLite 锁和磁盘损坏 | 云保存失败或数据丢失 | WAL、忙等待、每日数据库备份、服务端错误监控 |
| 多设备同时保存 | 覆盖用户作品 | revision + contentHash 冲突提示，禁止静默覆盖 |
| 登录接口被滥用 | 服务器资源和账号安全 | 请求体限制、IP 登录限流、Argon2id、Secure Cookie |
| 作品数据过大 | 移动网络慢、内存压力 | 200 × 200 尺寸上限、2 MiB 单作品上限、客户端本地渲染 |

### 8.2 发布顺序

1. 构建前端静态资源和 Go 服务，执行单测、接口测试和移动端 Playwright 验收。
2. 在服务器创建数据目录、导入色库、执行数据库迁移。
3. 启动 Go 服务，仅监听 `127.0.0.1:8080`；Caddy 负责公开 HTTPS 和 `/api` 代理。
4. 先用测试域名验证注册、云保存、备份和恢复，再切换正式域名。
5. 每次发布保留上一个 `dist` 目录和 Go 二进制；健康检查失败时恢复上一版本。

### 8.3 观测与回滚

- 服务端使用 JSON 日志记录 `requestId`、路由、状态码、耗时、用户 ID（仅内部日志）和错误码。
- 监控 `/api/v1/healthz`、5xx 数量、数据库锁超时、磁盘剩余空间和备份结果。
- 前端仅上报不含作品内容的错误事件，例如导出失败类型和 API 错误码；作品色块和账号密码不得进入日志。
- 回滚静态资源与 Go 二进制时保持数据库向后兼容；数据库迁移采用向前兼容字段，禁止发布后删除旧字段。

## 9. 验收标准

### 9.1 功能验收

- 手机和平板通过公开 HTTPS 链接打开页面，游客可完成新建、绘制、油漆桶、撤回、反撤回和 PNG 导出。
- Android Chrome、iOS Safari、iPadOS Safari 在 360px 手机宽度和 768px 平板宽度下无横向溢出。
- 单指绘画、双指缩放/平移、底部工具栏和色板抽屉可以连续使用，手势不误触。
- 刷新和切后台后 IndexedDB 能恢复最近作品；下载的 `.pindou` 文件能重新导入。
- 登录用户能创建、查询、修改、重命名和删除自己的云端作品。
- 设备 A 保存后设备 B 能读取；设备 B 基于旧 revision 保存时收到 `WORK_VERSION_CONFLICT`，用户能选择版本。
- 带网格 PNG 包含规则格线；无网格 PNG 不含格线且空格透明；两种导出图案位置一致。

### 9.2 工程验收

- `npm run build` 生成可由 Caddy 托管的静态目录。
- `go test ./...` 通过领域、仓储和 HTTP 接口测试。
- 服务器重启后 `/api/v1/healthz` 返回 `OK`，数据库和作品数据完整。
- 备份文件可在临时目录恢复并读取作品。
- 错误响应符合统一结构，未知错误带 `requestId` 且不泄露内部信息。
