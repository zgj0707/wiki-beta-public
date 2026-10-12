import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { BusinessException } from '../interfaces/exception.interface';
import {
  HTTP_STATUS_TO_RESPONSE_CODE_MAP,
  ResponseCode,
} from '../constants/api_response_code';
import { ApiErrorResponse } from '../interfaces/api_response.interface';

// 全局异常过滤器，用于捕获所有未处理的异常
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // 如果响应头已发送，则不处理
    if (response.headersSent) {
      return;
    }

    let errorResponse: Omit<ApiErrorResponse, 'httpStatus'>;
    let httpStatus: HttpStatus;

    if (exception instanceof BusinessException) {
      // 业务异常
      httpStatus = exception.httpStatus;
      errorResponse = {
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details,
          fieldErrors: exception.fieldErrors,
          timestamp: Date.now(),
        },
      };
    } else if (exception instanceof HttpException) {
      // HTTP异常
      httpStatus = exception.getStatus() as HttpStatus;
      const exceptionResponse = exception.getResponse();
      const responseBody =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? (exceptionResponse as {
              message?: unknown;
              fieldErrors?: Record<string, string[]>;
            })
          : undefined;
      const responseMessage = Array.isArray(responseBody?.message)
        ? responseBody.message.join('；')
        : typeof responseBody?.message === 'string'
          ? responseBody.message
          : typeof exceptionResponse === 'string'
            ? exceptionResponse
            : exception.message;

      errorResponse = {
        error: {
          code: HTTP_STATUS_TO_RESPONSE_CODE_MAP[httpStatus],
          message: responseMessage,
          details:
            typeof exceptionResponse === 'object'
              ? JSON.stringify(exceptionResponse)
              : undefined,
          ...(responseBody?.fieldErrors
            ? { fieldErrors: responseBody.fieldErrors }
            : {}),
          timestamp: Date.now(),
        },
      };
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: unknown }).code === '42501'
    ) {
      // PostgreSQL insufficient_privilege：通常是业务表 RLS / policy 配置错误，属于服务端配置问题。
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = {
        error: {
          code: ResponseCode.INTERNAL_ERROR,
          message: '数据库写入权限未配置，请联系管理员',
          timestamp: Date.now(),
        },
      };
    } else if (
      typeof exception === 'object' &&
      exception !== null &&
      (exception as { code?: unknown }).code === '22P02'
    ) {
      // Postgres invalid_text_representation：路径/查询参数与列类型不匹配（最常见是非法 UUID）
      // 与「合法 UUID 但记录不存在」走同一条 not-found 语义，避免 500 噪声
      httpStatus = HttpStatus.NOT_FOUND;
      errorResponse = {
        error: {
          code: ResponseCode.NOT_FOUND,
          message: '资源不存在',
          timestamp: Date.now(),
        },
      };
    } else {
      // 未知异常
      httpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
      errorResponse = {
        error: {
          code: ResponseCode.INTERNAL_ERROR,
          message: '服务器内部错误',
          stack: (exception as Error).stack,
          cause: (exception as Error).cause as string,
          timestamp: Date.now(),
        },
      };
    }

    response.status(httpStatus).json(errorResponse);
  }
}
