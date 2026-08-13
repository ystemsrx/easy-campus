# Easy SWU 微信小程序

`frontend/` 是 Easy SWU 的微信小程序客户端，使用 TypeScript、Skyline 和 Glass-easel 构建。界面采用轻量材质、清晰层级和连续过渡，并为深色模式、减少动态效果与触感反馈提供完整适配。

## 已实现功能

- 西南大学统一身份认证登录；已有账号优先本地快速验证，进入后再由服务端后台确认校园凭据。
- 90 天滑动会话，本地只保存后端签发的 Bearer Token 和精简用户资料。
- 首页先恢复按账号隔离的三条教务消息和通知预览，静默刷新后直接插入新内容。
- 主页铃铛聚合管理员公告和站内通知，支持未读角标、长通知展开、公告 Markdown 弹窗与鉴权图片。
- 教务消息合并展示调课、补课、停课及其他模板，并支持类型和日期筛选。
- 教务通知实时搜索、分页和原始链接交接。
- 成绩查询、学年与学期筛选、搜索、排序、分页、主动刷新及全部成绩分项。
- 数字、等级制、`缓考`、`违纪` 等任意文字成绩均按接口原值展示。
- 空教室按日期、节次、校区和最多 30 栋楼查询，所有编码均从后端实时读取。
- 考试按学年、学期、日期、考试名称、学院和关键词查询，并展示完整考试详情。
- 校历元数据、鉴权图片下载、本地版本缓存、历史学年切换、预览和保存。
- 本周课表占位页与首页“今日课程”卡片，暂时完全使用本地演示数据，不请求后端。
- 浅色、深色、跟随系统、减少动态效果和触感反馈设置。

## 目录结构

```text
frontend/
├─ miniprogram/
│  ├─ components/       通用导航栏、底部面板、加载态和空状态
│  ├─ config/           不同发布环境的 API 地址
│  ├─ custom-tab-bar/   Skyline 自定义标签栏
│  ├─ pages/            业务页面
│  ├─ services/         请求、认证和教务接口封装
│  ├─ store/            会话与界面偏好
│  ├─ types/            与后端 API 对齐的类型
│  └─ utils/            日期、格式化、路由和触感工具
├─ scripts/             JSON、WXML、WXSS、类型与 LF 检查
├─ project.config.json  微信开发者工具项目配置
└─ package.json
```

## 本地运行

需要 Node.js 18 或更高版本，以及支持 Skyline 的微信开发者工具。

```powershell
cd frontend
npm install
npm run check
```

随后在微信开发者工具中导入 `frontend/`。项目已配置：

- 小程序源码目录为 `miniprogram/`；
- TypeScript 编译插件；
- Skyline 渲染器；
- Glass-easel 组件框架；
- 基础库 `3.17.0`；
- 自定义导航栏和自定义标签栏。

本地后端默认地址是 `http://127.0.0.1:3000`。开发者工具中调试远程或局域网后端时，可在控制台临时设置：

```js
wx.setStorageSync(
  "easy-swu:development-api-origin",
  "http://192.168.1.10:3000",
);
```

清除临时地址：

```js
wx.removeStorageSync("easy-swu:development-api-origin");
```

真机上的 `127.0.0.1` 指向手机自身，因此真机联调应使用电脑局域网地址或 HTTPS 测试域名。

## 发布配置

发布前必须修改 [`miniprogram/config/index.ts`](miniprogram/config/index.ts) 中 `trial` 和 `release` 的 `https://api.example.com`。生产后端必须使用 HTTPS，并在微信公众平台配置相同的 `request` 与 `downloadFile` 合法域名。

前端不会读取仓库根目录或后端的 `.env`，也不应打包任何账号、密码、Token、MinIO 密钥或数据库配置。

## 数据更新语义

客户端遵循后端 API 的缓存约定：

- 成绩默认使用该用户当天的服务端快照；下拉刷新会传入 `refresh=true` 强制更新。
- 教务消息和通知只在服务端与本地各持久化最新三条预览；页面先展示旧预览，再等待同一次后台刷新返回完整实时结果。
- 退出登录只撤销会话，服务器资料、成绩和三条消息/通知预览不会删除；下次输入相同密码可快速进入。
- 空教室和考试每次进入、查询或刷新都访问实时接口。
- 校历平时使用后端每日任务同步到 MinIO 的版本；主动刷新会检查最新校历并重新下载图片。
- 页面更新采用静默重验证：旧内容始终可见，不显示刷新圆圈；消息和通知按唯一标识将新内容插入顶部。
- 平台公告和通知同样静默更新；公告在铃铛中只预览标题，通知直接预览正文，图片经 Bearer Token 从 MinIO 代理接口下载。
- 用户跨后端定义的自然日边界后首次上线，其数据更新由后端认证流程触发。
- Token 没有客户端固定倒计时；每次成功认证由后端续期为完整 90 天。
- 所有带时刻的数据在前端统一转换为设备的用户时区；不含时区的学年、校历日期和校园节次保留其教学语义。
- 本地课表占位时间直接按设备所在时区解释，且会明确标注为非真实课程安排。

## 通知链接说明

Skyline 页面不内嵌 `web-view`。通知详情可能同时依赖学校 VPN 和教务系统 Cookie，而这些会话不能安全地从后端直接交给系统浏览器。客户端因此展示来源、标题和原始链接，允许用户复制后在具备学校网络条件的浏览器中打开。

## 质量检查

```powershell
npm run typecheck     # TypeScript 严格类型检查
npm run check:json    # 所有 JSON 文件语法检查
npm run check:wxml    # Skyline 页面、滚动容器、标签和事件检查
npm run check:timezone # 多个用户时区下的时间转换检查
npm run check:timetable # 今日课程预览顺序和时间边界检查
npm run check:lf      # 强制文本文件使用 LF
npm run check:wxss    # Skyline 官方 WXSS 兼容性检查
npm run format:check  # TypeScript、JSON 与 Markdown 格式检查
```

`npm run check` 会串行执行除格式检查外的全部构建前检查。

## 交互约定

- 所有主要触控目标都有按下态和轻量触感反馈。
- 页面、列表、筛选面板和标签切换使用一致的缓动与时长。
- 开启“减少动态效果”后，位移和循环动画会缩短为近乎即时的淡入反馈。
- 所有业务页使用页面内 `scroll-view`，符合 Skyline 的滚动和自定义导航栏约束。
- 个人教务页面已在 `sitemap.json` 中全部禁止索引。
