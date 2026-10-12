import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { isMechanismOnlyDocIds } from '@shared/chat-source';

/**
 * 批 2（前端反馈栏）的守护测试。
 *
 * 前端类单测的既有范式：jest 跑 node 环境、无 jsdom，故**读源码做文本断言**
 * （见 test/unit/about-site-entry.spec.ts）。这里锁住的都是「错了不会报错、只会
 * 静默丢数据或静默泄漏」的点：
 *  1. 好评夹带文本 → 后端有 CHECK 兜底，但前端不该依赖它（尤其 llmConfig 与问题
 *     同处一个请求体，一旦整包透传就把用户 BYO-Key 写进库）。
 *  2. `question` 必须记用户**原始输入**而非改写后的检索词 —— 记错会让所有归因失真。
 *  3. 片段只记长度不记全文 —— 记全文等于每轮 18KB。
 *  4. 来源前缀判定只能有一处实现（前后端各写一份必然漂移）。
 */
const ROOT = resolve(__dirname, '../..');
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), 'utf8');

const barSource = read('client/src/components/chat/ChatFeedbackBar.tsx');
const sessionSource = read('client/src/components/chat/use-chat-session.ts');
const apiSource = read('client/src/api/chat.ts');
const messageViewSource = read('client/src/components/chat/ChatMessageView.tsx');
const attributionSource = read(
  'server/modules/chat/chat-feedback-attribution.ts',
);
const retrievalCommonSource = read(
  'server/modules/chat/chat-retrieval-common.ts',
);

describe('isMechanismOnlyDocIds（前后端共用口径）', () => {
  it('空数组为 false —— 零命中是外部知识模式，不是机制边界', () => {
    expect(isMechanismOnlyDocIds([])).toBe(false);
  });

  it('全部机制来源为 true', () => {
    expect(isMechanismOnlyDocIds(['mechanism:a', 'mechanism:b'])).toBe(true);
  });

  it('混合来源为 false', () => {
    expect(isMechanismOnlyDocIds(['mechanism:a', 'article:b'])).toBe(false);
  });

  it('仅文章来源为 false', () => {
    expect(isMechanismOnlyDocIds(['article:b'])).toBe(false);
  });
});

describe('来源前缀只有一处实现', () => {
  it('归因函数复用 shared 判定，不再本地拼前缀', () => {
    expect(attributionSource).toContain('isMechanismOnlyDocIds');
    expect(attributionSource).not.toMatch(/startsWith\(MECHANISM_SOURCE_PREFIX\)/);
  });

  it('检索公共常量为 re-export，不重复定义字面量', () => {
    expect(retrievalCommonSource).toContain("from '@shared/chat-source'");
    expect(retrievalCommonSource).not.toContain("= 'mechanism:'");
    expect(retrievalCommonSource).not.toContain("= 'article:'");
  });

  it('反馈栏用同一份判定决定「机制类答太浅」的边界提示', () => {
    expect(barSource).toContain('isMechanismOnlyDocIds');
  });
});

describe('好评不带文本（隐私面）', () => {
  const submitSection = apiSource.slice(
    apiSource.indexOf('export async function submitChatFeedback'),
    apiSource.indexOf('export async function withdrawChatFeedback'),
  );

  it('好评分支只发 turnId + rating 两个字段', () => {
    expect(barSource).toContain('{ turnId, rating }');
  });

  it('好评分支不构造 context / answer / citations', () => {
    // 好评分支必须早于差评对象返回：用三元表达式把两条路径分开。
    expect(barSource).toMatch(/rating === 'up'[\s\S]{0,120}\{ turnId, rating \}/);
    // 只禁止把 llmConfig 当字段传（注释里提到这个词是允许且必要的）。
    expect(barSource).not.toMatch(/llmConfig\s*[:=]/);
  });

  it('反馈请求体不含 llmConfig（用户 BYO-Key 与问题同在一个请求体）', () => {
    expect(submitSection.length).toBeGreaterThan(0);
    expect(submitSection).not.toContain('llmConfig');
    expect(apiSource).not.toMatch(/ChatFeedbackPayload[\s\S]{0,600}llmConfig/);
  });
});

describe('采集字段正确性', () => {
  it('question 记用户原始输入（trimmed），不是改写后的检索词', () => {
    expect(sessionSource).toMatch(/question:\s*trimmed/);
  });

  it('searchQuery 单独留存（语义漂移可定位「改写把问题带偏」）', () => {
    expect(sessionSource).toMatch(/searchQuery:/);
  });

  it('片段只记长度、不记全文', () => {
    expect(sessionSource).toContain('doc.snippet.length');
    expect(sessionSource).not.toContain('snippet: doc.snippet');
  });

  it('turnId 在发送时生成且满足后端 turnId 校验（≥8 位字母数字）', () => {
    expect(sessionSource).toContain('randomUUID');
    expect(sessionSource).toMatch(/id:\s*turnId/);
  });
});

describe('入口挂载', () => {
  it('仅完成的回答挂反馈栏，且必须带 turnId', () => {
    expect(messageViewSource).toContain('<ChatFeedbackBar');
    expect(messageViewSource).toMatch(
      /phase === 'done' && !!message\.content && !message\.error && !!message\.id/,
    );
  });
});
