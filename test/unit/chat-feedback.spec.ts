import { BadRequestException, Logger } from '@nestjs/common';
import type { PostgresJsDatabase } from '@lark-apaas/fullstack-nestjs-core';

import {
  attributeFeedback,
  isMechanismOnly,
  type FeedbackSignals,
} from '../../server/modules/chat/chat-feedback-attribution';
import { ChatFeedbackService } from '../../server/modules/chat/chat-feedback.service';

/** 默认信号：一篇文章来源、片段未顶格、无异常标记。 */
function signals(patch: Partial<FeedbackSignals> = {}): FeedbackSignals {
  return {
    reason: 'shallow',
    citationDocIds: ['article:a1'],
    snippetLens: [900],
    external: false,
    truncated: false,
    stopped: false,
    ...patch,
  };
}

describe('attributeFeedback', () => {
  it('引用打不开 → 呈现层（与检索/生成无关）', () => {
    expect(
      attributeFeedback(signals({ reason: 'citation_broken' })),
    ).toBe('presentation');
  });

  it('用户主动停止 → 不归因（自伤型坏例不进归因统计）', () => {
    expect(attributeFeedback(signals({ stopped: true }))).toBeNull();
  });

  it('引用打不开的优先级高于 stopped', () => {
    expect(
      attributeFeedback(signals({ reason: 'citation_broken', stopped: true })),
    ).toBe('presentation');
  });

  it('答错了 → 生成层（有资料仍答错 = 幻觉/误读）', () => {
    expect(
      attributeFeedback(signals({ reason: 'wrong', citationDocIds: ['article:a1'] })),
    ).toBe('generation');
  });

  it('答非所问 + 零召回 → zero_recall（不猜是没入库还是没召回）', () => {
    expect(
      attributeFeedback(
        signals({
          reason: 'off_target',
          citationDocIds: [],
          external: true,
          snippetLens: [],
        }),
      ),
    ).toBe('zero_recall');
  });

  it('答非所问 + 命中了引用 → 检索层（召回不相关）', () => {
    expect(
      attributeFeedback(
        signals({ reason: 'off_target', citationDocIds: ['article:a1'] }),
      ),
    ).toBe('retrieval');
  });

  it('答得太浅 + 输出被截断 → 生成层（短是输出上限所致，不是资料不够）', () => {
    expect(
      attributeFeedback(signals({ reason: 'shallow', truncated: true })),
    ).toBe('generation');
  });

  it('答得太浅 + 只命中机制条目 → 已知边界，不计入缺陷池', () => {
    expect(
      attributeFeedback(
        signals({
          reason: 'shallow',
          citationDocIds: ['mechanism:k1', 'mechanism:k2'],
          snippetLens: [700],
        }),
      ),
    ).toBe('boundary');
  });

  it('答得太浅 + 文章片段顶格 1800 → 片段层（硬切片截掉了后文）', () => {
    expect(
      attributeFeedback(signals({ reason: 'shallow', snippetLens: [1800, 420] })),
    ).toBe('snippet');
  });

  it('答得太浅 + 片段未顶格 → 检索层（资料没找全）', () => {
    expect(
      attributeFeedback(signals({ reason: 'shallow', snippetLens: [1200] })),
    ).toBe('retrieval');
  });

  it('文章 + 机制混合来源不算仅机制（有正文可切片）', () => {
    expect(
      attributeFeedback(
        signals({
          reason: 'shallow',
          citationDocIds: ['article:a1', 'mechanism:k1'],
          snippetLens: [200],
        }),
      ),
    ).toBe('retrieval');
  });
});

describe('isMechanismOnly', () => {
  it('空引用不算仅机制', () => {
    expect(isMechanismOnly([])).toBe(false);
  });

  it('全部机制前缀才算', () => {
    expect(isMechanismOnly(['mechanism:a', 'mechanism:b'])).toBe(true);
    expect(isMechanismOnly(['mechanism:a', 'article:b'])).toBe(false);
  });
});

/** 捕获 upsert 实参的极简 drizzle 链 stub。 */
function makeService(deleteResult: string[] = []) {
  const captured: {
    values?: Record<string, unknown>;
    set?: Record<string, unknown>;
  } = {};
  const onConflictDoUpdate = jest.fn(async (arg: { set: Record<string, unknown> }) => {
    captured.set = arg.set;
  });
  const values = jest.fn((arg: Record<string, unknown>) => {
    captured.values = arg;
    return { onConflictDoUpdate };
  });
  const insert = jest.fn(() => ({ values }));
  const returning = jest.fn(async () =>
    deleteResult.map((turnId) => ({ turnId })),
  );
  const where = jest.fn(() => ({ returning }));
  const del = jest.fn(() => ({ where }));
  const service = new ChatFeedbackService({
    insert,
    delete: del,
  } as unknown as PostgresJsDatabase);
  return { service, captured, onConflictDoUpdate, del };
}

const TURN_ID = '3f7a1c2e-0000-4000-8000-000000000001';

let logSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  // ⚠️ Nest 的 Logger 直写 stdout，不经 console.* —— 必须 spy 原型方法。
  logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warnSpy = jest
    .spyOn(Logger.prototype, 'warn')
    .mockImplementation(() => undefined);
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
});

describe('ChatFeedbackService', () => {
  it('好评不落任何文本（🔴 隐私：llmConfig 与问题同体，好评行必须全空）', async () => {
    const { service, captured } = makeService();
    const result = await service.record({
      turnId: TURN_ID,
      rating: 'up',
    });
    expect(result).toEqual({ attribution: null, status: 'new' });
    const row = captured.values ?? {};
    for (const key of [
      'reason',
      'question',
      'searchQuery',
      'answer',
      'citations',
      'context',
      'attribution',
    ]) {
      expect(row[key]).toBeNull();
    }
  });

  it('好评被误塞文本字段 → 丢弃并只记字段名告警（不拒绝，不记内容）', async () => {
    const { service, captured } = makeService();
    await service.record({
      turnId: TURN_ID,
      rating: 'up',
      question: '这是不该被记录的内容',
      answer: '同样不该被记录',
    });
    const row = captured.values ?? {};
    expect(row.question).toBeNull();
    expect(row.answer).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warned = String(warnSpy.mock.calls[0][0]);
    expect(warned).toContain('question,answer');
    expect(warned).not.toContain('这是不该被记录的内容');
  });

  it('差评算出归因并落全量上下文', async () => {
    const { service, captured } = makeService();
    const result = await service.record({
      turnId: TURN_ID,
      rating: 'down',
      reason: 'shallow',
      question: 'Sandustry 的机制怎么设计的',
      searchQuery: 'Sandustry 机制 设计',
      answer: '三段式摘要……',
      citations: [
        {
          docId: 'mechanism:k-sand',
          title: '沙金工业',
          source: 'mechanism',
          sourceDate: '2026-09-01',
          url: '/mechanism-observatory/k-sand',
        },
      ],
      context: {
        external: false,
        truncated: false,
        stopped: false,
        deep: false,
        historyTurns: 0,
        snippetLens: [700],
        model: 'deepseek-v4.1-flash',
        usage: { promptTokens: 1200, completionTokens: 300 },
      },
    });
    expect(result).toEqual({ attribution: 'boundary', status: 'boundary' });
    const row = captured.values ?? {};
    expect(row.question).toBe('Sandustry 的机制怎么设计的');
    expect(row.attribution).toBe('boundary');
    expect(row.status).toBe('boundary');
  });

  it('未知上下文字段被丢弃（白名单，防 llmConfig 入档）', async () => {
    const { service, captured } = makeService();
    await service.record({
      turnId: TURN_ID,
      rating: 'down',
      reason: 'off_target',
      question: '问句',
      llmConfig: { apiKey: 'sk-should-never-be-stored' },
      context: {
        external: true,
        llmConfig: { apiKey: 'sk-should-never-be-stored' },
      },
    });
    const row = captured.values ?? {};
    expect(JSON.stringify(row)).not.toContain('sk-should-never-be-stored');
    expect(Object.keys(row.context as object)).toEqual([
      'external',
      'truncated',
      'stopped',
      'deep',
      'historyTurns',
      'snippetLens',
      'model',
      'usage',
    ]);
  });

  it('差评缺 question → 400（无原始问题无法归因）', async () => {
    const { service } = makeService();
    await expect(
      service.record({ turnId: TURN_ID, rating: 'down', reason: 'wrong' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('非法 rating / turnId → 400', async () => {
    const { service } = makeService();
    await expect(
      service.record({ turnId: TURN_ID, rating: 'meh' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.record({ turnId: '短', rating: 'up' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('撤回评分：有行 → removed=true，无行 → 幂等 false', async () => {
    const first = makeService([TURN_ID]);
    await expect(first.service.remove(TURN_ID)).resolves.toEqual({
      removed: true,
    });
    const second = makeService([]);
    await expect(second.service.remove(TURN_ID)).resolves.toEqual({
      removed: false,
    });
  });
});
