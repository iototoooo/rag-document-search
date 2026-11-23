import { documentFileUrl, type ChatResponse } from "@/lib/contracts/api";
import { splitAnswerWithCitations } from "@/lib/ui/chat-api";

/**
 * 回答と出典の表示。本文は React のテキストとして描画し、HTML としては解釈しない。
 * 出典リンクは PDF 配信 API（認証・閲覧権限を確認する）を新しいタブで開く。
 */
export function AnswerView({ response }: { response: ChatResponse }) {
  if (!response.found) {
    return (
      <div className="text-sm">
        <p className="font-semibold">{response.answer}</p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">
          登録されている社内文書に、この質問への根拠となる記載が見つかりませんでした。質問の表現を変えるか、担当部署に確認してください。
        </p>
      </div>
    );
  }

  const ids = response.citations.map((c) => c.id);
  const segments = splitAnswerWithCitations(response.answer, ids);

  return (
    <div className="flex flex-col gap-3">
      <p className="whitespace-pre-wrap break-words leading-relaxed">
        {segments.map((s, i) =>
          s.type === "text" ? (
            <span key={i}>{s.text}</span>
          ) : (
            <sup
              key={i}
              className="mx-0.5 text-xs font-semibold text-blue-700 dark:text-blue-400"
              aria-label={`出典${s.id}`}
            >
              [{s.id}]
            </sup>
          ),
        )}
      </p>

      {response.citations.length > 0 && (
        <div>
          <h3 className="mb-1 text-xs font-semibold text-zinc-500">出典</h3>
          <ol className="flex flex-col gap-2">
            {response.citations.map((c) => (
              <li key={`${c.id}-${c.chunkId}`}>
                <a
                  href={documentFileUrl(c.documentId, c.pageNumber)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm hover:border-blue-500 dark:border-zinc-700 dark:bg-zinc-950"
                >
                  <span className="font-semibold text-blue-700 dark:text-blue-400">[{c.id}]</span>{" "}
                  <span className="break-all font-medium">{c.fileName}</span>
                  <span className="ml-1 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                    p.{c.pageNumber}
                  </span>
                  {c.section && (
                    <span className="block text-xs text-zinc-600 dark:text-zinc-400">{c.section}</span>
                  )}
                  {c.snippet && (
                    <span className="mt-1 line-clamp-3 block text-xs text-zinc-500">{c.snippet}</span>
                  )}
                  <span className="mt-1 block text-xs text-blue-700 dark:text-blue-400">
                    PDFの該当ページを開く ↗
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
