import { Module } from '@nestjs/common';
import { AutomationModule } from '@lark-apaas/nestjs-trigger';
import { FeishuCredentialService } from '../../common/feishu/feishu-credential.service';
import { WikiBetaModule } from '../wiki-beta/wiki-beta.module';
import { BaseSyncAutomation } from './base-sync.automation';
import { BaseSyncInsightService } from './base-sync-insight.service';
import { BaseSyncService } from './base-sync.service';

@Module({
  // WikiBetaModule 提供实体提及投影服务：事件触发（entity-resync）与定时兜底
  // （entity-resync-sweep）都在本模块的自动化里调用它。
  imports: [AutomationModule.forRoot(), WikiBetaModule],
  providers: [
    FeishuCredentialService,
    BaseSyncService,
    BaseSyncInsightService,
    BaseSyncAutomation,
  ],
  exports: [FeishuCredentialService, BaseSyncService, BaseSyncInsightService],
})
export class BaseSyncModule {}
