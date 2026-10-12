import { Injectable, Logger } from '@nestjs/common';
import {
  Automation,
  BindTrigger,
  type ActionContext,
} from '@lark-apaas/nestjs-trigger';
import { EntityMentionProjectionService } from '../wiki-beta/entity-mention-projection.service';
import { BaseSyncInsightService } from './base-sync-insight.service';
import { BaseSyncService, type SyncTrigger } from './base-sync.service';

/**
 * Base 表名 → 重算动作的路由表。
 *
 * 名称来自 Base workflow 的 `raw_body` 模板（非飞书内部 ID）：文章工作台的
 * workflow 会发 `{"source":"base-change","table":"文章工作台","record_id":"..."}`，
 * 实体词典的同理。改表名时这里与 workflow 必须同步改。
 *
 * 🔴 **代码分支与 Base workflow 必须成对存在**：只加这里的分支 → 永远收不到
 * 请求（webhook 无人调）；只建 workflow 不改代码 → 落到末尾的
 * `unrecognized table` warn。加/删任一侧都要同时检查另一侧
 * （2026-09-29 教训：机制观察表此前正是「两侧全缺」，只能靠 12h 一次的 cron）。
 */
const ARTICLE_TABLE_NAME = '文章工作台';
// Phase 4（2026-10-09）语料冻结：「实体词典」「实体关系」「关联错误上报」三张
// Base 表已删除，实体行唯一来源 = PG entity_row_cache 快照；词典/关系变更的
// webhook 分支随之移除（表没了 trigger 自然消亡，代码侧不留空转分支）。
/**
 * 机制观察表。它的内容全部来自 PG 投影（机制页与 chat 检索都读 PG），
 * 而原先进站只靠 `cron1[0 10 * * *]` / `cron1[0 15 * * *]` 两次全量
 * ⇒ **Base 改了最长 12 小时才反映到前端**（2026-09-29 定位）。
 * 现补两条更快路径：`entity-resync` webhook（实时）+ 30min cron 兜底。
 *
 * ⚠️ 名称必须与 Base workflow `raw_body` 里的 `table` 字段逐字一致，
 * 也与 `insightMechanismTable()` 指向的那张表（「机制观察」）一致。
 */
const MECHANISM_TABLE_NAME = '机制观察';

/**
 * 逐层剥掉字符串化的 JSON，最多 3 层。
 *
 * 平台在传递链路中会把同一份负载在「对象 ↔ JSON 字符串」之间来回转换
 * （`execute(dto)` 里 `parameter` 是字符串，经 HTTP 反序列化后 `content`
 * 又可能是对象），所以不能假设某一层一定是对象或字符串，必须两种都吃。
 */
function coerceJson(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3 && typeof current === 'string'; depth += 1) {
    try {
      current = JSON.parse(current) as unknown;
    } catch {
      return current;
    }
  }
  return current;
}

/**
 * 从触发器上下文里取出调用方传入的请求负载。
 *
 * 平台实现（`@lark-apaas/nestjs-trigger@0.0.3`）：
 * `AutomationController.execute(dto)` → `content = JSON.stringify({ input: dto.parameter })`
 * → `AutomationService.executeAction()` → `action.handler(context)`。
 * 即 handler 的唯一入参是整个 `ActionContext`，负载在 `content.input`。
 *
 * ⚠️ 实测（2026-09-11 线上）：webhook 触发时 `input` 是平台**整体包装**过的
 * 请求对象 `{ method, url, host, path, query, headers, body, meta }`，
 * 业务负载在 `.body`，故还要过一次 `extractRequestBody`。
 */
export function parseActionInput(context?: ActionContext): unknown {
  const content = coerceJson(
    (context as { content?: unknown } | undefined)?.content,
  );
  if (content && typeof content === 'object' && 'input' in content) {
    return (content as { input?: unknown }).input ?? null;
  }
  return null;
}

/**
 * 解出平台包装结构里的业务负载。传入非包装结构时原样返回，
 * 以便同时兼容"裸请求体"与"平台包装体"两种形态。
 */
export function extractRequestBody(input: unknown): unknown {
  const value = coerceJson(input);
  if (value && typeof value === 'object' && 'body' in value) {
    return (value as { body?: unknown }).body ?? null;
  }
  return value ?? null;
}

// 定时任务：平台通过 @lark-apaas/nestjs-trigger 的 AutomationModule 发现并调度。
// 实际导出已核对 node_modules/@lark-apaas/nestjs-trigger@0.0.3：Automation / BindTrigger。
@Automation()
@Injectable()
export class BaseSyncAutomation {
  private readonly logger = new Logger(BaseSyncAutomation.name);

  constructor(
    private readonly baseSyncService: BaseSyncService,
    private readonly projection: EntityMentionProjectionService,
    // 机制观察投影：Base 改「机制观察」后立刻把全表重投影进 PG（见
    // runMechanismSyncInBackground）。同模块 provider，无循环依赖。
    private readonly insightSync: BaseSyncInsightService,
  ) {}

  /**
   * 把全量同步转后台执行，让平台触发器在 10s HTTP 超时前拿到响应。
   *
   * 🔴 平台触发器的 HTTP 层有 10s 超时，而全量同步结构性耗时 16–75s
   * （2026-09-21 线上实测：10:00 = 16–24s、15:00 = 16s、manual = 23–75s、
   * sweep = 11.5–12.9s）⇒ 即使业务成功，触发器日志也**必然**记 failed，
   * 每天累计 20+ 条噪音把真故障淹没（线上真故障 24h 仅 3 条，均为深夜
   * 平台抖动）。立即返回后平台不再误判。
   *
   * 行为不变：平台本就不 await handler，超时后任务照常跑完；区别只是
   * 「平台侧不再等」。长任务的失败仍由 `BaseSyncService.run` 自身落账
   * （`sync_run_log.status='failed'`），故这里只补一层日志兜底。
   */
  private runInBackground(trigger: SyncTrigger, label: string): void {
    void this.baseSyncService
      .run(trigger)
      .then((result) => {
        this.logger.log(`[${label}] finished status=${result.status}`);
      })
      .catch((error: unknown) => {
        this.logger.error(
          `[${label}] failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  @BindTrigger('cron1[0 10 * * *]', {
    actionName: 'BaseSyncMorning',
    actionDesc: '每日10:00同步机制观察与实体词典',
  })
  async runMorning(): Promise<void> {
    this.runInBackground('scheduled', 'base-sync-morning');
  }

  @BindTrigger('cron1[0 15 * * *]', {
    actionName: 'BaseSyncAfternoon',
    actionDesc: '每日15:00同步机制观察与实体词典',
  })
  async runAfternoon(): Promise<void> {
    this.runInBackground('scheduled', 'base-sync-afternoon');
  }

  // 手动触发：平台 webhook 自动化（名字须与平台侧 +automation-create --name 一致）。
  @BindTrigger('manual-sync', {
    actionName: 'BaseSyncManual',
    actionDesc: '手动触发同步（webhook）',
  })
  async runManual(): Promise<void> {
    this.runInBackground('manual', 'manual-sync');
  }

  /**
   * 实体匹配重算（由 Base 自动化 HTTP 节点触发）。
   *
   * 只做**定向单篇**（< 2s 可安全 await）：全量首算需 23-75s，会撞 webhook 的
   * 60s 超时 —— 平台虽不 await handler，但响应后进程若被回收会中断未完成的
   * 异步任务，所以长任务一律交给 cron 兜底（runEntityResyncSweep）。
   *
   * 按 Base 表名分流：文章工作台 → 单篇重算；实体词典 → 用缓存正文全量重算匹配
   *（词典变了但正文没变，不需要重新解析文档）。
   */
  @BindTrigger('entity-resync', {
    actionName: 'EntityResync',
    actionDesc: '实体匹配重算（webhook，Base 变更驱动）',
  })
  async runEntityResync(context?: ActionContext): Promise<void> {
    const body = extractRequestBody(parseActionInput(context)) as {
      table?: unknown;
      record_id?: unknown;
    } | null;
    const table = typeof body?.table === 'string' ? body.table.trim() : '';
    const recordId =
      typeof body?.record_id === 'string' ? body.record_id.trim() : '';
    this.logger.log(
      `[entity-resync] content=${typeof (context as { content?: unknown } | undefined)?.content} table=${JSON.stringify(table)} record_id=${JSON.stringify(recordId)}`,
    );

    if (table === ARTICLE_TABLE_NAME) {
      if (!recordId) {
        this.logger.warn(
          `[entity-resync] ${ARTICLE_TABLE_NAME} payload has no record_id; body=${JSON.stringify(body)}`,
        );
        return;
      }
      const result = await this.projection.rematchDocument(
        recordId,
        'base-change',
      );
      this.logger.log(
        `[entity-resync] ${recordId} → ${result.outcome}${result.skipped ? `(${result.skipped})` : ''} mentions=${result.mentions ?? 0}`,
      );
      return;
    }

    if (table === MECHANISM_TABLE_NAME) {
      // 机制观察全表重投影（不是单条）：机制页与 chat 检索都读 PG 投影，
      // 单条 upsert 也要走一次全表 fetch 才能拿到 `automatic_fields` 的
      // 修改时间，全量反而更简单且能顺带收敛「多行一起改」的场景。
      // fire-and-forget：110+ 次 upsert 会超平台 10s HTTP 超时。
      this.runMechanismSyncInBackground('entity-resync');
      return;
    }

    // 表名对不上：不静默吞掉 —— 静默丢会让"Base 改了但网站没动"变成不可观测的故障。
    this.logger.warn(
      `[entity-resync] unrecognized table=${JSON.stringify(body?.table ?? null)}; body=${JSON.stringify(body)}`,
    );
  }

  /** 机制同步是否在飞（跨触发器的并发闸门，见 runMechanismSyncInBackground）。 */
  private mechanismSyncInFlight = false;
  /** 在飞期间又来了新触发 ⇒ 记脏，等当前轮结束后补跑一次。 */
  private mechanismSyncPending = false;

  /**
   * 把「机制观察」全表重投影转后台执行。
   *
   * 🔴 **并发合并**：批量改 Base（如全表补一列）会让 workflow 连发 100+ 次
   * webhook，若每次都独立全表 upsert，请求会互相叠加并打爆连接池。故用
   * 「在飞 + 脏标记」把一串触发**合并成当前一次 + 一次补跑**——补跑保证
   * 最后一次变更之后的最终状态一定被投影（不会因合并而丢改动）。
   *
   * 与 `runSweepInBackground` 同款：自带 catch，fire-and-forget 不留
   * unhandled rejection；成功也必打日志（本项目「新行为必带成功日志」）。
   */
  private runMechanismSyncInBackground(label: string): void {
    if (this.mechanismSyncInFlight) {
      this.mechanismSyncPending = true;
      return;
    }
    this.mechanismSyncInFlight = true;
    void (async () => {
      try {
        const count = await this.insightSync.syncMechanismObservation();
        this.logger.log(
          `[${label}] mechanism_observation resynced: ${count} rows`,
        );
      } catch (error) {
        this.logger.error(
          `[${label}] mechanism_observation resync failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      } finally {
        this.mechanismSyncInFlight = false;
        if (this.mechanismSyncPending) {
          this.mechanismSyncPending = false;
          this.runMechanismSyncInBackground(`${label}:coalesced`);
        }
      }
    })();
  }

  // 🔴 降频（30min → 2h，2026-09-21）的完整背景，改前必读：
  // `@BindTrigger('<name>')` 的字符串是**平台侧触发器名（绑定键）**，平台靠它
  // 匹配应用注册的 handler，而**实际调度周期由平台侧 cron 字段独立决定**
  // （已核实：`apps +automation-list` 里的 name 恰为代码里 `@BindTrigger` 的字符串）。
  // 改名即断开绑定：旧名字仍按原周期触发却找不到 handler，新名字永不触发。
  //
  // 平台侧现状：
  //   · cron1[*/30 * * * *]     —— 历史触发器（name 含 `[ ] *` 特殊字符）
  //   · entity-resync-sweep-2h  —— 本次新建，0 */2 * * *（每 2 小时）
  //
  // ⚠️ lark-cli 对含特殊字符的 name **无法执行任何单触发器写操作**：
  // `+automation-get` / `+automation-update` / `+automation-disable` 一律返回
  // `API returned a non-object JSON response`（`+automation-list` 正常，因为它
  // 不把 name 放进 URL 路径；`--dry-run` 显示 URL 编码本身正确）。平台侧
  // `capabilities.can_delete: false` ⇒ 旧触发器**既改不了周期、也停不掉、也删不掉**。
  //
  // ⇒ 故保留旧 name 的绑定，**让它立即返回**（平台日志不再 failed）。它的
  // 落点现已复用为「机制观察」投影的 30min 兜底（见下方 runEntityResyncSweepLegacy）；
  // **实体提及**的兜底仍由 entity-resync-sweep-2h 承担。日后若平台/cli 支持按
  // id 操作单触发器，应先把机制兜底迁到新触发器，再禁用旧触发器。

  /**
   * 旧触发器（每 30min）的落点。
   *
   * 🔴 **装饰器里的三个值（触发名 / actionName / actionDesc）一律不许动**
   * —— 触发名是绑定键，改任意一个都可能断开平台绑定，而平台对含 `[ ] *`
   * 的 name 无法单触发器写操作（见上方长注释）⇒ 断了就再也连不回去。
   * 故 `actionDesc` 仍写着「空转」（已过时）：**描述过时是可接受的代价，
   * 断绑定不是。**
   *
   * 2026-09-29 起本落点不再是纯空转：承担「机制观察」投影的 30min 兜底。
   * 选它而不是把活挂到 `entity-resync-sweep-2h`，是因为它**每 30 分钟**就
   * 触发一次且此前完全闲置 ⇒ 零新增平台注册就拿到 30min 收敛保证（webhook
   * 漏触发时的后路）。立即返回（fire-and-forget）以避开平台 10s HTTP 超时
   * 误报 failed。
   */
  @BindTrigger('cron1[*/30 * * * *]', {
    actionName: 'EntityResyncSweepLegacy',
    actionDesc: '（空转）历史30分钟兜底触发器，业务已迁至 entity-resync-sweep-2h',
  })
  async runEntityResyncSweepLegacy(): Promise<void> {
    this.runMechanismSyncInBackground('mechanism-cron-30m');
  }

  /**
   * 实体提及投影的定时兜底与补偿：首次全量 + 事件漏触发时的收敛手段。
   *
   * 三级跳过（L0 门禁 / L1 Base 时间戳 / L2 正文 sha256）使稳态下一轮几乎零成本。
   * 降频理由：实时性已由 `entity-resync` webhook（Base 变更 → 定向单篇重算
   * <2s）覆盖，本任务只是漏触发时的兜底，2h 收敛延迟可接受。
   */
  @BindTrigger('entity-resync-sweep-2h', {
    actionName: 'EntityResyncSweep',
    actionDesc: '实体提及投影增量扫描（每2小时兜底）',
  })
  async runEntityResyncSweep(): Promise<void> {
    // 立即返回：实测 11.5–12.9s，会让平台 10s HTTP 超时误报 failed。
    void this.runSweepInBackground();
  }

  /** 后台执行体。自带 catch —— fire-and-forget 不能留 unhandled rejection。 */
  private async runSweepInBackground(): Promise<void> {
    try {
      const result = await this.projection.sweepAll();
      this.logger.log(
        `[entity-resync-sweep] scanned=${result.scanned} parsed=${result.parsed} matched=${result.matched} skipped=${result.skippedL1 + result.skippedL2} mentions=${result.mentions} ${result.durationMs}ms`,
      );
    } catch (error) {
      this.logger.error(
        `[entity-resync-sweep] failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
