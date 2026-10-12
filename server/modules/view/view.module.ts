import { Module } from '@nestjs/common';
import { ArticlesModule } from '../articles/articles.module';
import { WikiBetaModule } from '../wiki-beta/wiki-beta.module';
import { ViewController } from './view.controller';

// SSR 首屏注入复用 ArticlesModule 的公开列表语义（ArticlesService 已被 exports）。
@Module({
  imports: [ArticlesModule, WikiBetaModule],
  controllers: [ViewController],
})
export class ViewModule {}
