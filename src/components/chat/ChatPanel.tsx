"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { QUESTION_MAX_LENGTH, type ChatResponse } from "@/lib/contracts/api";
import {
  canSubmitQuestion,
  parseChatApiResponse,
  questionLength,
  type ChatApiResult,
} from "@/lib/ui/chat-api";
import { shouldSubmitOnKeyDown } from "@/lib/ui/keyboard";
import { AnswerView } from "./AnswerView";

type Turn = {
  id: number;
  question: string;
  status: "pending" | "done" | "error";
  response?: ChatResponse;
  error?: { message: string; requiresLogin: boolean };
};

async function postQuestion(question: string, signal: AbortSignal): Promise<ChatApiResult> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ question }),
      signal,
    });
    return parseChatApiResponse(res.status, await res.text());
  } catch {
    return {
      kind: "error",
      code: "UPSTREAM_UNAVAILABLE",
      message: "通信に失敗しました。ネットワーク接続を確認して再度お試しください。",
      requiresLogin: false,
    };
  }
}

/**
 * チャット画面。会話履歴はこのコンポーネントの state のみに保持する（保存しない）。
 */
export function ChatPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const nextId = useRef(1);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputId = useId();
  const counterId = useId();

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns]);

  const length = questionLength(input);
  const overLimit = length > QUESTION_MAX_LENGTH;
  const canSend = !sending && canSubmitQuestion(input, QUESTION_MAX_LENGTH);

  const submit = useCallback(async () => {
    if (sending || !canSubmitQuestion(input, QUESTION_MAX_LENGTH)) return;
    const question = input.trim();
    const id = nextId.current++;
    setSending(true);
    setInput("");
    setTurns((prev) => [...prev, { id, question, status: "pending" }]);

    const controller = new AbortController();
    abortRef.current = controller;
    const result = await postQuestion(question, controller.signal);
    if (controller.signal.aborted) return;

    setTurns((prev) =>
      prev.map((t) =>
        t.id !== id
          ? t
          : result.kind === "ok"
            ? { ...t, status: "done", response: result.data }
            : {
                ...t,
                status: "error",
                error: { message: result.message, requiresLogin: result.requiresLogin },
              },
      ),
    );
    setSending(false);
  }, [input, sending]);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void submit();
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      shouldSubmitOnKeyDown({
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.nativeEvent.keyCode,
      })
    ) {
      e.preventDefault();
      void submit();
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <section
        aria-label="会話"
        aria-live="polite"
        aria-busy={sending}
        className="flex flex-1 flex-col gap-6 py-6"
      >
        {turns.length === 0 && (
          <div className="py-10 text-center text-sm text-zinc-500">
            <p className="mb-2 text-base font-semibold text-zinc-700 dark:text-zinc-300">
              社内規程・マニュアルについて質問してください
            </p>
            <p>知りたい内容を、具体的な言葉で入力してください。</p>
            <p className="mt-4 text-xs">
              回答は登録済みの社内文書のみを根拠に生成されます。重要な判断の前には出典を確認してください。
            </p>
          </div>
        )}
        {turns.map((turn) => (
          <article key={turn.id} className="flex flex-col gap-3">
            <div className="self-end max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-blue-600 px-4 py-2.5 text-white">
              {turn.question}
            </div>
            <div className="self-start w-full max-w-full rounded-2xl rounded-bl-sm border border-zinc-200 bg-zinc-50 px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
              {turn.status === "pending" && (
                <p className="flex items-center gap-2 text-sm text-zinc-500" role="status">
                  <span
                    aria-hidden
                    className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent"
                  />
                  文書を検索して回答を作成しています…
                </p>
              )}
              {turn.status === "error" && turn.error && (
                <div role="alert" className="text-sm text-red-700 dark:text-red-400">
                  <p>{turn.error.message}</p>
                  {turn.error.requiresLogin && (
                    <a href="/login" className="mt-2 inline-block font-semibold underline">
                      ログイン画面へ
                    </a>
                  )}
                </div>
              )}
              {turn.status === "done" && turn.response && <AnswerView response={turn.response} />}
            </div>
          </article>
        ))}
        <div ref={bottomRef} />
      </section>

      <form
        onSubmit={onSubmit}
        className="sticky bottom-0 -mx-4 border-t border-zinc-200 bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-zinc-800"
      >
        <label htmlFor={inputId} className="sr-only">
          質問
        </label>
        <div className="flex items-end gap-2">
          <textarea
            id={inputId}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder="質問を入力（Enterで送信、Shift+Enterで改行）"
            aria-describedby={counterId}
            aria-invalid={overLimit}
            className="max-h-40 min-h-[3rem] flex-1 resize-y rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-base text-zinc-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/30 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <button
            type="submit"
            disabled={!canSend}
            className="h-12 shrink-0 rounded-xl bg-blue-600 px-4 text-base font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? "送信中" : "送信"}
          </button>
        </div>
        <p
          id={counterId}
          className={`mt-1 text-right text-xs ${overLimit ? "text-red-600" : "text-zinc-500"}`}
        >
          {length} / {QUESTION_MAX_LENGTH}
          {overLimit && "（文字数の上限を超えています）"}
        </p>
      </form>
    </div>
  );
}
