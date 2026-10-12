import { APP_FILTER } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PlatformModule } from '@lark-apaas/fullstack-nestjs-core';

import { GlobalExceptionFilter } from './common/filters/exception.filter';
import { ArticlesModule } from './modules/articles/articles.module';
import { BaseSyncModule } from './modules/base-sync/base-sync.module';
import { ChatModule } from './modules/chat/chat.module';
import { CompileModule } from './modules/compile/compile.module';
import { InsightModule } from './modules/insight/insight.module';
import { ViewModule } from './modules/view/view.module';
import { WikiBetaModule } from './modules/wiki-beta/wiki-beta.module';

@Module({
  imports: [
    // 平台 Module，提供平台能力
    PlatformModule.forRoot(),
    // ====== @route-section: business-modules START ======
    WikiBetaModule,
    BaseSyncModule,
    ArticlesModule,
    InsightModule,
    ChatModule,
    CompileModule,
    // Place all business modules here.Do NOT add fallback modules here.
    // ====== @route-section: business-modules END ======

    // ⚠️ @route-order: last
    // ViewModule is the fallback route module, must be registered last.
    ViewModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
  ],
})
export class AppModule {}
