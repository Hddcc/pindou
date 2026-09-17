# 拼豆画板详细技术实现

本文基于 拼豆软件PRD.md 编写，配套技术方案见 拼豆画板-solution.md。当前仓库只有 PRD，没有可复用的代码、依赖、配置或测试；本文中的目录、文件、类型、函数和配置均为新增实现。

## 0. 改动清单

### 0.1 新增前端工程

~~~text
web/
├── package.json
├── package-lock.json
├── tsconfig.json
├── vite.config.ts
├── index.html
├── public/
│   ├── manifest.webmanifest
│   └── icons/icon-192.png、icon-512.png
└── src/
    ├── main.tsx
    ├── app/App.tsx
    ├── domain/work/types.ts
    ├── domain/work/validation.ts
    ├── domain/editor/commands.ts
    ├── domain/editor/grid.ts
    ├── domain/editor/flood-fill.ts
    ├── domain/editor/history.ts
    ├── domain/editor/reducer.ts
    ├── application/editor/editor-controller.ts
    ├── application/save/local-save-coordinator.ts
    ├── application/save/cloud-save-service.ts
    ├── application/auth/auth-service.ts
    ├── infrastructure/canvas/canvas-renderer.ts
    ├── infrastructure/canvas/pointer-controller.ts
    ├── infrastructure/local/indexeddb.ts
    ├── infrastructure/local/work-repository.ts
    ├── infrastructure/files/pindou-file.ts
    ├── infrastructure/export/png-exporter.ts
    ├── infrastructure/http/api-client.ts
    ├── infrastructure/http/color-api.ts
    ├── infrastructure/http/auth-api.ts
    ├── infrastructure/http/work-api.ts
    ├── pwa/register.ts
    └── presentation/
        ├── workspace/WorkspacePage.tsx
        ├── editor/EditorPage.tsx
        ├── editor/CanvasView.tsx
        ├── editor/ToolBar.tsx
        ├── editor/ColorDrawer.tsx
        ├── editor/ExportDialog.tsx
        ├── auth/LoginDialog.tsx
        └── common/Toast.tsx
~~~

### 0.2 新增后端工程

~~~text
server/
├── go.mod
├── go.sum
├── cmd/
│   ├── server/main.go
│   ├── colorimport/main.go
│   └── backup/main.go
├── migrations/001_init.sql
├── data/mard291.json
└── internal/
    ├── config/config.go
    ├── domain/
    │   ├── errors.go
    │   ├── id.go
    │   ├── user.go
    │   ├── color.go
    │   └── work.go
    ├── app/
    │   ├── auth_service.go
    │   ├── color_service.go
    │   └── work_service.go
    ├── repository/
    │   ├── user_repository.go
    │   ├── session_repository.go
    │   ├── color_repository.go
    │   ├── work_repository.go
    │   └── sqlite/
    │       ├── db.go
    │       ├── migration.go
    │       └── repositories.go
    ├── security/password.go
    └── http/
        ├── router.go
        ├── response.go
        ├── request.go
        ├── middleware.go
        └── handler/
            ├── health.go
            ├── colors.go
            ├── auth.go
            ├── works.go
            └── dto.go
~~~

### 0.3 新增部署和测试资产

~~~text
deploy/pindou.service
deploy/pindou-backup.service
deploy/pindou-backup.timer
deploy/Caddyfile
deploy/pindou.env.example
docs/openapi.yaml
web/tests/*.test.ts
web/e2e/*.spec.ts
server/internal/*/*_test.go
~~~

所有文件都是新增文件。docs/openapi.yaml 是接口契约源文件，字段、错误码和示例必须与 solution 文档保持一致。

## 1. 协议和依赖

### 1.1 前端依赖

| 依赖 | 用途 |
| --- | --- |
| React 19 | 页面和组件 |
| TypeScript | 作品、色号和 API 类型约束 |
| Vite | 开发服务器和静态构建 |
| vite-plugin-pwa | manifest 和 Service Worker |
| Vitest | 领域和文件处理单测 |
| Playwright | 手机/平板浏览器验收 |

画布、IndexedDB、文件下载和 PNG 导出使用浏览器原生 API。前端不引入 Canvas 编辑器库，避免大包体和额外触屏适配层。

### 1.2 后端依赖

| 依赖 | 用途 |
| --- | --- |
| Go 1.25 net/http | HTTP 服务 |
| Go database/sql | SQLite 访问和事务 |
| modernc.org/sqlite | 纯 Go SQLite 驱动，免 CGO 部署 |
| golang.org/x/crypto/argon2 | 用户密码摘要 |
| crypto/sha256 | 会话令牌和作品摘要 |
| log/slog | 结构化日志 |
| testing、httptest | 单元和 HTTP 集成测试 |

依赖版本由 package-lock.json 和 go.sum 锁定。前后端构建均使用锁定依赖。

### 1.3 HTTP 公共约定

- 基础路径为 /api/v1。
- 请求和响应使用 UTF-8 JSON。
- 成功响应包含 code、data、requestId；失败响应包含 code、message、details（可选）、requestId。
- 客户端可以发送 X-Request-ID；缺少时服务端生成。
- JSON 请求体限制 3 MiB；单作品快照限制 2 MiB。
- 会话 Cookie 名为 pindou_session，值为随机 32 字节令牌。数据库只保存令牌的 SHA-256。
- Cookie 使用 HttpOnly、Secure、SameSite=Lax，有效期 30 天。
- 时间使用 UTC RFC3339。
- 前端和 API 使用同一 HTTPS 域名，生产环境不开放跨域。

### 1.4 请求解码和响应

新增 server/internal/http/request.go：

~~~go
func DecodeJSON(w http.ResponseWriter, r *http.Request, dst any) error
func RequestID(r *http.Request) string
func PathParam(r *http.Request, name string) string
~~~

DecodeJSON 使用 MaxBytesReader 限制请求体，解析一个 JSON 值并检查尾部数据。JSON 语法错误返回 INVALID_JSON；字段业务校验交给应用层和领域层。

新增 server/internal/http/response.go：

~~~go
type Envelope struct {
    Code      string
    Data      any
    Message   string
    Details   any
    RequestID string
}

func WriteJSON(w http.ResponseWriter, requestID string, status int, data any)
func WriteAPIError(w http.ResponseWriter, requestID string, err error)
~~~

WriteAPIError 映射领域错误到统一 HTTP 状态和错误码；未识别错误返回 INTERNAL_ERROR，内部错误只进入日志。

## 2. 内部类型和配置

### 2.1 前端作品类型

新增 web/src/domain/work/types.ts：

~~~typescript
export type Cell = {
  x: number;
  y: number;
  colorCode: string;
};

export type WorkSnapshot = {
  schemaVersion: 1;
  width: number;
  height: number;
  cells: Cell[];
};

export type WorkDocument = {
  fileType: "pindou";
  schemaVersion: 1;
  name: string;
  snapshot: WorkSnapshot;
  updatedAt: string;
};

export type WorkMetadata = Omit<WorkDocument, "snapshot">;

export type WorkSummary = {
  id: string;
  name: string;
  width: number;
  height: number;
  revision: number;
  updatedAt: string;
};
~~~

规范化要求：cells 按 y、x 升序；同一坐标只出现一次；x 范围为 0 至 width-1；y 范围为 0 至 height-1。

### 2.2 前端编辑命令

新增 web/src/domain/editor/commands.ts：

~~~typescript
export type CellChange = {
  x: number;
  y: number;
  before: string | null;
  after: string | null;
};

export type EditorCommand =
  | { type: "paint"; changes: CellChange[] }
  | { type: "erase"; changes: CellChange[] }
  | { type: "fill"; changes: CellChange[] };

export type HistoryCommand = {
  type: EditorCommand["type"];
  palette: Array<string | null>;
  keys: Uint32Array;
  beforeIndexes: Uint16Array;
  afterIndexes: Uint16Array;
};

export function compactCommand(
  command: EditorCommand,
  width: number,
): HistoryCommand;
~~~

新增 web/src/domain/editor/grid.ts，作为编辑器运行时索引：

~~~typescript
export type CellGrid = {
  width: number;
  height: number;
  values: Map<number, string>;
};

export function gridFromSnapshot(snapshot: WorkSnapshot): CellGrid;
export function snapshotFromGrid(grid: CellGrid): WorkSnapshot;
export function gridKey(x: number, y: number, width: number): number;
export function documentFromGrid(
  metadata: WorkMetadata,
  grid: CellGrid,
): WorkDocument;
~~~

`values` 只记录非空格，键为 `y * width + x`。Canvas 命中、取色、油漆桶和撤回均读取 `CellGrid`；保存、哈希、`.pindou` 和 API 边界调用 `snapshotFromGrid` 生成排序后的稀疏数组。

新增 web/src/domain/editor/reducer.ts：

~~~typescript
export type EditorState = {
  metadata: WorkMetadata;
  grid: CellGrid;
  selectedColor: string | null;
  tool: "paint" | "erase" | "picker" | "fill" | "pan";
  history: HistoryState;
  view: { scale: number; translateX: number; translateY: number };
  dirty: boolean;
  cloud: {
    status: "none" | "saving" | "saved" | "failed";
    revision: number | null;
  };
};

export function editorReducer(
  state: EditorState,
  action: EditorAction,
): EditorState;
~~~

新增命令后清空 redo 栈；历史栈最多保留 100 条命令。新建或打开另一作品时创建新的空历史栈；保存、导出和视图变换不影响历史栈。

### 2.3 后端领域类型

新增 `server/internal/domain/id.go`：

~~~go
func NewID(prefix string) (string, error)
~~~

`NewID` 使用 `crypto/rand` 生成 16 字节随机数，编码为无填充的小写 base32，并添加 `usr_`、`wrk_` 或 `req_` 前缀。用户 ID、作品 ID 和缺省 requestId 共用这一实现，不依赖数据库自增值。

新增 `server/internal/domain/color.go`：

~~~go
type Color struct {
    Code string
    Name string
    Hex string
    SortOrder int
    Active bool
}
~~~

新增 server/internal/domain/work.go：

~~~go
type Cell struct {
    X int
    Y int
    ColorCode string
}

type WorkSnapshot struct {
    SchemaVersion int
    Width int
    Height int
    Cells []Cell
}

type Work struct {
    ID string
    UserID string
    Name string
    Snapshot WorkSnapshot
    ContentHash string
    CreateKey string
    Revision int64
    CreatedAt time.Time
    UpdatedAt time.Time
}

func ValidateSnapshot(
    snapshot WorkSnapshot,
    knownColors map[string]struct{},
    maxBytes int,
) error

func CanonicalWorkContentBytes(name string, snapshot WorkSnapshot) ([]byte, error)
func HashWorkContent(name string, snapshot WorkSnapshot) (string, error)
~~~

ValidateSnapshot 校验 schemaVersion、宽高、坐标边界、坐标重复、颜色存在性和序列化大小。停用色号只要仍存在于 colors 表即可用于历史作品保存；完全未知的色号返回 WORK_COLOR_UNKNOWN。

规范化摘要算法固定为：名称去除首尾空白，cells 按 y、x 排序，然后按字段顺序序列化 `{name,snapshot:{schemaVersion,width,height,cells}}`，对无空格 JSON 的 UTF-8 字节计算 SHA-256，结果加 sha256: 前缀。TypeScript 与 Go 使用相同字段顺序和 JSON 字符串规则。

### 2.4 后端输入与输出类型

新增 server/internal/http/handler/dto.go：

~~~go
type CreateWorkRequest struct {
    Name string
    Snapshot domain.WorkSnapshot
    ClientUpdatedAt string
}

type UpdateWorkRequest struct {
    Name string
    Snapshot domain.WorkSnapshot
    BaseRevision int64
    ClientUpdatedAt string
}

type RenameWorkRequest struct {
    Name string
    BaseRevision int64
}

type WorkDTO struct {
    ID string
    Name string
    Snapshot domain.WorkSnapshot
    ContentHash string
    Revision int64
    CreatedAt string
    UpdatedAt string
}
~~~

JSON 字段名使用 solution 文档中定义的 name、snapshot、baseRevision、clientUpdatedAt 等名称。客户端时间只用于日志和界面，版本、摘要和排序以服务端值为准。

### 2.5 后端配置

新增 server/internal/config/config.go：

~~~go
type Config struct {
    HTTPAddr string
    DBPath string
    SessionTTL time.Duration
    CookieSecure bool
    MaxWorksPerUser int
    MaxWorkBytes int
    PublicOrigin string
    LogLevel slog.Level
}

func Load() (Config, error)
~~~

读取 HTTP_ADDR、DB_PATH、SESSION_TTL、COOKIE_SECURE、MAX_WORKS_PER_USER、MAX_WORK_BYTES、PUBLIC_ORIGIN、LOG_LEVEL。生产默认值：127.0.0.1:8080、./data/pindou.db、720h、true、200、2097152、必须提供的公开 HTTPS 地址和 info 日志。PUBLIC_ORIGIN 缺失或数据库路径不可写时启动失败。

## 3. 接入层和服务挂载

### 3.1 服务启动

新增 server/cmd/server/main.go，调用顺序：

~~~text
main
→ config.Load
→ sqlite.Open(DBPath)
→ sqlite.ApplyMigrations
→ repositories.New(db)
→ app.NewAuthService、NewColorService、NewWorkService
→ http.NewRouter(dependencies)
→ http.Server.ListenAndServe
~~~

服务监听 127.0.0.1:8080。收到 SIGINT/SIGTERM 后停止接收新请求，等待事务结束并关闭数据库。

### 3.2 中间件

新增 server/internal/http/router.go：

~~~go
func NewRouter(deps Dependencies) http.Handler
~~~

中间件顺序：

~~~text
requestIDMiddleware
→ recoverMiddleware
→ accessLogMiddleware
→ clientIPMiddleware
→ bodyLimitMiddleware
→ originMiddleware（写操作）
→ authMiddleware（受保护路由）
→ Handler
~~~

authMiddleware 读取 pindou_session Cookie，计算 SHA-256 后查询有效会话，检查 expires_at，并将 userID 写入请求上下文。originMiddleware 对 POST、PUT、PATCH、DELETE 强制要求 Origin 等于 PUBLIC_ORIGIN；Origin 缺失或不一致时返回 ORIGIN_FORBIDDEN。

Go 服务只接受来自本机 Caddy 的连接。clientIPMiddleware 在 RemoteAddr 为回环地址时读取 Caddy 写入的 X-Forwarded-For 第一个合法 IP；其他来源只使用 RemoteAddr。登录/注册限流使用该客户端 IP，避免所有公网用户被识别为 127.0.0.1。

### 3.3 路由

~~~text
GET    /api/v1/healthz
GET    /api/v1/colors
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/logout
GET    /api/v1/me
GET    /api/v1/works
POST   /api/v1/works
GET    /api/v1/works/{workId}
PUT    /api/v1/works/{workId}
PATCH  /api/v1/works/{workId}
DELETE /api/v1/works/{workId}
~~~

新增 handler 方法：

~~~go
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request)
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request)
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request)
func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request)

func (h *ColorHandler) List(w http.ResponseWriter, r *http.Request)

func (h *WorkHandler) List(w http.ResponseWriter, r *http.Request)
func (h *WorkHandler) Create(w http.ResponseWriter, r *http.Request)
func (h *WorkHandler) Get(w http.ResponseWriter, r *http.Request)
func (h *WorkHandler) Update(w http.ResponseWriter, r *http.Request)
func (h *WorkHandler) Rename(w http.ResponseWriter, r *http.Request)
func (h *WorkHandler) Delete(w http.ResponseWriter, r *http.Request)
~~~

Handler 只负责请求解析、上下文读取、应用服务调用和响应写出；业务判断和事务不放在 Handler 中。

## 4. 业务实现

### 4.1 色库导入和查询

新增 server/cmd/colorimport/main.go：

~~~text
读取 -file 指定的 mard291.json
→ 校验 code 唯一、hex 为 #RRGGBB、sortOrder 合法
→ 开启事务
→ 对每个 code 执行 upsert
→ 未出现在本次文件中的旧颜色标记 active=0
→ 提交事务
~~~

colorimport 启动时复用 sqlite.Open 和 ApplyMigrations，确保首次部署时数据库结构已经创建。色库版本对按 sort_order、code 排序后的 code、name、hex、active 计算 SHA-256，ColorService.List 随 items 一起返回该版本。

新增 server/internal/app/color_service.go：

~~~go
func (s *ColorService) List(
    ctx context.Context,
) ([]domain.Color, string, error)
~~~

调用链：

~~~text
ColorHandler.List
→ ColorService.List
→ ColorRepository.ListAll
→ SELECT code,name,hex,sort_order,active FROM colors
→ 转换为 ColorDTO
→ WriteJSON
~~~

默认按 sort_order、code 升序返回全部颜色和 active 状态。前端搜索和新作品色板只使用 active=true 的颜色，解析历史作品时使用全部 code；成功响应写入 IndexedDB 的 colors 仓库，请求失败时读取最近一次缓存。

### 4.2 Canvas 命中和渲染

新增 web/src/infrastructure/canvas/canvas-renderer.ts：

~~~typescript
class CanvasRenderer {
  render(canvas: HTMLCanvasElement, state: RenderState): void;
  cellAtPoint(
    point: { clientX: number; clientY: number },
    state: ViewState,
  ): { x: number; y: number } | null;
}
~~~

命中流程：把屏幕坐标减去 Canvas 边界和视图平移量，除以 cellPixelSize 与 scale，向下取整，再检查宽高边界。渲染顺序固定为浅色背景、已填色格、格线、选中描边。

新增 web/src/infrastructure/canvas/pointer-controller.ts：

~~~typescript
class PointerController {
  attach(element: HTMLElement, callbacks: PointerCallbacks): () => void;
}
~~~

使用 pointerdown、pointermove、pointerup、pointercancel。单指触摸进入编辑工具；两个活动指针进入缩放/平移，暂停画笔命中。元素设置 touch-action: none；清理函数移除全部监听器。

### 4.3 画笔、橡皮擦、取色器和油漆桶

新增 web/src/application/editor/editor-controller.ts：

~~~typescript
class EditorController {
  dispatch(command: EditorCommand): void;
  paintCell(x: number, y: number, colorCode: string): void;
  eraseCell(x: number, y: number): void;
  pickColor(x: number, y: number): string | null;
  fillCell(x: number, y: number, colorCode: string): void;
  undo(): void;
  redo(): void;
}
~~~

调用规则：

1. paintCell 和 eraseCell 先读取目标格旧色，前后相同则返回。
2. 连续拖动期间将不同坐标的 CellChange 合并为一条命令。
3. fillCell 调用 floodFill，只生成一条 fill 命令。
4. dispatch 更新 reducer 和 dirty 状态，通过 compactCommand 写入 history，并请求 CanvasRenderer 重绘。
5. 命令完成后调用 LocalSaveCoordinator.schedule(state.metadata, state.grid)。

新增 web/src/domain/editor/flood-fill.ts：

~~~typescript
export function floodFill(
  grid: CellGrid,
  start: { x: number; y: number },
  replacement: string | null,
): CellChange[];
~~~

算法使用数组队列和 Set<number> 访问标记，索引为 y * width + x；只检查上下左右四个方向；目标色和替换色相同返回空数组。每个格子的当前颜色从 CellGrid.values O(1) 读取。

### 4.4 撤回和反撤回

新增 web/src/domain/editor/history.ts：

~~~typescript
type HistoryState = {
  undoStack: HistoryCommand[];
  redoStack: HistoryCommand[];
};

function pushHistory(
  state: HistoryState,
  command: HistoryCommand,
): HistoryState;

function undoHistory(
  state: HistoryState,
  grid: CellGrid,
): HistoryResult;

function redoHistory(
  state: HistoryState,
  grid: CellGrid,
): HistoryResult;
~~~

compactCommand 将坐标转成 `y * width + x`，并用命令内 palette 去重颜色字符串；空格固定使用 palette 索引 0。undoHistory 按倒序应用 beforeIndexes；redoHistory 按正序应用 afterIndexes。TypedArray 可以控制大面积填充命令的内存占用。没有对应栈内容时保持状态不变，按钮由 UI 根据栈长度置灰。

### 4.5 IndexedDB 临时保存

新增 web/src/infrastructure/local/indexeddb.ts：

~~~typescript
const DB_NAME = "pindou-local";
const DB_VERSION = 1;

export function openLocalDB(): Promise<IDBDatabase>;
~~~

对象仓库：

~~~text
drafts: keyPath workKey
recentWorks: keyPath workKey，索引 updatedAt
cloudRefs: keyPath localWorkKey
colors: keyPath code，settings 中记录 colorVersion
settings: keyPath key
~~~

新增 web/src/infrastructure/local/work-repository.ts：

~~~typescript
class LocalWorkRepository {
  putDraft(document: WorkDocument): Promise<void>;
  getDraft(workKey: string): Promise<WorkDocument | null>;
  deleteDraft(workKey: string): Promise<void>;
  listRecent(limit: number): Promise<RecentWork[]>;
  putRecent(work: RecentWork): Promise<void>;
  putCloudRef(ref: CloudRef): Promise<void>;
  getCloudRef(localWorkKey: string): Promise<CloudRef | null>;
  replaceColors(version: string, colors: Color[]): Promise<void>;
  listColors(): Promise<{ version: string; items: Color[] } | null>;
}
~~~

新增 web/src/application/save/local-save-coordinator.ts：

~~~typescript
class LocalSaveCoordinator {
  schedule(metadata: WorkMetadata, grid: CellGrid): void;
  flush(metadata: WorkMetadata, grid: CellGrid): Promise<void>;
  restore(workKey: string): Promise<WorkDocument | null>;
}
~~~

schedule 使用 1 秒防抖；计时器触发时调用 documentFromGrid 生成最新稀疏快照。每 10 秒由兜底计时器调用 flush。写入失败只更新 UI 状态，不阻塞编辑。页面启动先读取 recentWorks，用户选择恢复后读取 drafts，并通过 gridFromSnapshot 建立运行时网格。

#### PWA 缓存

新增 `web/src/pwa/register.ts` 并在 `vite.config.ts` 配置 `vite-plugin-pwa`：

- 预缓存 `index.html`、带内容哈希的 JS/CSS、图标和离线壳；
- 导航请求离线时回退到离线壳；
- `/api/*` 明确使用 `NetworkOnly`，账号、会话、色库和云作品响应不进入 Cache Storage；
- 色库离线读取走 IndexedDB 的 `colors` 仓库；
- 检测到新 Service Worker 后提示用户刷新，刷新前调用本地 `flush` 保存当前作品。

### 4.6 .pindou 文件

新增 web/src/infrastructure/files/pindou-file.ts：

~~~typescript
class PindouFileService {
  stringify(document: WorkDocument): string;
  parse(text: string, knownColorCodes: ReadonlySet<string>): WorkDocument;
  download(document: WorkDocument): void;
}
~~~

stringify 输出 UTF-8 JSON，包含 fileType、schemaVersion、name、snapshot、updatedAt。文件名清理路径分隔符和控制字符，扩展名固定为 .pindou。parse 先解析临时对象，再执行文件类型、版本、尺寸、坐标和色号校验；失败时不替换当前编辑器状态。

### 4.7 PNG 导出

新增 web/src/infrastructure/export/png-exporter.ts：

~~~typescript
type ExportMode = "grid" | "clean";

type ExportOptions = {
  cellPixelSize: number;
  gridColor: string;
};

class PngExporter {
  export(
    snapshot: WorkSnapshot,
    mode: ExportMode,
    options: ExportOptions,
  ): Promise<Blob>;
  download(blob: Blob, filename: string): void;
}
~~~

grid 模式绘制空格背景、色块和格线；clean 模式保持透明画布，只绘制非空格。导出前检查 Canvas 像素尺寸，超过浏览器限制返回客户端错误 EXPORT_TOO_LARGE。

### 4.8 认证和会话

新增 server/internal/app/auth_service.go：

~~~go
type AuthService struct {
    Users repository.UserRepository
    Sessions repository.SessionRepository
    Accounts repository.AccountRepository
    Hasher security.PasswordHasher
    Clock func() time.Time
    Config config.Config
}

func (s *AuthService) Register(
    ctx context.Context,
    username string,
    password string,
) (domain.User, domain.Session, error)

func (s *AuthService) Login(
    ctx context.Context,
    username string,
    password string,
) (domain.User, domain.Session, error)

func (s *AuthService) Logout(ctx context.Context, token string) error
func (s *AuthService) ResolveSession(
    ctx context.Context,
    token string,
) (domain.User, error)
~~~

调用步骤：

1. Handler 解码用户名和密码，Service 做格式校验和用户名小写规范化。
2. PasswordHasher.Hash 使用 Argon2id、随机 16 字节盐、19 MiB 内存、2 次迭代、1 路并行和 32 字节输出；数据库以 PHC 字符串保存算法参数、盐和摘要。
3. 注册调用 Accounts.CreateUserAndSession，在一个事务中创建用户和会话；用户名唯一索引处理并发注册。
4. 登录查询用户并验证摘要；错误统一为 AUTH_INVALID_CREDENTIALS。
5. Handler 设置会话 Cookie，Cookie 到期时间来自 Session.ExpiresAt。
6. 退出删除令牌哈希并写入过期 Cookie。

登录和注册按 IP 在进程内限制 5 分钟 10 次失败尝试；服务重启会清空限流计数。密码摘要同时使用容量为 4 的全局信号量限制并行计算，容量已满时返回 RATE_LIMITED，避免低配服务器因并发 Argon2 请求耗尽内存。

### 4.9 云端作品服务

新增 server/internal/app/work_service.go：

~~~go
type WorkService struct {
    Works repository.WorkRepository
    Colors repository.ColorRepository
    Config config.Config
    Clock func() time.Time
}

func (s *WorkService) List(
    ctx context.Context,
    userID string,
    limit int,
    cursor string,
) (WorkPage, error)

func (s *WorkService) Create(
    ctx context.Context,
    userID string,
    idempotencyKey string,
    input CreateWorkInput,
) (domain.Work, bool, error)

func (s *WorkService) Get(
    ctx context.Context,
    userID string,
    workID string,
) (domain.Work, error)

func (s *WorkService) Update(
    ctx context.Context,
    userID string,
    workID string,
    input UpdateWorkInput,
) (domain.Work, error)

func (s *WorkService) Rename(
    ctx context.Context,
    userID string,
    workID string,
    input RenameWorkInput,
) (domain.Work, error)

func (s *WorkService) Delete(
    ctx context.Context,
    userID string,
    workID string,
    baseRevision int64,
) error
~~~

创建调用链：

~~~text
WorkHandler.Create
→ DecodeJSON(CreateWorkRequest)
→ 从 authMiddleware 上下文取得 userID
→ 读取并校验 Idempotency-Key UUID
→ WorkService.Create
→ 校验名称、快照、色号和大小
→ 计算规范化名称、快照 JSON 和 SHA-256
→ Works.InsertIfUnderLimit 先匹配幂等键，再在事务内检查 200 件上限并插入（revision=1）
→ ToWorkDTO
→ 首次创建返回 201，幂等重试返回 200
~~~

更新调用链：

~~~text
WorkHandler.Update
→ DecodeJSON(UpdateWorkRequest)
→ 读取 userID 和 workID
→ WorkService.Update
→ 校验名称、快照、色号和大小并计算内容摘要
→ Works.UpdateIfRevisionMatches 进入事务
→ 读取当前 revision 和 content_hash
→ revision 等于 baseRevision：更新快照并 revision 加一
→ 摘要相同：返回当前作品，作为重复重试成功
→ 其他情况：返回 WORK_VERSION_CONFLICT
→ ToWorkDTO
→ 返回 200
~~~

创建和更新的摘要均由服务端计算，客户端只消费响应中的 `contentHash`。

List 按 updated_at DESC、id DESC 分页；Get、Rename、Delete 每次 SQL 都带 user_id 条件，找不到时统一返回 WORK_NOT_FOUND。Rename 只更新名称和 revision；Delete 要求 baseRevision，通过 DeleteIfRevisionMatches 删除；版本不同返回 WORK_VERSION_CONFLICT。删除只影响云端记录，IndexedDB 草稿保持不变。

## 5. 数据和异步处理

### 5.1 SQLite 连接与迁移

新增 `server/internal/repository/sqlite/db.go`：

~~~go
func Open(path string) (*sql.DB, error)
~~~

`Open` 使用 `modernc.org/sqlite`，DSN 为 `file:<path>?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)`；调用 `SetMaxOpenConns(1)` 和 `SetMaxIdleConns(1)`，随后执行 `Ping` 验证路径和权限。单连接符合首版单机低并发场景，也保证每次读写都带相同的外键和锁等待配置。

新增 server/internal/repository/sqlite/migration.go：

~~~go
func ApplyMigrations(
    ctx context.Context,
    db *sql.DB,
    dir fs.FS,
) error
~~~

迁移表为 _schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)。启动时按文件名顺序执行 migrations/*.sql，每个迁移独立事务；迁移失败时服务不启动。数据库时间统一保存 Unix 毫秒，HTTP DTO 转换为 UTC RFC3339。

新增 migrations/001_init.sql，包含 users、sessions、colors、works 和索引：

~~~sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE colors (
  code TEXT PRIMARY KEY,
  name TEXT,
  hex TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE works (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  create_key TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX sessions_expires_at_idx ON sessions(expires_at);
CREATE UNIQUE INDEX works_user_create_key_idx
  ON works(user_id, create_key);
CREATE INDEX works_user_updated_idx
  ON works(user_id, updated_at DESC, id DESC);
~~~

### 5.2 仓储接口

新增 server/internal/repository/*.go：

~~~go
type UserRepository interface {
    FindByUsername(ctx context.Context, username string) (domain.User, error)
    FindByID(ctx context.Context, userID string) (domain.User, error)
}

type AccountRepository interface {
    CreateUserAndSession(
        ctx context.Context,
        user domain.User,
        session domain.Session,
    ) error
}

type ColorRepository interface {
    ListAll(ctx context.Context) ([]domain.Color, error)
    ExistingCodes(ctx context.Context) (map[string]struct{}, error)
}

type SessionRepository interface {
    Insert(ctx context.Context, session domain.Session) error
    FindValid(ctx context.Context, tokenHash string, now time.Time) (domain.Session, error)
    Delete(ctx context.Context, tokenHash string) error
}

type WorkRepository interface {
    ListByUser(ctx context.Context, userID string, limit int, cursor Cursor) (Page[domain.Work], error)
    FindByID(ctx context.Context, userID string, workID string) (domain.Work, error)
    InsertIfUnderLimit(ctx context.Context, work domain.Work, maxWorks int) (domain.Work, bool, error)
    UpdateIfRevisionMatches(ctx context.Context, input RevisionUpdate) (UpdateResult, error)
    RenameIfRevisionMatches(ctx context.Context, input RenameUpdate) (domain.Work, error)
    DeleteIfRevisionMatches(ctx context.Context, userID string, workID string, baseRevision int64) error
}
~~~

InsertIfUnderLimit 和 UpdateIfRevisionMatches 使用 db.BeginTx。创建事务先按 user_id、create_key 查询；已存在时返回原作品和 `created=false`，其余情况在同一事务完成数量统计和插入并返回 `created=true`。更新事务完成当前版本读取、摘要判定、写入和 revision 递增。DeleteIfRevisionMatches 在事务内区分版本冲突和作品不存在。

### 5.3 云保存异步状态

服务端没有消息队列和业务异步任务。新增 web/src/application/save/cloud-save-service.ts：

~~~typescript
class CloudSaveService {
  create(document: WorkDocument, idempotencyKey: string): Promise<CloudWork>;
  update(
    workId: string,
    document: WorkDocument,
    baseRevision: number,
  ): Promise<CloudWork>;
  load(workId: string): Promise<CloudWork>;
  remove(workId: string, baseRevision: number): Promise<void>;
}
~~~

调用顺序：

~~~text
本地 flush
→ navigator.onLine 检查
→ POST 或 PUT /api/v1/works
→ 成功：清除待上传标记并写入 revision
→ 网络失败：保留待上传快照，状态 failed
→ 401：保留快照并打开登录框
→ 409：GET 远端作品并进入冲突选择
~~~

首次云保存前使用 crypto.randomUUID 生成创建幂等键并先写入 IndexedDB 的 cloudRefs，然后用 `Idempotency-Key` 请求头调用 POST；网络重试复用同一个键。已有 workId 使用 PUT。编辑器退出、切后台和 PWA 恢复只触发本地保存，避免移动网络下自动重复上传。

### 5.4 数据库备份

新增 server/cmd/backup/main.go：读取 DB_PATH，使用 SQLite VACUUM INTO 生成 UTC 时间戳备份文件，写入专用备份目录并校验文件大小。新增 deploy/pindou-backup.service 和 deploy/pindou-backup.timer 每日执行，保留最近 7 份；删除动作只作用于明确的备份目录文件。

## 6. 转换和返回

### 6.1 后端 DTO

新增 server/internal/http/handler/dto.go：

~~~go
func ToWorkDTO(work domain.Work) WorkDTO
func ToWorkSummaryDTO(work domain.Work) WorkSummaryDTO
func ToColorDTO(color domain.Color) ColorDTO
~~~

时间统一使用 UTC RFC3339；列表接口只返回摘要，读取和保存接口返回完整快照；空作品返回 cells: []。

### 6.2 前端 API 客户端

新增 web/src/infrastructure/http/api-client.ts：

~~~typescript
export class ApiError extends Error {
  code: string;
  status: number;
  details: unknown;
  requestId: string;
}

export class ApiClient {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}
~~~

request 默认使用 credentials: include，解析通用 Envelope；HTTP 非 2xx 或 code 不是 OK 时抛出 ApiError。auth-api.ts、color-api.ts、work-api.ts 只封装路径、请求类型和响应类型，不处理界面文案。

### 6.3 前端错误消费

| 错误码 | 页面行为 |
| --- | --- |
| AUTH_REQUIRED、AUTH_SESSION_EXPIRED | 打开登录框，保留本地作品 |
| WORK_VERSION_CONFLICT | 拉取远端版本，显示保留本地/云端选择 |
| DB_UNAVAILABLE、网络超时 | 显示已保留本地版本，提供重试 |
| WORK_SNAPSHOT_INVALID、WORK_COLOR_UNKNOWN | 阻止上传，提示修复作品或更新色库 |
| PAYLOAD_TOO_LARGE、WORK_LIMIT_REACHED | 提示作品限制和下一步操作 |
| INTERNAL_ERROR | 显示 requestId，允许稍后重试 |

本地文件错误 LOCAL_FILE_INVALID、导出错误 EXPORT_TOO_LARGE 只由前端产生，不调用 API。

## 7. 测试计划

当前仓库没有既有测试框架，按新增工程建立以下测试。

### 7.1 前端 Vitest

- validation.test.ts：1/200 尺寸、越界坐标、重复坐标、未知色号、空作品。
- flood-fill.test.ts：四方向连通、边界、大区域、同色替换。
- history.test.ts：100 步上限、撤回/反撤回、新命令清空 redo。
- reducer.test.ts：画笔、擦除、填充、dirty 和云状态。
- pindou-file.test.ts：序列化往返、损坏 JSON、非法版本和恶意坐标。
- png-exporter.test.ts：grid/clean、透明空格和像素尺寸。
- local-save-coordinator.test.ts：防抖、兜底 flush 和 IndexedDB 错误状态。

### 7.2 Go 单测和仓储测试

- domain/work_test.go：快照规则、规范化名称/JSON 和 SHA-256。
- security/password_test.go：Argon2id 摘要验证和错误密码。
- repository/sqlite/*_test.go：迁移、唯一用户名、外键、分页和事务。
- app/work_service_test.go：作品上限、未知色号、版本冲突和重复摘要。
- http/handler/*_test.go：请求字段、Cookie、状态码和错误 Envelope。

仓储测试每次使用临时 SQLite 文件；测试结束只删除本次创建的临时目录。

### 7.3 HTTP 集成测试

使用 httptest.NewServer(NewRouter(...)) 验证：

1. 注册后收到会话 Cookie。
2. 创建空作品和带格子作品。
3. 列表、详情、重命名、更新、删除。
4. 错误 baseRevision 返回 WORK_VERSION_CONFLICT。
5. 另一个用户访问作品返回 WORK_NOT_FOUND。
6. 超过请求体限制返回 PAYLOAD_TOO_LARGE。
7. Origin 不匹配的写操作返回 ORIGIN_FORBIDDEN，且不写数据库。

### 7.4 移动端浏览器验收

Playwright 使用手机和 iPad 类 viewport，覆盖首屏无横向滚动、单指填色、色板搜索、油漆桶、撤回/反撤回、刷新恢复、登录、云保存和两种导出。双指缩放、iOS 文件保存和添加到主屏幕需要真实 iOS/iPadOS 设备验收。

## 8. 联调和发布清单

### 8.1 本地开发

~~~text
cd web
npm install
npm run dev

cd server
go run ./cmd/server

npm run test
npm run test:e2e
go test ./...
~~~

Vite 开发代理把 /api 转发到 Go 服务；生产环境只使用 HTTPS。

### 8.2 生产构建和目录

~~~text
web:    npm ci → npm run build → web/dist
server: go test ./... → go build -trimpath -o bin/pindou-server ./cmd/server
data:   colorimport -file data/mard291.json（工具先执行迁移，再导入色库）
~~~

部署目录：

~~~text
/opt/pindou/web       前端 dist
/opt/pindou/bin       Go 二进制
/opt/pindou/data      SQLite 和运行数据
/opt/pindou/backups   数据库备份
~~~

运行用户只对 data 和 backups 有写权限。

### 8.3 systemd 和 Caddy

新增 deploy/pindou.service，配置 WorkingDirectory、EnvironmentFile、ExecStart、Restart=on-failure 和最小文件权限。Go 服务监听 127.0.0.1:8080。

新增 deploy/Caddyfile：

~~~text
你的域名 {
    encode gzip

    handle /api/* {
        reverse_proxy 127.0.0.1:8080
    }

    handle {
        root * /opt/pindou/web
        try_files {path} /index.html
        file_server
    }
}
~~~

DNS 指向服务器后启动 Caddy，由 Caddy 自动申请 Let's Encrypt 证书。Go 服务不直接暴露公网端口。

### 8.4 发布、验证和回滚

1. 备份当前数据库、前端静态目录和后端二进制。
2. 上传新构建产物，执行迁移；迁移失败停止发布。
3. 重启 pindou.service，检查 /api/v1/healthz。
4. 使用手机流量、Wi-Fi、Android Chrome、iOS Safari 和 iPadOS Safari 完成新建、绘制、导出。
5. 使用测试账号验证云端创建、跨设备读取、冲突和删除。
6. 发现健康检查或关键验收失败时恢复上一份静态目录和二进制；数据库迁移只使用已验证向后兼容的变更。

### 8.5 日志和告警

- Caddy 记录访问状态和 TLS 错误；Go 记录 requestId、路由、状态码、耗时和业务错误码。
- 告警关注健康检查失败、5xx 增长、磁盘空间低于 20%、备份失败和 SQLite 锁超时。
- 日志禁止记录密码、会话令牌、完整作品快照和色块内容。
