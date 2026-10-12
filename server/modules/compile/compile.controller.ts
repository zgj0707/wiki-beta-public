import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import type {
  CompileCalibrationView,
  CompilePrepareRequest,
  CompilePrepareResult,
  CompileQueueItem,
  CompileSaveRequest,
  CompileSaveResult,
  CompileUnitDetail,
  CompileWorkbenchView,
} from '@shared/ai-compile';

import { CompileService } from './compile.service';

/**
 * AI 编译层接口。全部挂在 `api/compile` 下，与既有面零交叉。
 *
 * 注意：服务端**不调 LLM**（后端出网被沙箱拦）。调用方拿 prepare 的 messages
 * 自己调模型，再回传 save。因此这里没有流式、没有超时管理、没有 Key 处理。
 */
@Controller('api/compile')
export class CompileController {
  private readonly logger = new Logger(CompileController.name);

  constructor(private readonly compileService: CompileService) {}

  /** 工作台：本周结论变化 + 队列 + 校准 + 统计（0 次 LLM 调用）。 */
  @Get('workbench')
  workbench(
    @Query('model') model?: string,
    @Query('limit') limit?: string,
  ): Promise<CompileWorkbenchView> {
    return this.compileService.workbench(
      model,
      limit ? Number(limit) : undefined,
    );
  }

  /** 待编译队列（只含「产品」类型实体）。 */
  @Get('queue')
  queue(@Query('limit') limit?: string): Promise<CompileQueueItem[]> {
    return this.compileService.queue(limit ? Number(limit) : undefined);
  }

  /** 校准视图（按模型分区）。 */
  @Get('calibration')
  calibration(@Query('model') model?: string): Promise<CompileCalibrationView> {
    return this.compileService.calibration(model);
  }

  /** 结论卡详情。`slug` 即实体 Base record_id。 */
  @Get('unit/:slug')
  unit(
    @Param('slug') slug: string,
    @Query('model') model?: string,
  ): Promise<CompileUnitDetail | null> {
    return this.compileService.getUnit(slug, model);
  }

  /**
   * 组装编译输入（含 prompt messages 与编号表）。
   * ⚠️ 编号表 `sources` 必须原样交给 save —— 它是引用校验的白名单，不是展示数据。
   */
  @Post('prepare')
  prepare(@Body() body: CompilePrepareRequest): Promise<CompilePrepareResult> {
    return this.compileService.prepare(body);
  }

  /** 回填编译产物。只接受模型原始输出 + 实测 usage，其余由服务端重算与校验。 */
  @Post('save')
  async save(@Body() body: CompileSaveRequest): Promise<CompileSaveResult> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('请求体不能为空');
    }
    const result = await this.compileService.save(body);
    if (!result.ok) {
      // 失败是预期路径（输入变更 / 解析失败 / 引用全越界），用 warn 而非 error。
      this.logger.warn(
        `compile save failed: subject=${body.subjectId} model=${body.modelFingerprint} reason=${result.reason}`,
      );
    }
    return result;
  }
}
