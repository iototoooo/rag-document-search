import { beforeAll, describe, expect, it } from "vitest";
import { createChatHandler } from "@/app/api/chat/handler";
import type { AuthorizationResult } from "@/lib/auth/authorize";
import type { ChatResponse } from "@/lib/contracts/api";
import { parseTestQuestions } from "@/lib/documents/csv";
import { MockEmbeddingProvider } from "@/lib/embeddings/mock";
import { InMemoryRlsSearcher } from "@/lib/eval/memory-searcher";
import { InMemoryDocumentRepository, InMemoryFileStorage } from "@/lib/ingest/memory";
import { ingestDocument } from "@/lib/ingest/pipeline";
import { RecordingGenerator } from "@/lib/search/testing";
import { DEMO_QUESTIONS_CSV, DEMO_RESTRICTED_SOURCE, demoFiles } from "../fixtures/demo-corpus";

/**
 * 統合テスト（外部通信なし）:
 *   架空の文書（tests/fixtures/demo-corpus.ts）→ 取り込みパイプライン（モック Embedding・インメモリ DB）
 *   → RLS を模した検索 → POST /api/chat ハンドラー → 出典
 * 情報機器取扱規程（doc3）は部署限定（department）として取り込み、一般ユーザーから見えないことを確認する。
 */

const RESTRICTED_SOURCE = DEMO_RESTRICTED_SOURCE;

const authorized: AuthorizationResult = { ok: true, user: { id: "u1", email: "u1@example.com" } };

function post(question: string) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question }),
  });
}

describe("RAG 統合フロー（架空の文書・モック）", () => {
  const embedder = new MockEmbeddingProvider(1536);
  const repo = new InMemoryDocumentRepository();
  const storage = new InMemoryFileStorage();
  let restrictedContent: string[] = [];

  beforeAll(async () => {
    for (const { fileName, data } of demoFiles()) {
      const visibility = fileName.startsWith(RESTRICTED_SOURCE) ? "department" : "internal";
      const r = await ingestDocument({ fileName, data, visibility }, { embedder, repo, storage });
      expect(r.status).toBe("ingested");
    }
    restrictedContent = repo.chunksOf(RESTRICTED_SOURCE).map((c) => c.content);
    expect(restrictedContent.length).toBeGreaterThan(0);
  });

  function makeHandler(
    generator: RecordingGenerator,
    auth: AuthorizationResult = authorized,
  ) {
    return createChatHandler<object>({
      getSupabase: async () => ({}),
      authorize: async () => auth,
      createEmbedder: () => embedder,
      createSearcher: () => new InMemoryRlsSearcher(repo),
      createGenerator: () => generator,
      getRagConfig: () => ({ threshold: 0, count: 6 }),
    });
  }

  it("再取り込みは重複登録しない", async () => {
    const before = repo.chunks.size;
    const { fileName, data } = demoFiles()[0];
    const r = await ingestDocument(
      { fileName, data, visibility: "internal" },
      { embedder, repo, storage },
    );
    expect(r.status).toBe("skipped");
    expect(repo.chunks.size).toBe(before);
  });

  it("質問 → 検索 → 回答で、実在するファイル名・ページ番号の出典が付く", async () => {
    const gen = new RecordingGenerator("cite-first");
    const res = await makeHandler(gen)(post("出張の宿泊費の上限はいくらですか？"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ChatResponse;
    expect(body.found).toBe(true);
    expect(body.citations).toHaveLength(1);
    const c = body.citations[0];
    const doc = [...repo.documents.values()].find((d) => d.id === c.documentId)!;
    expect(doc.fileName).toBe(c.fileName);
    // Markdown はページの概念がないため 1 ページ扱い
    expect(c.pageNumber).toBe(1);
    // 出典の抜粋は取り込んだチャンク本文に由来する（抜粋は空白を 1 つにまとめているため空白を除いて比較）
    const squash = (s: string) => s.replace(/\s+/g, "");
    const head = squash(c.snippet).slice(0, 20);
    expect(repo.chunksOf(doc.sourceKey).some((ch) => squash(ch.content).startsWith(head))).toBe(true);
  });

  it("部署限定文書は検索・LLM 入力・レスポンスのいずれにも現れない", async () => {
    const gen = new RecordingGenerator("cite-first");
    const handler = makeHandler(gen);
    const res = await handler(post("PCを紛失したら何時間以内に報告しますか？"));
    expect(res.status).toBe(200);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(RESTRICTED_SOURCE);

    const restrictedDocId = repo.documents.get(RESTRICTED_SOURCE)!.id;
    expect(text).not.toContain(restrictedDocId);
    for (const input of gen.inputs) {
      for (const s of input.sources) {
        expect(s.fileName).not.toContain(RESTRICTED_SOURCE);
        expect(restrictedContent).not.toContain(s.content);
      }
    }
  });

  it("未認証では検索も LLM も実行されない", async () => {
    const gen = new RecordingGenerator("cite-first");
    const res = await makeHandler(gen, { ok: false, code: "UNAUTHENTICATED" })(post("出張の日当は？"));
    expect(res.status).toBe(401);
    expect(gen.inputs).toHaveLength(0);
  });

  it("LLM が根拠なしと判断した質問は「該当する情報が見つかりません」", async () => {
    const gen = new RecordingGenerator("not-found");
    const res = await makeHandler(gen)(post("社宅の家賃補助はありますか？"));
    const body = (await res.json()) as ChatResponse;
    expect(body).toEqual({ answer: "該当する情報が見つかりません", found: false, citations: [] });
  });

  it("テスト質問（該当あり）の多くで、正しい出典文書が検索上位に入る（モック Embedding での下限確認）", async () => {
    const questions = parseTestQuestions(DEMO_QUESTIONS_CSV).filter(
      (q) => q.kind === "該当あり" && !q.sourceDocument.includes(RESTRICTED_SOURCE),
    );
    expect(questions.length).toBe(4);

    const searcher = new InMemoryRlsSearcher(repo);
    let hits = 0;
    for (const q of questions) {
      const [vec] = await embedder.embed([q.question]);
      const rows = await searcher.search(vec, { threshold: 0, count: 6 });
      const expected = q.sourceDocument.split("/").map((s) => s.trim());
      if (rows.some((r) => expected.some((e) => r.fileName.startsWith(e)))) hits++;
    }
    // 実 Embedding ではより高精度になる想定。ここでは配線の健全性として 7 割以上を下限にする
    expect(hits / questions.length).toBeGreaterThanOrEqual(0.7);
  });
});
