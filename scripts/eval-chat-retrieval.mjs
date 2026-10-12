#!/usr/bin/env node
/**
 * Chatbot 检索层回归集（eval-chat-retrieval.mjs）
 *
 * 对 POST /api/chat/retrieve 跑固定问题集，断言召回质量——仅测检索层，
 * 不调 LLM、不耗 Key。prompt / 检索参数每次改动后应先跑本脚本再发布。
 *
 * 用法（先本地起服：`apps +env-pull` 产出 .env.local 后按 dev.sh 起后端）：
 *   EVAL_URL='http://[::1]:3000/api/chat/retrieve' \
 *   EVAL_CSRF=<csrf-token> \
 *   node scripts/eval-chat-retrieval.mjs
 *
 * EVAL_URL 缺省指向本地 dev 后端；EVAL_CSRF 同时注入 Cookie 与头（本地校验两者相等即可）。
 * EVAL_WITH_MECHANISM=1 才纳入机制观察来源用例（本地 dev 该表为空表，见 CASES 注释）。
 * 退出码：命中类用例全过且误召回为 0 → 0，否则 1（可接 CI）。
 */

const DEFAULT_URL =
  'http://[::1]:3000/api/chat/retrieve';

/**
 * 用例集：expect='hit' 必须召回（citations>0）；expect='miss' 必须零召回。
 * 可选 source='article' | 'mechanism' 断言「引用里至少有一条该来源」。
 * 覆盖意图：实体问 / 品类问 / 机制问 / 对比 / 榜单 / 英文词 / 闲聊越界。
 * 用例随语料演进维护：改召回口径时先跑一遍，坏例修检索而不是放宽断言。
 *
 * ⚠️ 机制来源用例默认**跳过**：本地 dev 分支 `mechanism_observation` 是空表
 *（线上才有数据），默认跑必假失败、破坏「全过 → 退出码 0」的约定。
 * 需要对线上数据的库跑时加 `EVAL_WITH_MECHANISM=1`。
 */
const CASES = [
  { q: '腾讯游戏最近有什么动态', expect: 'hit' },
  { q: '网易的三agnarok相关产品', expect: 'hit' },
  { q: '三七互娱的买量策略', expect: 'hit' },
  { q: 'SLG 品类近期的市场变化', expect: 'hit' },
  { q: '放置挂机品类的留存设计', expect: 'hit' },
  { q: '修仙品类的突破境界机制', expect: 'hit' },
  { q: '女性向游戏的商业化思路', expect: 'hit' },
  { q: '小游戏买量的素材趋势', expect: 'hit' },
  { q: '微信畅销榜前列有哪些产品', expect: 'hit' },
  { q: '9月第二周的竞品信息监控周报讲了什么', expect: 'hit' },
  { q: '上个月的周报里小游戏榜单格局如何', expect: 'hit' },
  { q: 'Steam 热销榜周报', expect: 'hit' },
  { q: '开箱机制的成瘾设计', expect: 'hit' },
  { q: '公会系统的社交设计', expect: 'hit' },
  { q: '吃丹修炼玩法分析', expect: 'hit' },
  { q: 'Pachinko 弹珠机制移植', expect: 'hit' },
  { q: 'gacha 抽卡保底机制对比', expect: 'hit' },
  { q: '王者荣耀和原神对比', expect: 'any' },
  { q: '你们网站是谁开发的', expect: 'any' },
  { q: '今天天气怎么样', expect: 'miss' },
  { q: '帮我写一段代码', expect: 'miss' },
  { q: '1+1等于几', expect: 'miss' },
  // ── 机制观察来源（需 EVAL_WITH_MECHANISM=1 + 有机制语料的库）──────────
  { q: 'Sandustry 的机制是怎么设计的', expect: 'hit', source: 'mechanism' },
  { q: '沙金工业的机制与利用方法', expect: 'hit', source: 'mechanism' },
  { q: '机制观察里有哪些弹珠类的机制', expect: 'hit', source: 'mechanism' },
  { q: '机制观察收录的机制一般从哪里来', expect: 'hit', source: 'mechanism' },
];

/** 机制语料只存在于线上/带数据的库；默认跳过，避免本地假失败。 */
const WITH_MECHANISM = process.env.EVAL_WITH_MECHANISM === '1';
const RUN_CASES = WITH_MECHANISM
  ? CASES
  : CASES.filter((item) => item.source !== 'mechanism');
// ⚠️ 必须声明在 RUN_CASES **之后**：顶层 const 同处 TDZ，提前引用会直接抛
// ReferenceError（本行曾一度被放在上面，导致脚本连第 61 行都执行不到 ——
// 即「唯一检索质量守门」事实上停摆，且因退出码非 0 无声，直到 09-22 才发现）。
const MECHANISM_SKIPPED = CASES.length - RUN_CASES.length;

const url = process.env.EVAL_URL || DEFAULT_URL;
const csrf = process.env.EVAL_CSRF || '';

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (csrf) {
    headers['x-suda-csrf-token'] = csrf;
    headers.Cookie = `suda-csrf-token=${csrf}`;
  }
  return headers;
}

async function ask(question) {
  const response = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify({ message: question, history: [] }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 120)}`);
  }
  return (await response.json()) ?? {};
}

async function main() {
  console.log(`eval target: ${url}`);
  let hitPass = 0;
  let hitFail = 0;
  let missPass = 0;
  let missFail = 0;
  const failures = [];
  if (MECHANISM_SKIPPED) {
    console.log(
      `skip: ${MECHANISM_SKIPPED} 条机制来源用例（本地 dev 无机制语料；加 EVAL_WITH_MECHANISM=1 纳入）`,
    );
  }
  for (const item of RUN_CASES) {
    try {
      const result = await ask(item.q);
      const citations = Array.isArray(result.citations) ? result.citations : [];
      const top = citations[0]?.title || '(无)';
      const hitsOf = (prefix) =>
        citations.filter((c) => typeof c?.url === 'string' && c.url.startsWith(prefix))
          .length;
      let ok;
      if (item.expect === 'hit') ok = citations.length > 0;
      else if (item.expect === 'miss') ok = citations.length === 0;
      else ok = true;
      // 来源断言：跨来源引用是本轮新增能力，需可回归——只看 url 前缀，不看标题。
      if (item.source === 'mechanism') ok = ok && hitsOf('/mechanism-observatory/') > 0;
      if (item.source === 'article') ok = ok && hitsOf('/article/') > 0;
      if (item.expect === 'hit') ok ? (hitPass += 1) : (hitFail += 1);
      if (item.expect === 'miss') ok ? (missPass += 1) : (missFail += 1);
      if (!ok) failures.push(item.q);
      console.log(
        `${ok ? 'PASS' : 'FAIL'} [${item.expect}${item.source ? `/${item.source}` : ''}] citations=${citations.length} mech=${hitsOf('/mechanism-observatory/')} top=${top} | ${item.q}`,
      );
    } catch (error) {
      hitFail += item.expect === 'hit' ? 1 : 0;
      missFail += item.expect === 'miss' ? 1 : 0;
      failures.push(`${item.q} (error: ${error.message})`);
      console.log(`FAIL [${item.expect}] error=${error.message} | ${item.q}`);
    }
  }
  console.log('----');
  console.log(
    `hit: ${hitPass}/${hitPass + hitFail}  miss(零召回): ${missPass}/${missPass + missFail}  用例总数: ${RUN_CASES.length}${MECHANISM_SKIPPED ? `（另跳过 ${MECHANISM_SKIPPED}）` : ''}`,
  );
  if (failures.length) {
    console.log('失败用例：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('全部通过');
}

main();
