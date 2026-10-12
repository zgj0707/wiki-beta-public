/**
 * 「动态与发现」01 页签报告正文（自 ai-games-report.html 静态年报原样迁移）。
 *
 * 来源：原 6MB 自包含 HTML 的面板主体（hero → 指标 → 路径 → 案例 → 市场 →
 * 游戏案例 → 风险 → 洞察 → 来源盒），data:image 内嵌图已抽出为
 * public/labs/assets/img-01..08，本串仅含结构化标记（约 13KB）。
 * 图片以 __IMG_N__ 占位，buildReportContentHtml() 在渲染前替换为静态资源 URL。
 *
 * 🔴 内容为开发者手写的静态 HTML（不含任何用户输入），经 dangerouslySetInnerHTML
 * 渲染是安全的；不要把动态数据拼进本串。
 */

/** 报告图片张数（public/labs/assets/img-01..08）。 */
export const REPORT_IMAGE_COUNT = 8;

/** 用静态资源 URL 替换 __IMG_N__ 占位，返回最终可渲染 HTML。 */
export function buildReportContentHtml(baseUrl: string): string {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  let html = REPORT_CONTENT_HTML;
  for (let i = 1; i <= REPORT_IMAGE_COUNT; i += 1) {
    const nn = String(i).padStart(2, "0");
    const ext = i === 3 || i === 5 ? "png" : "jpg";
    html = html.split(`__IMG_${i}__`).join(`${base}labs/assets/img-${nn}.${ext}`);
  }
  return html;
}

export const REPORT_CONTENT_HTML = `<div class="hero-shell">
<div class="hero">
        <div>
          <div class="eyebrow">产品落地与技术前沿</div>
          <h1>AI 游戏：<br><em>从管线到玩法</em></h1>
          <p class="hero-dek">腾讯把 AI 放进成熟游戏与创作工具；字节围绕 AI 原生作品重做生产流程。玩家已经能碰到互动 NPC、AI 队友与生成式创作，长线体验和成本仍待验证。</p>
          <div class="hero-note"><b>核心判断</b><span>AI 已能生成内容、参与互动；但要由人确认目标、提交反馈，并守住可控底线。</span></div>
        </div>
        <figure class="hero-figure">
          <img src="__IMG_1__" alt="《不问凡尘》战斗画面，玩家角色与敌人对战，画面显示技能和状态栏" loading="lazy">
          <figcaption><strong>《不问凡尘》游戏画面</strong> · 媒体截图；Steam 页面说明作品使用 AI 生成内容。<a href="https://www.3dmgame.com/news/202605/3944892.html" target="_blank" rel="noopener">图片来源：3DM</a> · <a href="https://store.steampowered.com/app/4209920/?l=schinese" target="_blank" rel="noopener">Steam 页面</a></figcaption>
        </figure>
      </div>
        </div>
        <div class="page-head">
          <div><div class="kicker">01 / AI in games</div><h2>AI 已从研发后台走到玩家眼前</h2><p class="page-intro">当前落点集中在三处：加快生产、增加互动、降低创作门槛。</p></div>
          <div class="side-note">腾讯：给成熟产品加 AI 功能；字节：以小团队试做 AI 原生作品与生产管线。</div>
        </div>
        <div class="metric-grid" aria-label="公开披露数据">
          <div class="metric"><strong>1.1 亿</strong><span>AI NPC 累计体验</span><small>腾讯游戏发布会相关报道口径</small></div>
          <div class="metric"><strong>15 分钟</strong><span>最快生成可玩内容</span><small>创作助手公开演示口径</small></div>
          <div class="metric"><strong>5300 万+</strong><span>万能生成器累计使用</span><small>较早公开数据，非当前实时值</small></div>
          <div class="metric"><strong>不足 20 人</strong><span>《不问凡尘》团队规模</span><small>项目组访谈口径</small></div>
        </div>
        <div class="strategy-grid" aria-label="腾讯与字节的切入路线">
          <div class="strategy-card"><b>腾讯｜成熟产品加能力</b><span>从既有游戏的 AI 队友、NPC 与 UGC 工具切入。</span></div>
          <div class="strategy-card"><b>字节｜AI 原生试做</b><span>围绕《不问凡尘》探索 AI 内容生产与互动玩法。</span></div>
        </div>
        <div class="flow-title"><strong>AI 落进游戏的三条路径</strong><span class="dash"></span><span class="chip">产品功能 ≠ 商业验证</span></div>
        <div class="path-grid">
          <article class="path"><span class="num">01 · 生产</span><h3>降本增效</h3><p>AI 参与场景、角色、动画与剧情生产；人仍负责方向、筛选、连贯性和质量验收。</p><div class="chips"><span class="chip">资产生成</span><span class="chip">Agent 工作流</span><span class="chip">人工把关</span></div></article>
          <article class="path"><span class="num">02 · 互动</span><h3>NPC 互动</h3><p>NPC 与队友能围绕对话、选择和局势作出变化；关键是回应是否稳定、能否服务玩法。</p><div class="chips"><span class="chip blue">AI 队友</span><span class="chip blue">互动 NPC</span><span class="chip blue">运行时生成</span></div></article>
          <article class="path"><span class="num">03 · 共创</span><h3>UGC生态</h3><p>从自然语言或图片开始生成素材、角色和玩法，降低创作起步门槛；编辑器截图见下图2。</p><div class="chips"><span class="chip gold">文字生成</span><span class="chip gold">UGC</span><span class="chip gold">玩家素材</span></div></article>
        </div>
        <div class="flow-title"><strong>案例与证据：从功能到玩家体验</strong><span class="dash"></span></div>
        <div class="case-grid">
          <article class="case">
            <figure class="case-visual"><img src="__IMG_2__" alt="《和平精英》AI 明星队友小田宣传配图" loading="lazy"></figure>
            <div class="case-copy"><span class="tag">腾讯 · 游戏内互动</span><h3>《和平精英》</h3><p>AI 明星队友提供陪伴与战术协助；发布会报道披露 AI NPC 累计体验约 1.1 亿，创作助手最快约 15 分钟产出可玩内容。</p><div class="proof"><a href="https://game.xiaomi.com/viewpoint/1289679014_1780323188391_100" target="_blank" rel="noopener">队友配图：小米游戏中心</a> · <a href="https://www.yemacaijing.com/Index/view/id/93223.html" target="_blank" rel="noopener">数据：发布会报道</a></div></div>
          </article>
          <article class="case">
            <figure class="case-visual"><img src="__IMG_3__" alt="《蛋仔派对》关卡编辑器界面截图，显示可编辑的平台和工具栏" loading="lazy"></figure>
            <div class="case-copy"><span class="tag">腾讯 · 玩家共创</span><h3>《蛋仔派对》</h3><p>“万能生成器”支持从文字生成 3D 模型；公开累计使用超过 5300 万。配图展示编辑器界面，不代表 AI 生成结果。</p><div class="proof"><a href="https://bbs.gameres.com/thread_905411_1_1.html" target="_blank" rel="noopener">功能与数据：GameRes</a> · <a href="https://www.9game.cn/dzpd/6766937.html" target="_blank" rel="noopener">编辑器截图：九游</a></div></div>
          </article>
          <article class="case no-image">
            <div class="case-copy"><span class="tag">字节 · AI 原生尝试</span><h3>《不问凡尘》</h3><p>修仙互动作品把 AI 生成场景、视频和 NPC 对话放入预设玩法；项目组访谈称团队不足 20 人，制作过程仍依赖人工筛选和打磨。主视觉实机截图见页首。</p><div class="proof"><a href="https://finance.eastmoney.com/a/202608113837896062.html" target="_blank" rel="noopener">项目组访谈与生产流程</a> · <a href="https://store.steampowered.com/app/4209920/?l=schinese" target="_blank" rel="noopener">Steam 抢先体验页</a></div></div>
          </article>
          <article class="case no-image">
            <div class="case-copy"><span class="tag">Steam · 运行时大模型</span><h3>《历史模拟器：崇祯》</h3><p>商店页说明，国家状态反馈与大臣对话由大语言模型运行时生成；继续推演会消耗 Token，玩家可购买积分或自接 API。费用与边界在第三页展开。</p><div class="proof"><a href="https://store.steampowered.com/app/4304230/" target="_blank" rel="noopener">Steam 功能与 Token 规则</a></div></div>
          </article>
        </div>
        <div class="market">
          <div><div class="kicker" style="color:#99702c">EARLY SIGNAL</div><h3>两款样本，反馈分化</h3><p>Steam 好评率为 2026-09-29 快照。</p><p>ai的调教直接影响玩家的体验——风险与机遇并存。</p></div>
          <div class="bars" role="img" aria-label="不问凡尘 Steam 好评率 88%，历史模拟器崇祯 Steam 好评率 49%">
            <div class="bar-row"><span>不问凡尘</span><div class="bar-track"><div class="bar-fill" style="width:88%"></div></div><span class="bar-val">88%</span></div>
            <div class="bar-row"><span>历史模拟器：崇祯</span><div class="bar-track"><div class="bar-fill" style="width:49%"></div></div><span class="bar-val">49%</span></div>
          </div>
          <p class="chart-foot">来源：<a href="https://store.steampowered.com/app/4209920/?l=schinese" target="_blank" rel="noopener">不问凡尘 Steam</a> · <a href="https://store.steampowered.com/app/4304230/" target="_blank" rel="noopener">崇祯 Steam</a>。好评率会变化；不可据此推断销量、留存或作品优劣。</p>
        </div>
      <section class="game-cases">
          <div class="model-block-head"><div><div class="kicker">GAMES USING AI · EMBEDDED SCREENSHOTS</div><h3>游戏案例：AI进入了哪一层</h3></div><p>下方截图与缩略图均内嵌在本文件，离线打开也可查看。</p></div>
          <div class="game-case-grid">
            <article class="game-case"><figure class="game-shot-wrap"><img class="game-shot" src="__IMG_4__" alt="《和平精英》实机画面：AI战犬布鲁斯在对局中跟随玩家" loading="lazy"><figcaption>实机画面：AI战犬“布鲁斯” · 新浪新闻截图</figcaption></figure><div class="game-case-body"><div class="game-case-kicker">腾讯 · 游戏内AI队友</div><h4>《和平精英》</h4><p>AI队友可接收语音或指令轮盘命令，跟随、搜敌、保护并协助行动。GDC披露的1.1亿为全体AI NPC累计体验，不能等同于单个角色的活跃用户。</p><div class="game-depth"><div class="game-depth-line"><span>AI介入深度</span><strong>L2 · 玩家可见互动</strong></div><div class="depth-pips" role="img" aria-label="本报告分级第2级，共3级"><i class="on"></i><i class="on"></i><i></i></div><div class="game-source"><a href="https://static.nfnews.com/content/202603/13/c12240659.html?enterColumnId=38" target="_blank" rel="noopener">游戏内功能与指标 ↗</a><a href="https://k.sina.cn/article/5606482243_14e2c214300101k8ai.html" target="_blank" rel="noopener">截图来源 ↗</a></div></div></div></article>
<article class="game-case"><figure class="game-shot-wrap"><img class="game-shot" src="__IMG_5__" alt="《蛋仔派对》关卡编辑器实机截图；画面展示创作界面，不代表AI生成结果" loading="lazy"><figcaption>关卡编辑器截图 · 九游；显示创作界面</figcaption></figure><div class="game-case-body"><div class="game-case-kicker">网易 · 玩家共创工具</div><h4>《蛋仔派对》</h4><p>“万能生成器”把文字转成3D模型，AI进入玩家创作入口。旧报道中的5300万+是工具累计使用口径，不代表作品采用量或当前实时值。</p><div class="game-depth"><div class="game-depth-line"><span>AI介入深度</span><strong>L2 · 玩家创作工具</strong></div><div class="depth-pips" role="img" aria-label="本报告分级第2级，共3级"><i class="on"></i><i class="on"></i><i></i></div><div class="game-source"><a href="https://bbs.gameres.com/thread_905411_1_1.html" target="_blank" rel="noopener">功能与历史数据 ↗</a><a href="https://www.9game.cn/dzpd/6766937.html" target="_blank" rel="noopener">截图来源 ↗</a></div></div></div></article>
<article class="game-case"><figure class="game-shot-wrap"><img class="game-shot" src="__IMG_6__" alt="《不问凡尘》游戏内场景截图" loading="lazy"><figcaption>游戏画面 · 3DM媒体截图</figcaption></figure><div class="game-case-body"><div class="game-case-kicker">字节生态 · AI互动内容</div><h4>《不问凡尘》</h4><p>Steam披露AI用于视频、场景等内容，游戏也提供AI NPC互动。处于抢先体验；公开材料未给出AI内容在最终成品中的采用比例。</p><div class="game-depth"><div class="game-depth-line"><span>AI介入深度</span><strong>L2 · 玩家可见内容与互动</strong></div><div class="depth-pips" role="img" aria-label="本报告分级第2级，共3级"><i class="on"></i><i class="on"></i><i></i></div><div class="game-source"><a href="https://store.steampowered.com/app/4209920/?l=schinese" target="_blank" rel="noopener">Steam AI内容说明 ↗</a><a href="https://www.3dmgame.com/news/202605/3944892.html" target="_blank" rel="noopener">截图来源 ↗</a></div></div></div></article>
<article class="game-case"><figure class="game-shot-wrap"><img class="game-shot" src="__IMG_7__" alt="《历史模拟器：崇祯》游戏内政策规划界面截图" loading="lazy"><figcaption>游戏界面截图 · Steam商店图</figcaption></figure><div class="game-case-body"><div class="game-case-kicker">青干工作室 · 运行时模拟</div><h4>《历史模拟器：崇祯》</h4><p>游戏运行时调用大语言模型生成局势反馈与大臣对话；Token耗尽后需购买积分或自接API，AI已进入主要推演循环。</p><div class="game-depth"><div class="game-depth-line"><span>AI介入深度</span><strong>L3 · 核心玩法依赖实时生成</strong></div><div class="depth-pips" role="img" aria-label="本报告分级第3级，共3级"><i class="on"></i><i class="on"></i><i class="on"></i></div><div class="game-source"><a href="https://store.steampowered.com/app/4304230/?l=schinese" target="_blank" rel="noopener">Steam功能与费用说明 ↗</a></div></div></div></article>
          </div>
          <p class="game-level-note"><strong>本页分级：</strong>L1 研发后台辅助；L2 玩家可见的互动或创作工具；L3 主要玩法循环依赖模型实时生成。分级描述AI介入位置，不代表质量、用户规模或商业成功。</p>
        </section>

        <div class="flow-title"><strong>风险与启示</strong><span class="dash"></span></div>
        <div class="risk-layout">
          <div class="risk-list">
            <article class="risk-row"><div class="risk-icon">01</div><div><h3>质量与可控性</h3><p>生成结果会偏离设定或破坏连续性。项目组访谈称，公开片段背后可能经历 20–50 次生成尝试，人工筛选仍是生产的一部分。</p></div></article>
            <article class="risk-row"><div class="risk-icon">02</div><div><h3>长线体验与稳定性</h3><p>短时互动演示不代表数小时的连贯世界；角色边界、任务目标和多人互动仍需明确规则与回退方案。</p></div></article>
            <article class="risk-row"><div class="risk-icon">03</div><div><h3>成本、延迟与可用性</h3><p>运行时推理会带来等待和账单。《历史模拟器：崇祯》Steam 页面披露 Token 消耗，并提供购买积分或自接 API 的方式。</p></div></article>
            <article class="risk-row"><div class="risk-icon">04</div><div><h3>素材、隐私与内容安全</h3><p>玩家上传图片或与角色对话时，应说明素材用途、保存期限、审核方式及删除渠道；这是产品设计要求，不是对个案违规的判断。</p></div></article>
          </div>
          <figure class="risk-proof">
            <img src="__IMG_8__" alt="《历史模拟器：崇祯》国策规划界面截图，显示政策树和内阁数值" loading="lazy">
            <figcaption>《历史模拟器：崇祯》Steam 商店截图 · 图片本身不展示 Token 费用；费用与 API 规则以商店页文字说明为准。</figcaption>
            <h3>可从个案读出的产品原则</h3>
            <p>《不问凡尘》把 AI 体验放在既定任务与玩法结构中，让模型增加互动空间；目标、奖励和核心循环仍由制作团队编排。</p>
          </figure>
        </div>

        <div class="insight-band">
          <div class="title">让 AI 扩大表达，<br>由游戏守住体验。</div>
          <div class="principles">
            <div class="principle"><b>先选场景</b>用在玩家能感知、失败可回退的环节</div>
            <div class="principle"><b>再定边界</b>锁定角色设定、奖励规则与安全线</div>
            <div class="principle"><b>保留把关</b>生成后审查，核心循环由团队掌舵</div>
            <div class="principle"><b>持续衡量</b>同时看乐趣、留存、延迟、成本与投诉</div>
          </div>
        </div>

        <div class="sourcebox">
          <details>
            <summary>展开来源与统计</summary>
            <ul>
              <li><a href="https://store.steampowered.com/app/4209920/?l=schinese" target="_blank" rel="noopener">Steam · 不问凡尘：AI 内容声明与评测</a></li>
              <li><a href="https://store.steampowered.com/app/4304230/" target="_blank" rel="noopener">Steam · 历史模拟器：崇祯：Token 规则与评测</a></li>
              <li><a href="https://finance.eastmoney.com/a/202608113837896062.html" target="_blank" rel="noopener">项目组访谈 · 团队规模、制作流程与人工筛选</a></li>
              <li><a href="https://www.yemacaijing.com/Index/view/id/93223.html" target="_blank" rel="noopener">野马财经 · 腾讯游戏发布会实况</a></li>
              <li><a href="https://bbs.gameres.com/thread_905411_1_1.html" target="_blank" rel="noopener">GameRes · 蛋仔派对万能生成器与历史数据</a></li>
              <li><a href="https://game.xiaomi.com/viewpoint/1289679014_1780323188391_100" target="_blank" rel="noopener">小米游戏中心 · 和平精英 AI 队友配图</a></li>
              <li><a href="https://www.9game.cn/dzpd/6766937.html" target="_blank" rel="noopener">九游 · 蛋仔派对编辑器截图</a></li>
              <li><a href="https://www.3dmgame.com/news/202605/3944892.html" target="_blank" rel="noopener">3DM · 不问凡尘游戏截图</a></li>
              <li><a href="https://deepmind.google/models/genie/" target="_blank" rel="noopener">Google DeepMind · Genie 3 能力与限制</a></li>
              <li><a href="https://arxiv.org/abs/2511.23429" target="_blank" rel="noopener">Hunyuan-GameCraft 2 · 交互式游戏世界模型论文</a></li>
              <li><a href="https://deepmind.google/blog/sima-2-an-agent-that-plays-reasons-and-learns-with-you-in-virtual-3d-worlds/" target="_blank" rel="noopener">Google DeepMind · SIMA 2 虚拟世界智能体</a></li>
              <li><a href="https://arxiv.org/abs/2604.07429" target="_blank" rel="noopener">GameWorld · 多模态游戏智能体基准评测</a></li>
            </ul>
            <p class="method">统计截至 2026-09-29；Steam 好评率为当日抓取快照。企业及媒体披露数字按其原口径转述：“1.1 亿 / 15 分钟”来自腾讯游戏发布会报道；“5300 万+”为较早公开的累计使用数据；“不足 20 人”与“20–50 次生成尝试”来自项目组访谈。Genie 3、SIMA 2 与 Hunyuan-GameCraft 2 均按研究或原型展示描述，不称作商业化完整游戏。截图数据已内嵌，打开文件无需联网加载图片；来源链接需联网访问。</p>
          </details>
        </div>
`;

export default REPORT_CONTENT_HTML;
