import { Module } from '@nestjs/common';
import { FeishuCredentialService } from '../../common/feishu/feishu-credential.service';
import { WikiBetaModule } from '../wiki-beta/wiki-beta.module';
import {
  ArticleCoverMediaController,
  ArticleImagesController,
} from './article-images.controller';
import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';

@Module({
  imports: [WikiBetaModule],
  controllers: [
    ArticlesController,
    ArticleImagesController,
    ArticleCoverMediaController,
  ],
  providers: [ArticlesService, FeishuCredentialService],
  exports: [ArticlesService],
})
export class ArticlesModule {}
