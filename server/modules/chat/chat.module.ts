import { Module } from '@nestjs/common';

import { ArticlesModule } from '../articles/articles.module';
import { InsightModule } from '../insight/insight.module';
import { WikiBetaModule } from '../wiki-beta/wiki-beta.module';
import { AiConfigService } from './ai-config.service';
import { ChatAdminController } from './chat-admin.controller';
import { ChatAdminService } from './chat-admin.service';
import { ChatController } from './chat.controller';
import { ChatFeedbackService } from './chat-feedback.service';
import { ChatIntentService } from './chat-intent.service';
import { ChatIpUsageService } from './chat-ip-usage.service';
import { ChatLlmProvider } from './chat-llm.provider';
import { ChatMechanismSource } from './chat-mechanism-source';
import { ChatRankingSource } from './chat-ranking-source';
import { ChatRetrieverService } from './chat-retriever.service';
import { ChatSiteContentSource } from './chat-site-content-source';
import { ChatService } from './chat.service';

// 站内读者问答：检索语料 = 已批准文章 + 已发布机制观察 + 榜单 + 站内公开文本与目录，
// LLM 走 OpenAI 兼容网关。
// 反馈落库（bad case 采集）见 design/chat-badcase-plan.md。
// DRIZZLE_DATABASE 由平台全局提供，无需额外 import。
// WikiBetaModule：FeishuBaseReader（「AI 配置」表直读，站点默认 LLM 配置）
// + RankingBoardService（榜单检索源）+ QuickToolsService（已启用发现内容）。
// InsightModule：复用机制观察页的公开指数口径说明。
// ArticlesModule：ArticlesService（玩法分类枚举，意图识别品类词表）。
// ChatIntentService + ChatRankingSource：预置问答路径（nav-tasks-p3b）。
// ChatAdminController：监控台管理面（密码哈希 + 签名 Cookie，站点其余零登录）。
@Module({
  imports: [WikiBetaModule, ArticlesModule, InsightModule],
  controllers: [ChatController, ChatAdminController],
  providers: [
    ChatService,
    ChatRetrieverService,
    ChatSiteContentSource,
    ChatMechanismSource,
    ChatRankingSource,
    ChatIntentService,
    ChatLlmProvider,
    ChatFeedbackService,
    AiConfigService,
    ChatIpUsageService,
    ChatAdminService,
  ],
})
export class ChatModule {}
