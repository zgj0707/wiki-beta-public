import { useCallback, useRef, useState } from 'react';

import { COMPILE_MAX_OUTPUT_TOKENS } from '@shared/ai-compile';

import {
  callCompileLlm,
  modelFingerprintOf,
  prepareCompile,
  saveCompile,
} from '@client/src/api/ai-compile';
import {
  isChatLlmConfigured,
  loadChatLlmConfig,
} from '@client/src/lib/chat-llm-config';

/**
 * 浏览器侧编译执行器：prepare → 直连网关 LLM → save。
 *
 * 只替换"LLM 调用方"这一步是刻意的设计——WorkBuddy 批跑走完全相同的
 * prepare/save 两端，中间换成脚本调模型。因此这里任何逻辑改动都要同步
 * 反映到 scripts/compile-batch.mjs，否则两条通道行为会分叉。
 */

export type CompileStep = 'prepare' | 'llm' | 'save' | 'done';

export interface CompileRunState {
  running: boolean;
  subjectId: string | null;
  step: CompileStep | null;
  message: string | null;
  error: string | null;
  needsConfig: boolean;
}

const INITIAL: CompileRunState = {
  running: false,
  subjectId: null,
  step: null,
  message: null,
  error: null,
  needsConfig: false,
};

export function useCompileRunner() {
  const [state, setState] = useState<CompileRunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState((prev) => ({ ...prev, running: false, step: null }));
  }, []);

  const run = useCallback(
    async (subjectId: string): Promise<boolean> => {
      const config = loadChatLlmConfig();
      if (!isChatLlmConfigured(config)) {
        setState({ ...INITIAL, needsConfig: true });
        return false;
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const fingerprint = modelFingerprintOf(config.model);
      setState({
        running: true,
        subjectId,
        step: 'prepare',
        message: '组装输入…',
        error: null,
        needsConfig: false,
      });
      try {
        const prepared = await prepareCompile(subjectId, fingerprint);
        if (prepared.overBudget) {
          throw new Error(
            `输入超过硬顶（预估 ${prepared.estTokensLow}–${prepared.estTokensHigh} tokens），已跳过`,
          );
        }
        setState((prev) => ({
          ...prev,
          step: 'llm',
          message: `调用模型（${prepared.usedDocCount}/${prepared.docCount} 篇，预估 ${prepared.estTokensLow}–${prepared.estTokensHigh} tokens）…`,
        }));
        const llm = await callCompileLlm(
          config,
          prepared.messages,
          controller.signal,
        );
        setState((prev) => ({ ...prev, step: 'save', message: '校验并落库…' }));
        const saved = await saveCompile({
          subjectId,
          inputHash: prepared.inputHash,
          modelFingerprint: fingerprint,
          raw: llm.raw,
          usage: llm.usage,
          // 失败诊断必需：只有它能把"预算不够"和"格式不对"分开，而两者处理方式相反。
          finishReason: llm.finishReason,
          generatedBy: 'web',
          source: 'browser',
        });
        if (!saved.ok) {
          // 截断会让 JSON 不完整 → parse_failed。若只说「输出不是合法 JSON」，
          // 使用者会去查 prompt 而查不到真正原因（预算不够）。
          const reason = describeReason(saved.reason);
          const alreadyNoted = reason.includes('截断');
          throw new Error(
            llm.finishReason === 'length' && !alreadyNoted
              ? `落库被拒：${reason} —— 模型输出已被 max_tokens=${COMPILE_MAX_OUTPUT_TOKENS} 截断`
              : `落库被拒：${reason}`,
          );
        }
        // usage 由网关回传，缺省为 0（部分通道不回传）。不显示 0，避免把
        // 「这条通道没回传」表达成「消耗为 0」。
        const usageNote =
          llm.usage.promptTokens > 0
            ? ` · 实测 ${llm.usage.promptTokens} in / ${llm.usage.completionTokens} out`
            : ' · 用量未回传';
        setState((prev) => ({
          ...prev,
          running: false,
          step: 'done',
          message: `已编译：${saved.claimsKept} 条结论${
            saved.claimsDropped ? `（丢弃 ${saved.claimsDropped} 条越界引用）` : ''
          } · 置信度 ${saved.confidence}${usageNote}`,
        }));
        return true;
      } catch (error) {
        const aborted =
          error instanceof DOMException && error.name === 'AbortError';
        setState({
          running: false,
          subjectId,
          step: null,
          message: null,
          error: aborted ? '已取消' : describeError(error),
          needsConfig: false,
        });
        return false;
      } finally {
        abortRef.current = null;
      }
    },
    [],
  );

  return { state, run, cancel };
}

const REASON_TEXT: Record<string, string> = {
  input_changed: '输入已变化（正文或日期有更新），请重新编译',
  no_valid_claim: '没有任何结论通过引用校验（模型可能引用了不存在的资料编号）',
  no_sources: '该主体没有可用关联资料',
  empty_raw: '模型返回为空',
  model_fingerprint_required: '缺少模型标识',
  unit_upsert_failed: '落库失败',
};

export function describeReason(reason?: string): string {
  if (!reason) return '未知原因';
  if (reason.startsWith('parse_failed')) {
    return `输出不是合法 JSON（${reason.replace('parse_failed: ', '')}）`;
  }
  return REASON_TEXT[reason] ?? reason;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
