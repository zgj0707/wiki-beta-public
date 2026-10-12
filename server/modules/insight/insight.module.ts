import { Module } from '@nestjs/common';
import { WikiBetaModule } from '../wiki-beta/wiki-beta.module';
import { InsightController } from './insight.controller';
import { InsightService } from './insight.service';
import { MechanismFiguresController } from './mechanism-figures.controller';

@Module({
  imports: [WikiBetaModule],
  controllers: [InsightController, MechanismFiguresController],
  providers: [InsightService],
  exports: [InsightService],
})
export class InsightModule {}
