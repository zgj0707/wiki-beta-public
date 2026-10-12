import { Logger } from '@nestjs/common';
import type { ActionContext } from '@lark-apaas/nestjs-trigger';
import {
  BaseSyncAutomation,
  extractRequestBody,
  parseActionInput,
} from '../../server/modules/base-sync/base-sync.automation';

/** 平台实测结构：parameter = { method, url, host, path, query, headers, body, meta } */
const envelope = {
  method: 'POST',
  url: 'https://example.com/hook',
  host: 'example.com',
  path: '/hook',
  query: {},
  headers: { Authorization: ['Bearer xxx'] },
  body: { source: 'base-change', test_table: '文章工作台', record_id: 'rec-1' },
  meta: { env: 'online' },
};

function contextWith(content: unknown): ActionContext {
  return {
    attributes: { trigger: 'entity-resync', instanceID: 'instance-1' },
    content,
  } as unknown as ActionContext;
}

describe('parseActionInput', () => {
  it('reads input when content is a JSON string (per platform source)', () => {
    const context = contextWith(JSON.stringify({ input: { record_id: 'r1' } }));
    expect(parseActionInput(context)).toEqual({ record_id: 'r1' });
  });

  it('reads input when content is already an object', () => {
    // 实测线上 content 会以对象形态抵达，JSON.parse 会抛错 → 必须兼容
    const context = contextWith({ input: { record_id: 'r2' } });
    expect(parseActionInput(context)).toEqual({ record_id: 'r2' });
  });

  it('reads input when content wraps a stringified parameter', () => {
    const context = contextWith({ input: JSON.stringify({ body: 'x' }) });
    expect(parseActionInput(context)).toBe('{"body":"x"}');
  });

  it('returns null for a missing context', () => {
    expect(parseActionInput(undefined)).toBeNull();
  });

  it('returns null when content is absent', () => {
    expect(parseActionInput(contextWith(undefined))).toBeNull();
  });

  it('returns null when content is not valid JSON', () => {
    expect(parseActionInput(contextWith('not-json'))).toBeNull();
  });

  it('returns null when input key is absent', () => {
    expect(parseActionInput(contextWith(JSON.stringify({})))).toBeNull();
  });
});

describe('extractRequestBody', () => {
  it('unwraps an object envelope and returns the business body', () => {
    expect(extractRequestBody(envelope)).toEqual({
      source: 'base-change',
      test_table: '文章工作台',
      record_id: 'rec-1',
    });
  });

  it('unwraps a stringified envelope (parameter arrives as JSON text)', () => {
    expect(extractRequestBody(JSON.stringify(envelope))).toEqual({
      source: 'base-change',
      test_table: '文章工作台',
      record_id: 'rec-1',
    });
  });

  it('passes a bare payload through unchanged', () => {
    expect(extractRequestBody({ record_id: 'rec-2' })).toEqual({
      record_id: 'rec-2',
    });
  });

  it('returns null for nullish input', () => {
    expect(extractRequestBody(undefined)).toBeNull();
    expect(extractRequestBody(null)).toBeNull();
  });

  it('returns null when the envelope carries no body', () => {
    expect(extractRequestBody({ method: 'POST', body: undefined })).toBeNull();
  });
});

describe('parseActionInput + extractRequestBody（端到端）', () => {
  it('resolves the business body for both content shapes', () => {
    const both = [
      contextWith(JSON.stringify({ input: envelope })),
      contextWith({ input: envelope }),
      contextWith({ input: JSON.stringify(envelope) }),
    ];

    for (const context of both) {
      expect(extractRequestBody(parseActionInput(context))).toEqual({
        source: 'base-change',
        test_table: '文章工作台',
        record_id: 'rec-1',
      });
    }
  });
});

// ---------------------------------------------------------------------------
// 机制观察（2026-09-29）：Base 改「机制观察」→ PG 重投影的触发路由与并发合并
// ---------------------------------------------------------------------------

/** 把「平台包装过的请求」做成 entity-resync 收到的形态。 */
function resyncContext(table: string, recordId = 'rec-1'): ActionContext {
  return contextWith({
    input: { method: 'POST', body: { source: 'base-change', table, record_id: recordId } },
  });
}

/** 冲掉若干轮 microtask + 宏任务，让 fire-and-forget 的后台体跑完。 */
async function flush(times = 3): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function buildAutomation(syncMechanismObservation: jest.Mock) {
  const baseSyncService = { run: jest.fn() };
  const projection = {
    rematchDocument: jest.fn(),
    rematchAllFromCache: jest.fn(),
    rematchForReportChange: jest.fn(),
  };
  const automation = new BaseSyncAutomation(
    baseSyncService as never,
    projection as never,
    { syncMechanismObservation } as never,
  );
  return { automation, baseSyncService, projection };
}

describe('runEntityResync → 机制观察分支', () => {
  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Nest Logger 直写 stdout，必须 spy 原型方法才能断言
    logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('table=机制观察 时触发机制投影重算，且不误判为未识别表', async () => {
    const syncMechanismObservation = jest.fn().mockResolvedValue(110);
    const { automation } = buildAutomation(syncMechanismObservation);

    await automation.runEntityResync(resyncContext('机制观察'));
    await flush();

    expect(syncMechanismObservation).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('unrecognized table'),
    );
    expect(
      logSpy.mock.calls.some((call) =>
        String(call[0]).includes('mechanism_observation resynced: 110 rows'),
      ),
    ).toBe(true);
  });

  it('未识别的表名仍走 warn，且不触发机制重算（防静默吞掉）', async () => {
    const syncMechanismObservation = jest.fn().mockResolvedValue(1);
    const { automation } = buildAutomation(syncMechanismObservation);

    await automation.runEntityResync(resyncContext('某张新表'));
    await flush();

    expect(syncMechanismObservation).not.toHaveBeenCalled();
    expect(
      warnSpy.mock.calls.some((call) =>
        String(call[0]).includes('unrecognized table'),
      ),
    ).toBe(true);
  });

  it('文章工作台 分支不受影响（机制同步零调用）', async () => {
    const syncMechanismObservation = jest.fn().mockResolvedValue(1);
    const { automation, projection } = buildAutomation(syncMechanismObservation);
    projection.rematchDocument.mockResolvedValue({ outcome: 'ok', mentions: 2 });

    await automation.runEntityResync(resyncContext('文章工作台'));
    await flush();

    expect(projection.rematchDocument).toHaveBeenCalledWith('rec-1', 'base-change');
    expect(syncMechanismObservation).not.toHaveBeenCalled();
  });

  it('批量改 Base 连发 webhook 时合并：在飞期间只记脏，结束后补跑一次', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const syncMechanismObservation = jest.fn().mockImplementation(async () => {
      await gate;
      return 110;
    });
    const { automation } = buildAutomation(syncMechanismObservation);

    // 连发 5 次（模拟批量改 5 行）→ 只允许 1 次真正在飞
    for (let i = 0; i < 5; i += 1) {
      await automation.runEntityResync(resyncContext('机制观察', `rec-${i}`));
    }
    expect(syncMechanismObservation).toHaveBeenCalledTimes(1);

    release?.();
    await flush();

    // 合并成「当前 1 次 + 补跑 1 次」，而不是 5 次
    expect(syncMechanismObservation).toHaveBeenCalledTimes(2);
    expect(
      logSpy.mock.calls.some((call) =>
        String(call[0]).includes('mechanism_observation resynced'),
      ),
    ).toBe(true);
  });

  it('30min cron 落点也走同一条机制同步路径（兜底）', async () => {
    const syncMechanismObservation = jest.fn().mockResolvedValue(110);
    const { automation } = buildAutomation(syncMechanismObservation);

    automation.runEntityResyncSweepLegacy();
    await flush();

    expect(syncMechanismObservation).toHaveBeenCalledTimes(1);
  });
});
