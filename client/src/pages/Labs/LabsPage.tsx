/**
 * /labs 动态与发现：站内 AI 成果聚合页（**原生 React 实现，v2**）。
 *
 * 🔴 2026-10-08 重写：废弃「iframe 挂载 6MB 自包含静态年报 HTML + postMessage
 * 注入」方案。废弃原因（当日三轮线上实测）：
 *   - iframe 与宿主交互受限：contentDocument 同源直改 DOM 在平台运行环境
 *     静默失效（本地 playwright 复现不了）；
 *   - 附件打开三路全死：/media 顶导航被平台转交对象存储、/api 直链被 CSRF
 *     拦、多段深链也被转交 TOS（详见 shared/quick-tools.ts 头注释）；
 *   - 静态 HTML 无 hash，缓存穿透要靠 ?v= 构建参数等补丁。
 * 原生实现一并消灭以上整类问题：报告正文静态化为字符串
 * （report-content.ts，图片抽到 public/labs/assets）。
 *
 * 🔴 2026-10-10 分类四值收敛：右栏三分区（AI资讯/Demo/评测，Base 驱动）与
 * 02「游戏 Demo 聚合」页签一并下线（原三分类已并入便捷工具表「文档/链接」，
 * 数据流迁往发现页主网格）；本页只剩 01 报告正文 + AI 编译入口卡。
 *
 * 样式见 labs-report.css，作用域 .labs-root。
 */
import { withClientBasePath } from '@client/src/lib/base-path';
import { buildReportContentHtml } from './report-content';
import './labs-report.css';

/** 报告正文（静态串 + 图片占位替换，模块级算一次即可）。 */
const REPORT_HTML = buildReportContentHtml(import.meta.env.BASE_URL);

/** 动态与发现：报告正文（01）+ AI 编译入口卡。 */
export default function LabsPage() {
  return (
    // page-scroll = 全站壳层滚动约定（壳层固定高度、body 不滚，页面根节点自滚）；
    // 缺它则长报告被视口裁掉且无法滚动（2026-10-08 线上实测）。
    <div className="labs-root page-scroll">
      <main className="wrap">
        <section aria-label="01 AI介入现状">
          <div className="labs-split">
            {/* 报告正文：开发者手写静态 HTML（report-content.ts），非用户输入 */}
            <div className="page pn-main">
              <div
                className="page-inner"
                // eslint-disable-next-line react/no-danger
                dangerouslySetInnerHTML={{ __html: REPORT_HTML }}
              />
            </div>
            <aside className="labs-rail">
              <div className="rail-sec">
                <a
                  className="rail-cta"
                  href={withClientBasePath('/ai')}
                  target="_top"
                >
                  <span className="cta-ic">✦</span>
                  <span className="cta-txt">
                    <b>AI 编译工作台</b>
                    <span>结论卡编辑器界面 → 进入 /ai</span>
                  </span>
                </a>
              </div>
            </aside>
          </div>
        </section>

        <footer className="site-footer">
          <span>AI × GAME · 2026 SEPTEMBER</span>
          <span>公开资料整理</span>
        </footer>
      </main>
    </div>
  );
}
