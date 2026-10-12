# 产品研究知识库网站 · UI 设计方案

> 面向对象：团队/内部同事  
> 风格定位：专业、简洁、高信息密度  
> 技术基座：React 19 + Vite + Tailwind CSS v4 + Shadcn UI (new-york / neutral)  
> 当前主题：仅 Light 模式

---

## 1. 设计目标

1. **降低认知负荷**：研究员每日浏览大量报告与榜单，界面以“内容优先”为原则，控件不抢视觉焦点。
2. **统一视觉语言**：将 `ranking.css` 等硬编码样式收敛到 Shadcn token，消除蓝色“#165DFF”与主 token 的色差。
3. **增强可读性**：正文长文使用稳健的字号、行高与对比度，支持宽屏、笔记本、平板三档自适应。
4. **保留并优化现有优势**：分栏阅读器、移动端单页切换、飞书风 Markdown 排版继续保留。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| 内容优先 | 留白用于隔离信息块，而非装饰；首屏直接呈现最新解读与榜单。 |
| 稳定可控 | 颜色、字号、圆角、阴影统一走 token，避免页面之间“像两个产品”。 |
| 响应式渐进 | 移动端单列 → 平板双栏 → 桌面三栏/分栏，核心信息不折叠。 |
| 微交互克制 | 仅对 `transform` 与 `opacity` 做 200 ms 过渡，避免动画分散阅读注意力。 |

---

## 3. 色彩系统

### 3.1 主色与中性色

保留现有 Shadcn 主色 `hsl(221 83% 53%)`，并将榜单页硬编码 `#165DFF` 统一替换为该 token。

| Token | 色值 | 用途 |
|-------|------|------|
| `--background` | `hsl(0 0% 100%)` | 页面背景 |
| `--foreground` | `hsl(220 14% 14%)` | 主标题、正文 |
| `--card` | `hsl(0 0% 100%)` | 卡片背景 |
| `--card-foreground` | `hsl(220 14% 14%)` | 卡片文字 |
| `--primary` | `hsl(221 83% 53%)` | 主按钮、链接、选中态、重点标签 |
| `--primary-foreground` | `hsl(220 14% 98%)` | 主色上的文字 |
| `--secondary` | `hsl(220 14% 96%)` | 次级按钮、标签、hover 背景 |
| `--secondary-foreground` | `hsl(220 14% 14%)` | 次级背景上的文字 |
| `--muted` | `hsl(220 14% 96%)` | 区块背景、表头、代码块 |
| `--muted-foreground` | `hsl(218 11% 46%)` | 辅助文字、时间、说明 |
| `--border` | `hsl(220 14% 89%)` | 边框、分割线 |
| `--ring` | `hsl(221 83% 53%)` | 焦点环 |

### 3.2 语义色

| 语义 | 色值 | 用途 |
|------|------|------|
| `--info` | `hsl(221 83% 53%)` | 信息提示、同步状态 |
| `--success` | `hsl(130 54% 42%)` | 发布成功、审核通过 |
| `--warning` | `hsl(26 90% 49%)` | 待确认、待审、需关注 |
| `--destructive` | `hsl(2 84% 62%)` | 删除、驳回、错误 |

### 3.3 对比度检查（WCAG 2.2 AA）

- 主文字 `#23272F` on `#FFFFFF`：对比度 ≈ 12:1，远高于 4.5:1。
- 主按钮 `hsl(221 83% 53%)` on `#FFFFFF`：对比度 ≈ 5.8:1，高于 3:1（UI 组件）。
- 弱提示文字 `hsl(218 11% 46%)` on `#FFFFFF`：对比度 ≈ 4.6:1，满足 AA，可用于小字辅助说明。
- 链接色与正文保持 3:1 以上差异，并加下划线或 hover 状态，避免仅依赖颜色传达可点击性。

---

## 4. 字体系统

### 4.1 字体栈

保留现有 `--font-sans` 以保证飞书环境兼容，正文以系统字体优先，标题可选 `Geist`（如已加载）。

```css
--font-sans:
  'LarkHackSafariFont', 'LarkEmojiFont', 'LarkChineseQuote',
  '-apple-system', 'BlinkMacSystemFont', 'Helvetica Neue', 'Tahoma',
  'PingFang SC', 'Microsoft Yahei', 'Arial', 'Hiragino Sans GB',
  'sans-serif', 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol',
  'Noto Color Emoji';
--font-mono: 'Source Code Pro', 'SF Mono', 'Menlo', 'Consolas', monospace;
```

### 4.2 字号刻度（中文适配）

| 层级 | 字号 | 行高 | 字重 | 用途 |
|------|------|------|------|------|
| H1 | 24 px / `text-2xl` | 1.35 | 600 | 页面大标题（首页/后台仪表盘） |
| H2 | 20 px / `text-xl` | 1.4 | 600 | 板块标题、文章标题 |
| H3 | 18 px / `text-lg` | 1.45 | 600 | 卡片标题、分栏左侧面板标题 |
| Body | 14 px / `text-sm` | 1.65 | 400 | 正文、列表、表格 |
| Body Large | 15 px | 1.7 | 400 | 文章详情长文 |
| Caption | 12 px / `text-xs` | 1.5 | 400 | 时间、元信息、标签 |
| Code | 13 px | 1.6 | 400 | 行内代码、表格数字 |

### 4.3 排版规则

- 中文标题避免 `font-thin`（100），最低使用 `font-normal`（400）。
- 长文段落最大宽度 `max-w-[680px]`，行高 `1.7`，段间距 `1em`。
- 表格数字使用 `font-variant-numeric: tabular-nums`，保证榜单列对齐。

---

## 5. 间距与尺寸系统

基于 8 px 基线，使用 Tailwind 默认 spacing 即可。

| Token | 值 | 用途 |
|-------|-----|------|
| `space-1` | 4 px | 图标与文字间隙、紧凑内联 |
| `space-2` | 8 px | 组件内部小间距 |
| `space-3` | 12 px | 卡片内边距（默认） |
| `space-4` | 16 px | 模块间距、表单字段 |
| `space-5` | 20 px | 卡片组间距 |
| `space-6` | 24 px | 页面区块间距 |
| `space-8` | 32 px | 大模块分隔 |

- 卡片默认内边距：`p-4`（16 px）。
- 卡片圆角：统一使用 `rounded-lg`（`--radius: 0.5rem`）。
- 页面水平安全边距：`px-4 md:px-6 lg:px-8`。

---

## 6. 布局系统

### 6.1 断点

沿用 Tailwind 默认断点：

| 断点 | 宽度 | 设备 |
|------|------|------|
| 默认 | < 640 px | 手机 |
| `sm` | 640 px | 大屏手机 |
| `md` | 768 px | 平板 |
| `lg` | 1024 px | 笔记本 |
| `xl` | 1280 px | 桌面 |
| `2xl` | 1536 px | 宽屏显示器 |

### 6.2 全局布局

```
┌─────────────────────────────────────────────┐
│  Sidebar (64/224 px)  │  Main Content        │
│                       │  flex-1 overflow-auto│
└─────────────────────────────────────────────┘
```

- `Layout` 使用 `flex h-screen`；Sidebar 固定高度，主内容区 `overflow-auto`。
- Sidebar 折叠态宽度 64 px，仅显示图标；建议增加 `title` 属性或 Tooltip，解决无文字识别问题。
- 主内容区顶部可选 `sticky` 面包屑/标题栏，不随滚动消失。

### 6.3 分栏阅读器（Search / Favorites / ExternalArticles / Board）

```
默认：      md 以上：
┌────────┐  ┌────────┬────────────────┐
│ 列表   │  │ 列表   │  详情/预览     │
│ 全宽   │  │ 40%    │  60%           │
└────────┘  └────────┴────────────────┘
```

- 保留现有 `SplitPane` 可拖动分栏。
- 拖拽条须 `role="separator"` + 键盘方向键可调（左/右或上/下移动分隔位置，聚焦态显示焦点环）。
- 列表最小宽度 `280 px`，详情最小宽度 `360 px`。
- 平板以下自动切换为“列表页 → 详情页”的单页路由。

### 6.3.1 卡片流 + 弹窗（Home / Library）

- 栅格：`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5`，三档响应式列数。
- 卡片四要素：图标/缩略、标题、摘要、时间标签，信息层级分明（同 7.2 文章卡片）。
- 交互：点击卡片打开弹窗（Dialog）展示内容，**不跳页**，保持列表滚动位置与浏览上下文。
- 弹窗内「阅读原文」：内容区宽度放大为 `max-w-5xl`，适合长文阅读，其余弹窗保持常规宽度。

### 6.4 文章详情页

- 内容区最大宽度响应式：
  - 默认：`max-w-3xl`（768 px）
  - `xl` 以上：增至 `max-w-[880px]`，减少两侧空白浪费。
- 顶部 meta 栏固定，包含返回、标题、板块、更新时间、收藏。
- 宽屏下可左侧常驻目录大纲（`xl:block`）。

### 6.5 后台仪表盘（Admin / Dashboard / SyncManage / ContentReview / DateEntry）

- 使用 `grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5` 卡片网格。
- 修复 AdminPage 中“更新日期录入”卡片游离于 grid 外的布局问题。
- 表格优先使用 `w-full` + 横向滚动，避免挤压换行。

### 6.6 榜单页（Ranking）

- 将硬编码 `#165DFF` 改为 `bg-primary text-primary-foreground`。
- 表格列宽按内容类型分配：排名/数字列 `w-16`/`w-24`，名称列 `min-w-[180px]`，描述列自动伸展。
- 表头 `sticky top-0 z-10` 滚动固定。

---

## 7. 组件规范

### 7.1 按钮

| 类型 | 样式 | 用途 |
|------|------|------|
| Primary | `bg-primary text-primary-foreground hover:bg-primary/90` | 主操作：同步、发布、通过 |
| Secondary | `bg-secondary text-secondary-foreground hover:bg-secondary/80` | 次操作：取消、返回 |
| Outline | `border border-input bg-background hover:bg-accent` | 低优先级：筛选、导出 |
| Ghost | `hover:bg-accent` | 图标按钮、导航项 |
| Destructive | `bg-destructive text-destructive-foreground` | 删除、驳回 |

- 按钮圆角统一 `rounded-md`。
- 按钮高度：`h-9`（36 px）默认，`h-8`（32 px）紧凑表格操作，`h-10`（40 px）强调操作。
- 加载态：仅显示 Spinner，不显示文字，保持宽度稳定。

### 7.2 卡片

- 默认：`bg-card border rounded-lg p-4`；**卡片默认无阴影，阴影仅用于浮层（Dialog/Select/Popover）**。
-  hover 态：卡片整体不放大、不提升阴影，仅边框/背景色微变（如 `hover:border-primary/40`）。
- 文章卡片：左侧缩略/图标 + 标题 + 摘要 + 时间标签，信息层级分明。

### 7.3 输入框与表单

- 输入框：`h-9 rounded-md border border-input bg-background px-3`。
- 聚焦态：`ring-2 ring-ring ring-offset-2 ring-offset-background`。
- 错误态：边框改为 `border-destructive`，下方显示 12 px 错误文字。
- 表单标签 14 px，行高 20 px，与输入框间距 6 px。

### 7.4 标签与徽章

- 板块标签：`bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs`。
- 状态徽章：
  - 已通过：`bg-success/10 text-success`
  - 待审：`bg-warning/10 text-warning`
  - 失败/驳回：`bg-destructive/10 text-destructive`

### 7.5 表格

- 表头：`bg-muted/50 text-muted-foreground text-xs font-medium`。
- 行高：`h-10`。
- 斑马纹：使用 `even:bg-muted/30` 提升长表可读性。
- 操作列：右对齐，按钮使用 Ghost 尺寸 `h-8`。

### 7.6 公共组件规范

- **EmptyState**（空状态）：`rounded-lg border-dashed bg-muted/20 px-6 py-12`，居中展示图标 + 说明文字 + 可选动作按钮。
- **StatCard**（统计卡片）：`rounded-lg border p-4`；数值使用 `text-2xl tabular-nums` 保证对齐，标签使用 `text-xs text-muted-foreground`。
- **SectionHeader**（区块标题）：左侧图标 + `section-title` + `section-desc`，右侧可选动作区（按钮/链接），垂直居中对齐。
- **Pagination**（分页器）：上一页/下一页 + 页码；当 `total ≤ pageSize` 时不渲染。

### 7.7 骨架类规范

- `.page-scroll`：页面级滚动容器（`overflow-auto`），配合主内容区 flex 布局使用。
- `.page-container`：页面内容容器，水平边距 `px-4 md:px-6 lg:px-8`。
- `.page-header`：页面头部区块，容纳标题与描述，底部预留区块间距。
- `.page-title`：页面标题，24 px / 600 / 行高 1.35。
- `.page-desc`：页面描述，`text-sm text-muted-foreground`。
- `.page-eyebrow`：眉题/前置小标，`text-xs text-muted-foreground`。
- `.section`：内容区块，区块间距 24 px（`space-6`）。
- `.section-title`：区块标题，20 px / 600。
- `.section-desc`：区块描述，`text-sm text-muted-foreground`。

---

## 8. 动效与微交互

### 8.1 过渡参数

- 默认过渡：`transition-all duration-200 ease-out`。
- 颜色/背景：`transition-colors duration-150`。
- 按钮 active：`scale-95`（仅 `transform`）。
- 按钮 hover：`scale-105` 仅用于图标按钮；文字按钮不使用放大，避免版面抖动。

### 8.2 反馈

- 操作成功：Toast 右上角滑入，2.5 s 自动消失。
- 操作失败：Toast + 表单字段错误提示。
- 加载：骨架屏用于列表首次加载；按钮内 Spinner 用于提交中。
- 收藏：心形图标 `scale-110 → scale-100` 弹跳反馈，状态乐观更新。

### 8.3 页面切换

- 分栏阅读器内切换文章：内容区 `opacity-0 → opacity-100` 150 ms 淡入，避免突兀。
- 路由页面切换：不使用复杂转场，保持专业效率感。

---

## 9. 无障碍规范（WCAG 2.2 AA）

| 检查项 | 要求 |
|--------|------|
| 对比度 | 正文 ≥ 4.5:1；大字号/UI 组件 ≥ 3:1。 |
| 焦点可见 | 所有可交互元素有 `ring-2 ring-ring` 焦点环，不依赖鼠标 hover。 |
| 键盘导航 | Sidebar、分栏、弹窗、表单均可通过 Tab/Enter/Esc 操作。 |
| ARIA | 使用语义化 HTML 优先；弹窗使用 `role="dialog"` + `aria-modal`；图标按钮使用 `aria-label`。 |
| 标题层级 | 页面仅一个 H1，层级连续不跳级（H1 → H2 → H3）。 |
| 动效 | 遵守 `prefers-reduced-motion`，可关闭非必要动画。 |

---

## 10. 现有问题与改进清单

| 优先级 | 问题 | 改进方案 | 文件 |
|--------|------|----------|------|
| P0 | 榜单页硬编码 `#165DFF` 与全局 token 不一致 | 统一改为 `bg-primary` / `text-primary` | `ranking.css` |
| P0 | AdminPage “更新日期录入”卡片脱离 grid | 修复 JSX 结构，放入 `grid` 容器内 | `AdminPage.tsx` |
| P1 | 文章详情 `max-w-3xl` 在 2K/4K 屏两侧空白过大 | 响应式加宽：`xl:max-w-[880px]` | `ArticleDetailPage.tsx` |
| P1 | Sidebar 折叠态无文字/Tooltip | 增加 `title` 或 Shadcn Tooltip | `Sidebar.tsx` |
| P1 | 弱提示文字对比度偏低 | 小字正文不使用 `text-muted-foreground`，仅用于大字号说明 | 全局 |
| P2 | ~~页面标题仍为“妙搭”~~（✅ 已完成：`client/index.html:8` 已是“产品研究知识库”） | ~~改为“产品研究知识库”~~ | `client/index.html` |
| P2 | 未接入暗色模式 | 可选：保留 light，若需 dark 再引入 `next-themes` 与 dark token | - |

---

## 11. 落地优先级建议

### 阶段一：修正与统一（1-2 天）

1. 修复 AdminPage 卡片布局 bug。
2. 将 `ranking.css` 硬编码色值替换为 Tailwind token，并统一表格样式。
3. ~~将 `client/index.html` 标题改为“产品研究知识库”~~（✅ 已完成，`client/index.html:8` 已是“产品研究知识库”）。
4. 更新 `client/src/data/changelog.ts` 并发布。

### 阶段二：可读性提升（2-3 天）

1. 文章详情响应式加宽。
2. 表格斑马纹与表头固定。
3. Sidebar 折叠态增加 Tooltip。
4. 统一后台卡片网格与表单样式。

### 阶段三：无障碍与动效（可选）

1. 全局焦点环检查。
2. 接入 `prefers-reduced-motion`。
3. 如需对外公开，补充暗色模式。

---

## 12. 设计 token 速查表

```css
/* 可直接追加到 tailwind-theme.css 的 @theme inline 中 */
--color-primary: hsl(221 83% 53%);
--color-primary-foreground: hsl(220 14% 98%);
--color-secondary: hsl(220 14% 96%);
--color-muted-foreground: hsl(218 11% 46%);
--color-border: hsl(220 14% 89%);
--color-ring: hsl(221 83% 53%);
--color-success: hsl(130 54% 42%);
--color-warning: hsl(26 90% 49%);
--color-destructive: hsl(2 84% 62%);
--radius-lg: 0.5rem;
```

---

*文档版本：2026-08-20*  
*基于现有代码库：product-kb-deploy（React 19 + Tailwind v4 + Shadcn UI）*
