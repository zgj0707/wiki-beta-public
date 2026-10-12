import { Logger } from '@nestjs/common';
import { FeishuBaseReader } from '@server/modules/wiki-beta/feishu-base-reader.service';

/**
 * 附件下载的并发与重试行为（2026-09-20 线上故障的回归锁）。
 *
 * 线上现象：机制观察列表一屏 34 个图标并发请求，同一秒内 26 个 200 + 8 个 404 交错，
 * 而 Base 侧这 8 个 key 的附件 token 唯一、size 正常 ⇒ 附件没坏，是下载阶段瞬时失败
 * 被 `fetchAttachment` 静默吞成 null，最终变成「Icon is not available」。
 * 这里锁住修复后的四条行为：重试能救回瞬时失败、重试耗尽仍返回 null 而非抛错、
 * 并发被闸门限制、失败原因被日志带出。
 */
function makeReader(): FeishuBaseReader {
  const documentReader = {
    getTenantAccessToken: jest.fn(async () => ({ token: 'test-token' })),
  };
  return new FeishuBaseReader(documentReader as never);
}

function pngResponse(): Response {
  return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
    status: 200,
    headers: { 'content-type': 'image/png' },
  });
}

function failResponse(status = 500): Response {
  return new Response(null, { status });
}

const ARGS = ['recTest', 'tokTest1234567890', 'fldEXAMPLEICON00001', 'tblEXAMPLEMECHANISM01'];

describe('downloadAttachment 并发闸门与重试', () => {
  const realFetch = global.fetch;
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Nest 的 Logger.warn 走 stdout，不经 console.warn；必须挂在 Logger 原型上才能捕获。
    warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    global.fetch = realFetch;
    warnSpy.mockRestore();
    jest.restoreAllMocks();
  });

  it('首轮全失败、次轮成功时能取回字节（瞬时失败被重试救回）', async () => {
    // 每轮两次请求（先带 extra、再直连）：attempt1 两连败 → attempt2 首次成功。
    const sequence = [failResponse(500), failResponse(500), pngResponse()];
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      calls.push(String(url));
      return sequence.shift() ?? failResponse();
    }) as unknown as typeof fetch;

    const reader = makeReader();
    const result = await reader.downloadAttachment(...(ARGS as [string, string, string, string]));

    expect(result).not.toBeNull();
    expect(result?.contentType).toBe('image/png');
    expect(result?.data.byteLength).toBe(8);
    expect(calls).toHaveLength(3);
    // 顺序契约：带 extra 优先，失败才回退直连（序反了等于每次都白付一次往返）。
    expect(calls[0]).toContain('extra=');
    expect(calls[1]).not.toContain('extra=');
    expect(calls[2]).toContain('extra=');
  });

  it('重试耗尽后返回 null（不抛错，也不返回半个响应）', async () => {
    const calls: string[] = [];
    global.fetch = jest.fn(async (url: string) => {
      calls.push(String(url));
      return failResponse(429);
    }) as unknown as typeof fetch;

    const reader = makeReader();
    const result = await reader.downloadAttachment(...(ARGS as [string, string, string, string]));

    expect(result).toBeNull();
    // 3 轮 × (extra + 直连) = 6 次请求，且每轮都留下带状态码的告警。
    expect(calls).toHaveLength(6);
    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(String(warnSpy.mock.calls[0][0])).toContain('http-429');
    expect(String(warnSpy.mock.calls[0][0])).toContain('tokTest1');
  }, 10_000);

  it('并发请求被闸门限制（同刻在飞不超过 8 次下载）', async () => {
    let inFlight = 0;
    let peak = 0;
    global.fetch = jest.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 15));
      inFlight -= 1;
      return pngResponse();
    }) as unknown as typeof fetch;

    const reader = makeReader();
    await Promise.all(
      Array.from({ length: 30 }, () =>
        reader.downloadAttachment(...(ARGS as [string, string, string, string])),
      ),
    );

    expect(peak).toBeLessThanOrEqual(8);
    expect(peak).toBeGreaterThan(1);
  }, 15_000);

  it('拿不到租户令牌时直接返回 null 并留下告警，不发任何请求', async () => {
    const documentReader = {
      getTenantAccessToken: jest.fn(async () => ({ token: '' })),
    };
    const reader = new FeishuBaseReader(documentReader as never);
    const fetchSpy = jest.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await reader.downloadAttachment(...(ARGS as [string, string, string, string]));

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toContain('no tenant access token');
  });
});
