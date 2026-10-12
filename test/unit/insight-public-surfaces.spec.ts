import { Logger } from '@nestjs/common';
import { InsightService } from '../../server/modules/insight/insight.service';

describe('InsightService public Base-backed surfaces', () => {
  // researchCoverage 的用例已随 Phase 4 语料冻结下线（2026-10-09）：
  // Base 实体三表删除、/research/coverage 孤儿端点移除、实体行唯一来源 =
  // entity_row_cache（见 entity-mention-projection.service loadEntities）。

  it('maps Base field descriptions onto the two score sort keys', async () => {
    const baseReader = {
      listMechanismFieldDescriptions: jest.fn().mockResolvedValue({
        市场认可指数: '市场认可度说明',
        核心创新指数: '拆解价值说明',
      }),
    };
    const service = new InsightService({} as any, baseReader as any);

    await expect(service.mechanismScoreHints()).resolves.toEqual({
      market: '市场认可度说明',
      innovation: '拆解价值说明',
    });
  });

  it('returns null for a score key whose description is absent in Base', async () => {
    // Base 里只给一个指数写了描述是合法状态（另一个照常排序，只是没提示）
    const baseReader = {
      listMechanismFieldDescriptions: jest.fn().mockResolvedValue({
        市场认可指数: '市场认可度说明',
      }),
    };
    const service = new InsightService({} as any, baseReader as any);

    await expect(service.mechanismScoreHints()).resolves.toEqual({
      market: '市场认可度说明',
      innovation: null,
    });
  });

  it('degrades to null hints instead of throwing when Base is unreachable', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const baseReader = {
      listMechanismFieldDescriptions: jest
        .fn()
        .mockRejectedValue(new Error('base unreachable')),
    };
    const service = new InsightService({} as any, baseReader as any);

    // 悬停提示是附加信息，拿不到也不能让接口失败
    await expect(service.mechanismScoreHints()).resolves.toEqual({
      market: null,
      innovation: null,
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
