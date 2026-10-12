import { Module } from '@nestjs/common';

import { CompileController } from './compile.controller';
import { CompileService } from './compile.service';

// AI 编译层：把实体的全部关联文章编译成「结论 + 证据 + 未知项」并落 PG 共享缓存。
// LLM 调用方在服务端之外（浏览器 BYO-Key / WorkBuddy 批跑），本模块只做
// 「组装输入 + 校验产物 + 落库」。DRIZZLE_DATABASE 由平台全局提供，无需额外 import。
//
// ⚠️ 注册到 AppModule 才算生效（tsc 通过 ≠ 会被加载）。改完 grep 校验：
//   grep -rn "CompileModule" server/
@Module({
  controllers: [CompileController],
  providers: [CompileService],
})
export class CompileModule {}
