import { Module } from '@nestjs/common';
import { FeishuCredentialService } from '../../common/feishu/feishu-credential.service';
import { FeishuDocumentReader } from './document-reader.service';
import { EntityMentionProjectionService } from './entity-mention-projection.service';
import { FeishuBaseReader } from './feishu-base-reader.service';
import { FeishuSheetsReader } from './feishu-sheets-reader.service';
import { RankingBoardController } from './ranking-board.controller';
import { RankingBoardService } from './ranking-board.service';
import { QuickToolsController } from './quick-tools.controller';
import { QuickToolsService } from './quick-tools.service';

// 公开内容通过本模块提供的只读 Feishu 文档、Base 表读取器和投影服务统一消费。
// 提及投影服务放在本模块（而非 BaseSyncModule）是为了避免模块循环：它只依赖两个
// 读取器；反过来 BaseSyncModule 引入本模块即可拿到它做事件/定时重算。
// v2 动线重设计（2026-10-09）：面向用户的实体浏览/关联 UI 与错误上报、关系候选
// 推导整体下线（docs/nav-tasks-redesign-plan.md §3）；FeishuBaseEntityService /
// EntityLinkReport* / EntityRelationCandidateService 已删除。实体数据继续经
// EntityMentionProjection 写入 PG（entity_doc_cache / entity_mention），作为
// chatbot 检索与实体召回的底座（用户不可见）。
@Module({
  controllers: [
    RankingBoardController,
    // QuickToolsController（/api/quick-tools 列表 + /attachment/:recordId 附件
    // HTML 字节代理）必须注册——过 tsc 不代表会被加载，漏注册会在首个附件行上
    // 404（lint 曾报而未修）。
    QuickToolsController,
  ],
  providers: [
    FeishuCredentialService,
    FeishuDocumentReader,
    FeishuBaseReader,
    FeishuSheetsReader,
    EntityMentionProjectionService,
    RankingBoardService,
    QuickToolsService,
  ],
  exports: [
    FeishuDocumentReader,
    FeishuBaseReader,
    FeishuSheetsReader,
    EntityMentionProjectionService,
    // chat 榜单检索源（nav-tasks-p3b）复用榜单板块服务（meta + 按期正文）。
    RankingBoardService,
    // chat 公开站内内容检索复用已启用工具清单和 HTML 附件只读服务。
    QuickToolsService,
  ],
})
export class WikiBetaModule {}
