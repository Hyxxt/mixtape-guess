# 猜歌电台 · 陈奕迅专场

听十秒陈奕迅原唱，从四个歌名里选出答案。每局 10 题，挑战 100 分。

- 在线试玩：<https://caige-radio.onrender.com>
- 曲库：250+ 首，每题只播放 Deezer 30 秒试听中的 10 秒
- 技术栈：原生 JavaScript、Web Audio API、Node.js 22、SQLite / Turso、Render

![猜歌电台首页](docs/screenshot.jpg)

## 玩法

积分模式每局 10 题，每题限时 10 秒。前 1 秒答对得 10 分，第 2 至 10 秒答对依次得 9 至 1 分。答错、放弃和超时得 0 分。完成后登记个人最高分，同分时答对更多者优先。采用同一规则的原排名赛成绩计入积分榜，采用前 5 秒满分规则的成绩可在历史榜查看。

热歌模式从曲库标记的陈奕迅代表作中抽取 10 首。前 2 秒答对得 10 分，第 3 秒得 9 分，之后每过一秒少 1 分，答对最低得 1 分。答错或跳过得 0 分。暂停和重听期间仍按首次播放时间计分。两个模式共用参赛昵称，热歌个人最高分在排行榜第二个页签展示，本机战绩也会继续保存。

## 实现要点

- **答案由服务端保管**：两个模式的题目、选项和计分都由服务端生成，客户端在 `/api/start` 之后拿到选项。
- **服务端计时**：`start` 记录起始时间，`answer` 以服务端收到答案的时间计分，并做幂等与版本号乐观锁。
- **音频预取**：当前题就绪后预取下一题的试听，答题响应同步返回最新计分和下一题信息。
- **首局加载**：首页可在数据库连接期间提供服务。试听地址按有效期缓存，同一曲目的并发查询共用一次上游请求。
- **RTT 起跑补偿**：客户端上报测得的 RTT，服务端按 `RTT / 2 + 300ms`（400–2000ms）安排 `startAt`。慢网用户不会因为响应慢而少听开头；这个值只会推迟起跑，不会增加答题时间。
- **断线续局**：同一 Cookie 再次进入会回到当前局，已得分数从服务端同步。
- **移动端适配**：底部导航、320px 小屏布局、触屏设备不自动跳题，避免抢走阅读答案和点链接的时间。
- **可访问性**：原生 `<dialog>`、可见焦点、移动端小屏隐藏底栏、隐藏的 h1 保留在无障碍树中；主要页面通过 axe-core 扫描。

## 本地运行

需要 Node.js >= 22.5（使用内置 `node:sqlite`）。

```bash
npm ci
npm run build
npm start          # http://localhost:8080
```

开发模式：

```bash
npm run dev        # http://127.0.0.1:18746
```

测试：

```bash
npm test
```

## 部署

仓库包含 `render.yaml`，Render 会执行 `npm ci --omit=dev && node scripts/build.mjs` 后运行 `npm start`。

### 启用 Turso 持久化（推荐）

未配置时服务自动回退到本地 SQLite（免费实例重新部署会重置）。配置后启动会连接 Turso 并自动执行 `drizzle/` 里的迁移：

```bash
# 1. 创建数据库（也可在 Turso 控制台操作）
turso db create caige-radio
turso db show caige-radio --url
turso db tokens create caige-radio

# 2. 在 Render 的 Environment 中添加：
#    TURSO_DATABASE_URL=libsql://...
#    TURSO_AUTH_TOKEN=...
```

`TURSO_AUTH_TOKEN` 只放在 Render 环境变量里，不要提交到仓库。

需要注意：

- 免费实例的文件系统不是持久的。默认 SQLite 文件在实例本地，重新部署或重启会重置排行榜；配置 Turso 后榜单跨部署保留。
- `keepalive` 工作流在北京时间 08:00–24:00 每 5 分钟请求一次 `/api/health`。GitHub 定时任务可能延迟。夜间让实例休眠，避免长期占用工作区每月共享的 750 小时免费额度。
- 免费实例无流量约 15 分钟后休眠，唤醒可能需要约 60 秒。

## 项目结构

```
dist/              页面、样式、客户端脚本、曲库和 OG 封面
server/api.mjs     出题、计时、计分和排行榜 API
server/start.mjs   Node HTTP 服务器与本地 SQLite 启动
scripts/build.mjs  把静态资源和 API 打包成可直接运行的 worker
scripts/catalog.py 曲库刷新脚本（需要 uv / ffmpeg / ONNX Runtime）
scripts/local-db.mjs 本地 SQLite 的 D1 风格适配层
scripts/turso-db.mjs Turso/libSQL 的 D1 风格适配层（自动迁移）
tests/             计时、多玩家排行榜与 Turso 适配器测试
```

## 数据与版权

原唱试听来自 Deezer，页面会标注来源。曲库脚本只保存 track id、显示标题和片段起点，不保存音频文件。

这是一个非官方的粉丝向作品，与陈奕迅及其唱片公司无关；艺人名、歌曲名和录音版权归各自权利人所有。

代码以 MIT License 发布，音频和曲名不包含在该许可范围内。
