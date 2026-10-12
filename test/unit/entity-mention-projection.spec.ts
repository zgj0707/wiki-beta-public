import { getTableName } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createHash } from 'node:crypto';
import {
  EntityMentionProjectionService,
  buildTerms,
  disabledMentionIndexes,
  draftMentions,
  evidenceAround,
  toParseStatus,
} from '../../server/modules/wiki-beta/entity-mention-projection.service';

const sha256 = (value: string) =>
  createHash('sha256').update(value, 'utf8').digest('hex');

const article = (overrides: Record<string, unknown> = {}) => ({
  baseRecordId: 'rec-a1',
  title: '文章 A',
  appDocId: 'doc-a1',
  docLink: 'https://example.feishu.cn/docx/docaaaaa',
  approvalStatus: '已批准',
  sourceDateFeishu: '2026-09-01',
  updateTime: new Date('2026-09-10T00:00:00Z'),
  ...overrides,
});

const entity = (
  baseRecordId: string,
  name: string,
  overrides: Record<string, unknown> = {},
) => ({
  baseRecordId,
  name,
  normalizedName: name,
  aliases: [],
  type: '产品',
  description: '',
  status: '启用',
  updateTime: null,
  ...overrides,
});

interface FakeState {
  articles?: unknown[];
  entities?: unknown[];
  relations?: unknown[];
  cacheRows?: unknown[];
  mentionRows?: unknown[];
  countRows?: unknown[];
  rowCacheRows?: unknown[];
  relationCacheRows?: unknown[];
}

/** 只实现本服务用到的 select / insert / update 链，并记录每次调用。 */
function makeDb(state: FakeState) {
  const calls: Array<{ op: string; table?: string; [key: string]: unknown }> =
    [];
  const pick = (table: string, cols?: Record<string, unknown>) => {
    if (table === 'entity_doc_cache') return state.cacheRows ?? [];
    if (table === 'entity_mention') {
      return cols && 'value' in cols
        ? (state.countRows ?? [])
        : (state.mentionRows ?? []);
    }
    if (table === 'entity_row_cache') return state.rowCacheRows ?? [];
    if (table === 'entity_relation_cache')
      return state.relationCacheRows ?? [];
    return [];
  };
  const rows = (getRows: () => unknown[]): any => ({
    limit: () => rows(getRows),
    orderBy: () => rows(getRows),
    groupBy: () => rows(getRows),
    then: (resolve: any, reject?: any) =>
      Promise.resolve(getRows()).then(resolve, reject),
  });
  const db = {
    select: (cols?: Record<string, unknown>) => ({
      from: (table: any) => {
        const name = getTableName(table);
        calls.push({ op: 'select', table: name, cols });
        const get = () => pick(name, cols);
        const chain: any = {
          where: (cond?: unknown) => {
            calls.push({ op: 'selectWhere', table: name, cond });
            return rows(get);
          },
          orderBy: () => rows(get),
          then: (resolve: any, reject?: any) =>
            Promise.resolve(get()).then(resolve, reject),
        };
        chain.innerJoin = (target: any, cond: unknown) => {
          calls.push({
            op: 'innerJoin',
            table: name,
            target: getTableName(target),
            cond,
          });
          return chain;
        };
        return chain;
      },
    }),
    insert: (table: any) => ({
      values: (values: unknown) => {
        const name = getTableName(table);
        calls.push({ op: 'insert', table: name, values });
        return {
          onConflictDoUpdate: (config: unknown) => {
            calls.push({ op: 'upsert', table: name, config });
            return Promise.resolve(undefined);
          },
        };
      },
    }),
    update: (table: any) => ({
      set: (values: unknown) => {
        const name = getTableName(table);
        calls.push({ op: 'updateSet', table: name, values });
        return {
          where: (cond: unknown) => {
            calls.push({ op: 'updateWhere', table: name, cond });
            return Promise.resolve(undefined);
          },
        };
      },
    }),
    delete: (table: any) => {
      const name = getTableName(table);
      calls.push({ op: 'delete', table: name });
      const result: any = {
        where: (cond: unknown) => {
          calls.push({ op: 'deleteWhere', table: name, cond });
          return Promise.resolve(undefined);
        },
      };
      // 无 where 的 delete 直接被 await：保持 thenable。
      result.then = (
        resolve: (v: undefined) => unknown,
        reject?: (e: unknown) => unknown,
      ) => Promise.resolve(undefined).then(resolve, reject);
      return result;
    },
  };
  return { db, calls };
}

function makeService(state: FakeState, documents: unknown[] = [], reports?: {
  listDisabledLinks: jest.Mock;
}) {
  // Phase 4 语料冻结：服务从 PG entity_row_cache 快照读实体行（snapshotCached），
  // 不再消费 reader.listEntityRows —— state.entities 在此派生为快照行。
  const rowCacheRows =
    state.rowCacheRows ??
    (state.entities ?? []).map((raw) => {
      const e = raw as Record<string, unknown>;
      const updateTime = e.updateTime;
      return {
        baseRecordId: e.baseRecordId,
        name: e.name,
        status: e.status,
        row: {
          ...e,
          updateTime:
            updateTime instanceof Date ? updateTime.toISOString() : updateTime ?? null,
        },
      };
    });
  const { db, calls } = makeDb({ ...state, rowCacheRows });
  const reader = {
    listArticleRows: jest.fn().mockResolvedValue(state.articles ?? []),
    listEntityRows: jest.fn().mockResolvedValue(state.entities ?? []),
    listRelationRows: jest.fn().mockResolvedValue(state.relations ?? []),
  };
  const documentReader = {
    readArticle: jest.fn().mockImplementation(async () => {
      const next = documents.shift();
      return next ?? { status: 'unavailable', body: null };
    }),
  };
  const service = new EntityMentionProjectionService(
    db as never,
    reader as never,
    documentReader as never,
    reports as never,
  );
  return { service, calls, reader, documentReader };
}

const dialect = new PgDialect();
const queryOf = (cond: unknown) => dialect.sqlToQuery(cond as never);
const findCall = (calls: any[], op: string, table: string) =>
  calls.find((call) => call.op === op && call.table === table);

describe('提及投影的纯函数', () => {
  it('把正文读取结果映射为三值 parse_status', () => {
    expect(toParseStatus({ status: 'ready', body: '正文' })).toEqual({
      parseStatus: 'ready',
      body: '正文',
      parseError: null,
    });
    // 链接失效 / docx 无内容：飞书应答了但没有可匹配正文 → empty
    expect(toParseStatus({ status: 'invalid_response', body: null })).toEqual({
      parseStatus: 'empty',
      body: '',
      parseError: 'invalid_response',
    });
    expect(toParseStatus({ status: 'ready', body: null }).parseStatus).toBe(
      'empty',
    );
    // 凭证/网络问题属临时态 → unavailable，历史提及不得被打掉
    expect(toParseStatus({ status: 'unavailable', body: null }).parseStatus).toBe(
      'unavailable',
    );
    expect(
      toParseStatus({ status: 'not_configured', body: null }).parseStatus,
    ).toBe('unavailable');
  });

  it('取命中处上下文并折行', () => {
    // 折行（含连续换行）折叠为单个空格
    expect(evidenceAround('前\n\n中', 3, 4)).toBe('前 中');
    // 前后窗口都覆盖到全文时原样返回
    const body = `${'甲'.repeat(10)}原神${'乙'.repeat(20)}`;
    expect(evidenceAround(body, 10, 12)).toBe(body);
    // 命中后仍有超长尾巴时按 后窗口 100 + 命中宽度 截断
    expect(evidenceAround('乙'.repeat(300), 0, 2)).toBe('乙'.repeat(102));
  });

  it('词表只收启用实体的、长度 ≥ 2 的、去重后的名称与别名', () => {
    const terms = buildTerms([
      entity('e1', '原神', { aliases: ['原神', 'Genshin'] }),
      entity('e2', '停用项', { status: '停用' }),
      entity('e3', 'A'),
    ]);

    expect(terms).toEqual([
      { entityId: 'e1', term: '原神' },
      { entityId: 'e1', term: 'Genshin' },
    ]);
  });

  it('按 (实体, 词) 累计 1-based 出现序号', () => {
    const drafts = draftMentions('原神 与 原神', [
      { entityId: 'e1', term: '原神' },
    ]);

    expect(drafts.map((draft) => draft.occurrenceIndex)).toEqual([1, 2]);
    expect(drafts.every((draft) => draft.entityId === 'e1')).toBe(true);
    expect(drafts.every((draft) => draft.evidenceText.includes('原神'))).toBe(
      true,
    );
  });
});

describe('EntityMentionProjectionService 单篇重算', () => {
  it('未知 docId 直接返回 unknown-doc，不读正文', async () => {
    const { service, documentReader } = makeService({
      articles: [article()],
      entities: [entity('e1', '原神')],
    });

    await expect(service.rematchDocument('rec-nope', 'test')).resolves.toEqual({
      docId: 'rec-nope',
      outcome: 'unknown-doc',
    });
    expect(documentReader.readArticle).not.toHaveBeenCalled();
  });

  it('掉出门禁的篇目清掉其 active 投影，且只动 dictionary_match 行', async () => {
    const { service, calls } = makeService({
      articles: [article({ approvalStatus: '待审核' })],
      entities: [entity('e1', '原神')],
    });

    await expect(service.rematchDocument('rec-a1', 'test')).resolves.toEqual({
      docId: 'rec-a1',
      outcome: 'not-approved',
    });

    const update = findCall(calls, 'updateWhere', 'entity_mention');
    expect(update).toBeDefined();
    const { sql, params } = queryOf(update!.cond);
    expect(sql).toContain('"doc_id" =');
    expect(params).toContain('rec-a1');
    expect(params).toContain('dictionary_match');
    expect(params).toContain('active');
  });

  it('L1 命中（Base 时间戳未变）时零正文读取', async () => {
    const { service, documentReader } = makeService({
      articles: [article()],
      entities: [entity('e1', '原神')],
      cacheRows: [
        {
          docId: 'rec-a1',
          bodyMarkdown: '原神',
          contentHash: sha256('原神'),
          parseStatus: 'ready',
          baseUpdatedAt: new Date('2026-09-10T00:00:00Z'),
        },
      ],
    });

    await expect(service.rematchDocument('rec-a1', 'test')).resolves.toEqual({
      docId: 'rec-a1',
      outcome: 'skipped',
      skipped: 'l1',
    });
    expect(documentReader.readArticle).not.toHaveBeenCalled();
  });

  it('meta 同步幂等：缓存 meta 与 Base 行一致时不产生 UPDATE（零写放大）', async () => {
    const { service, calls, documentReader } = makeService({
      articles: [article()],
      entities: [entity('e1', '原神')],
      cacheRows: [
        {
          docId: 'rec-a1',
          bodyMarkdown: '原神',
          contentHash: sha256('原神'),
          parseStatus: 'ready',
          baseUpdatedAt: new Date('2026-09-10T00:00:00Z'),
          title: '文章 A',
          sourceDate: '2026-09-01',
          docLink: 'https://example.feishu.cn/docx/docaaaaa',
          approvalStatus: '已批准',
        },
      ],
    });

    await service.rematchDocument('rec-a1', 'test');

    expect(documentReader.readArticle).not.toHaveBeenCalled();
    expect(findCall(calls, 'updateWhere', 'entity_doc_cache')).toBeUndefined();
  });

  it('meta 同步：缓存 meta 与 Base 行任一不同时执行一次轻量 UPDATE 回填', async () => {
    const { service, calls } = makeService({
      articles: [article()],
      entities: [entity('e1', '原神')],
      cacheRows: [
        {
          docId: 'rec-a1',
          bodyMarkdown: '原神',
          contentHash: sha256('原神'),
          parseStatus: 'ready',
          baseUpdatedAt: new Date('2026-09-10T00:00:00Z'),
          // 标题已改：与 Base 行不一致，应触发回填
          title: '旧标题',
          sourceDate: '2026-09-01',
          docLink: 'https://example.feishu.cn/docx/docaaaaa',
          approvalStatus: '已批准',
        },
      ],
    });

    await service.rematchDocument('rec-a1', 'test');

    const updates = calls.filter(
      (call) => call.op === 'updateSet' && call.table === 'entity_doc_cache',
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({
      title: '文章 A',
      sourceDate: '2026-09-01',
      docLink: 'https://example.feishu.cn/docx/docaaaaa',
      approvalStatus: '已批准',
    });
    const cond = queryOf(
      findCall(calls, 'updateWhere', 'entity_doc_cache')!.cond,
    );
    expect(cond.sql).toContain('"doc_id" =');
    expect(cond.params).toContain('rec-a1');
  });

  it('meta 同步：缓存行缺失时不写（该 doc 由完整 upsert 路径补全 meta）', async () => {
    const { service, calls } = makeService(
      { articles: [article()], entities: [entity('e1', '原神')], cacheRows: [] },
      [{ status: 'unavailable', body: null }],
    );

    await expect(
      service.rematchDocument('rec-a1', 'test'),
    ).resolves.toMatchObject({ outcome: 'unavailable' });

    expect(findCall(calls, 'updateWhere', 'entity_doc_cache')).toBeUndefined();
    const upsert = findCall(calls, 'upsert', 'entity_doc_cache')!
      .config as any;
    expect(upsert.set.title).toBe('文章 A');
    expect(upsert.set.sourceDate).toBe('2026-09-01');
    expect(upsert.set.docLink).toBe('https://example.feishu.cn/docx/docaaaaa');
    expect(upsert.set.approvalStatus).toBe('已批准');
  });

  it('L2 命中（Base 被碰过但正文未变）只刷新时间戳，不重算匹配', async () => {
    const { service, calls, documentReader } = makeService(
      {
        articles: [article()],
        entities: [entity('e1', '原神')],
        cacheRows: [
          {
            docId: 'rec-a1',
            bodyMarkdown: '原神',
            contentHash: sha256('原神'),
            parseStatus: 'ready',
            baseUpdatedAt: new Date('2026-09-01T00:00:00Z'),
          },
        ],
      },
      [{ status: 'ready', body: '原神' }],
    );

    await expect(service.rematchDocument('rec-a1', 'test')).resolves.toEqual({
      docId: 'rec-a1',
      outcome: 'skipped',
      skipped: 'l2',
    });
    expect(documentReader.readArticle).toHaveBeenCalledTimes(1);
    expect(findCall(calls, 'insert', 'entity_mention')).toBeUndefined();
    expect(
      (findCall(calls, 'upsert', 'entity_doc_cache')!.config as any).set
        .parseStatus,
    ).toBe('ready');
  });

  it('正文变化时写投影：正文缓存 + 命中行 upsert + 陈旧行置 inactive', async () => {
    const { service, calls } = makeService(
      {
        articles: [article()],
        entities: [entity('e1', '原神')],
        cacheRows: [],
      },
      [{ status: 'ready', body: '原神 与 原神' }],
    );

    await expect(service.rematchDocument('rec-a1', 'test')).resolves.toEqual({
      docId: 'rec-a1',
      outcome: 'matched',
      mentions: 2,
    });

    const inserted = findCall(calls, 'insert', 'entity_mention')!
      .values as Array<Record<string, unknown>>;
    expect(inserted).toHaveLength(2);
    expect(inserted.map((row) => row.occurrenceIndex)).toEqual([1, 2]);
    expect(inserted.map((row) => row.entityTerm)).toEqual(['原神', '原神']);
    expect(inserted.every((row) => row.status === 'active')).toBe(true);
    expect(inserted.every((row) => row.sourceField === 'dictionary_match')).toBe(
      true,
    );

    const upsert = findCall(calls, 'upsert', 'entity_mention')!.config as any;
    expect(upsert.target).toHaveLength(4);
    // status 改由 excluded.status 透传（active / disabled 混写一批）
    expect(JSON.stringify(upsert.set.status)).toContain('excluded.status');
  });

  it('正文为空的篇目：缓存记 empty 且历史提及置 inactive', async () => {
    const { service, calls } = makeService(
      { articles: [article()], entities: [entity('e1', '原神')] },
      [{ status: 'invalid_response', body: null }],
    );

    await expect(service.rematchDocument('rec-a1', 'test')).resolves.toEqual({
      docId: 'rec-a1',
      outcome: 'empty',
    });

    const cache = findCall(calls, 'upsert', 'entity_doc_cache')!.config as any;
    expect(cache.set.parseStatus).toBe('empty');
    expect(cache.set.bodyMarkdown).toBe('');
    expect(findCall(calls, 'updateWhere', 'entity_mention')).toBeDefined();
  });

  it('正文读不到的篇目：记 unavailable 且保留历史提及', async () => {
    const { service, calls } = makeService(
      { articles: [article()], entities: [entity('e1', '原神')] },
      [{ status: 'unavailable', body: null }],
    );

    await expect(service.rematchDocument('rec-a1', 'test')).resolves.toEqual({
      docId: 'rec-a1',
      outcome: 'unavailable',
    });

    const cache = findCall(calls, 'upsert', 'entity_doc_cache')!.config as any;
    expect(cache.set.parseStatus).toBe('unavailable');
    // 抖动被固化是最坏结果：不得在这条路径上打掉历史提及
    expect(findCall(calls, 'updateWhere', 'entity_mention')).toBeUndefined();
  });

  it('未装配计算服务时按 unavailable 处理而不是抛错', async () => {
    const { db } = makeDb({ articles: [article()], entities: [] });
    const reader = {
      listArticleRows: jest.fn().mockResolvedValue([article()]),
      listEntityRows: jest.fn().mockResolvedValue([]),
    };
    const service = new EntityMentionProjectionService(
      db as never,
      reader as never,
    );

    await expect(service.rematchDocument('rec-a1', 'test')).resolves.toMatchObject(
      { outcome: 'unavailable' },
    );
  });
});

describe('EntityMentionProjectionService 读取侧', () => {
  it('无缓存行返回 null（交给实时兜底），非 ready 返回空数组', async () => {
    const none = makeService({ cacheRows: [], mentionRows: [] });
    await expect(none.service.mentionsForDocument('rec-a1')).resolves.toBeNull();

    const empty = makeService({
      cacheRows: [{ docId: 'rec-a1', parseStatus: 'empty' }],
      mentionRows: [{ entityId: 'e1', term: '原神', occurrenceIndex: 1 }],
    });
    await expect(empty.service.mentionsForDocument('rec-a1')).resolves.toEqual(
      [],
    );

    const ready = makeService({
      cacheRows: [{ docId: 'rec-a1', parseStatus: 'ready' }],
      mentionRows: [
        {
          entityId: 'e1',
          term: '原神',
          occurrenceIndex: 1,
          evidenceText: 'x',
          status: 'active',
        },
      ],
    });
    await expect(ready.service.mentionsForDocument('rec-a1')).resolves.toEqual([
      { entityId: 'e1', term: '原神', occurrenceIndex: 1, evidenceText: 'x' },
    ]);
  });

  it('计数按去重后的文章篇数聚合，且只统计已批准文章', async () => {
    const { service, calls } = makeService({
      articles: [article(), article({ baseRecordId: 'rec-a2', approvalStatus: '待审核' })],
      countRows: [{ entityId: 'e1', value: 3 }],
    });

    const counts = await service.countsByEntity();
    expect(counts.get('e1')).toBe(3);

    const where = queryOf(findCall(calls, 'selectWhere', 'entity_mention')!.cond);
    expect(where.params).toContain('active');
    expect(where.params).toContain('rec-a1');
    expect(where.params).not.toContain('rec-a2');
  });

  it('关联文章按篇去重、按日期倒序、meta 随缓存行带出（纯 PG 读取）', async () => {
    const { service, reader } = makeService({
      mentionRows: [
        {
          docId: 'rec-a1',
          occurrenceIndex: 1,
          evidenceText: '一次',
          title: '文章 A',
          sourceDate: '2026-09-01',
          docLink: 'https://example.feishu.cn/docx/docaaaaa',
        },
        {
          docId: 'rec-a1',
          occurrenceIndex: 4,
          evidenceText: '四次',
          title: '文章 A',
          sourceDate: '2026-09-01',
          docLink: 'https://example.feishu.cn/docx/docaaaaa',
        },
        {
          docId: 'rec-a2',
          occurrenceIndex: 2,
          evidenceText: '二次',
          title: null,
          sourceDate: '2026-09-05',
          docLink: null,
        },
      ],
    });

    const links = await service.articlesForEntity('e1');
    expect(links.map((item) => item.docId)).toEqual(['rec-a2', 'rec-a1']);
    // 同一篇取最早一次出现的证据
    expect(links[1].evidenceText).toBe('一次');
    expect(links[1].occurrenceIndex).toBe(1);
    // title 为 null 回退 docId；无值的 sourceDate/docLink 不携带
    expect(links[0].title).toBe('rec-a2');
    expect(links[0].sourceUrl).toBeUndefined();
    expect(links[0].sourceDate).toBe('2026-09-05');
    expect(links[1].sourceUrl).toBe('https://example.feishu.cn/docx/docaaaaa');
    // 纯 PG 读取：不再拉 Base 全表
    expect(reader.listArticleRows).not.toHaveBeenCalled();
  });

  it('articlesForEntity 的 PG 查询：联 entity_doc_cache 且过滤 active + 已批准', async () => {
    const { service, calls, reader } = makeService({ mentionRows: [] });

    await service.articlesForEntity('e1');

    const join = findCall(calls, 'innerJoin', 'entity_mention');
    expect(join).toBeDefined();
    expect(join!.target).toBe('entity_doc_cache');
    expect(queryOf(join!.cond).sql).toContain('"doc_id"');

    const where = queryOf(
      findCall(calls, 'selectWhere', 'entity_mention')!.cond,
    );
    expect(where.sql).toContain('"entity_id" =');
    expect(where.sql).toContain('"status" =');
    expect(where.sql).toContain('"approval_status" =');
    expect(where.params).toEqual(
      expect.arrayContaining(['e1', 'active', '已批准']),
    );
    expect(reader.listArticleRows).not.toHaveBeenCalled();
  });

  it('articlesForEntity：PG 抛错时降级回 Base 全表路径', async () => {
    const { db } = makeDb({
      mentionRows: [
        { docId: 'rec-a1', occurrenceIndex: 1, evidenceText: '一次' },
      ],
    });
    const reader = {
      listArticleRows: jest.fn().mockResolvedValue([article()]),
      listEntityRows: jest.fn().mockResolvedValue([]),
    };
    let selectCalls = 0;
    const failingDb = {
      ...db,
      select: (cols?: Record<string, unknown>) => {
        selectCalls += 1;
        // 第一次（PG 联表路径）抛错，降级后的第二次调用放行
        if (selectCalls === 1) throw new Error('pg down');
        return db.select(cols);
      },
    };
    const service = new EntityMentionProjectionService(
      failingDb as never,
      reader as never,
    );

    const links = await service.articlesForEntity('e1');
    expect(links.map((item) => item.docId)).toEqual(['rec-a1']);
    expect(links[0].title).toBe('文章 A');
    expect(links[0].sourceDate).toBe('2026-09-01');
    expect(reader.listArticleRows).toHaveBeenCalledTimes(1);
  });
});

describe('实体/关系快照（P2a2）', () => {
  const cachedEntityRow = (baseRecordId: string, updateTime: string | null) => ({
    baseRecordId,
    name: '原神',
    status: '启用',
    row: {
      baseRecordId,
      name: '原神',
      normalizedName: '原神',
      aliases: [],
      type: '产品',
      description: '',
      status: '启用',
      updateTime,
    },
  });

  it('snapshotCached：entity_row_cache 空 = 快照未构建，返回 null', async () => {
    const { service } = makeService({ rowCacheRows: [] });
    await expect(service.snapshotCached()).resolves.toBeNull();
  });

  it('snapshotCached：返回完整行且 revive updateTime 为 Date', async () => {
    const { service } = makeService({
      rowCacheRows: [cachedEntityRow('e1', '2026-09-01T00:00:00.000Z')],
      relationCacheRows: [
        {
          baseRecordId: 'r1',
          row: {
            baseRecordId: 'r1',
            subjectEntityRecordIds: ['e1'],
            objectEntityRecordIds: [],
            relationType: '母项目',
            status: '启用',
            sourceMode: 'manual',
            evidenceArticleRecordIds: [],
            evidenceText: '',
            evidenceAnchor: '',
            reviewNote: '',
            updateTime: null,
          },
        },
      ],
    });

    const snap = await service.snapshotCached();
    expect(snap).not.toBeNull();
    expect(snap!.entities[0]).toEqual({
      baseRecordId: 'e1',
      name: '原神',
      normalizedName: '原神',
      aliases: [],
      type: '产品',
      description: '',
      status: '启用',
      updateTime: new Date('2026-09-01T00:00:00.000Z'),
    });
    expect(snap!.entities[0].updateTime).toBeInstanceOf(Date);
    expect(snap!.relations[0].relationType).toBe('母项目');
    // jsonb 里 updateTime 为 null 时 revive 回 null 而不是 Date
    expect(snap!.relations[0].updateTime).toBeNull();
  });

  it('snapshotCached：PG 抛错返回 null（调用方按零实体兜底）', async () => {
    const { db } = makeDb({});
    const reader = {
      listArticleRows: jest.fn(),
      listEntityRows: jest.fn(),
      listRelationRows: jest.fn(),
    };
    const failingDb = {
      ...db,
      select: () => {
        throw new Error('pg down');
      },
    };
    const service = new EntityMentionProjectionService(
      failingDb as never,
      reader as never,
    );

    await expect(service.snapshotCached()).resolves.toBeNull();
  });

  it('approvedDocIds：返回 meta 快照中已批准文章的 doc_id 集合', async () => {
    const { service, calls } = makeService({
      cacheRows: [{ docId: 'rec-a1' }, { docId: 'rec-a2' }, { docId: 'rec-a3' }],
    });

    await expect(service.approvedDocIds()).resolves.toEqual([
      'rec-a1',
      'rec-a2',
      'rec-a3',
    ]);

    const where = queryOf(findCall(calls, 'selectWhere', 'entity_doc_cache')!.cond);
    // '已批准' 字面量与 publication-policy.ts 的 isApprovedArticle 同源
    expect(where.params).toContain('已批准');
  });

  it('approvedDocIds：PG 抛错返回 null（调用方回退）', async () => {
    const { db } = makeDb({});
    const reader = {
      listArticleRows: jest.fn(),
      listEntityRows: jest.fn(),
      listRelationRows: jest.fn(),
    };
    const failingDb = {
      ...db,
      select: () => {
        throw new Error('pg down');
      },
    };
    const service = new EntityMentionProjectionService(
      failingDb as never,
      reader as never,
    );

    await expect(service.approvedDocIds()).resolves.toBeNull();
  });
});
