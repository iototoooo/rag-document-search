import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDryRunDeps,
  DEFAULT_INPUT_DIR,
  formatSummary,
  listPdfFiles,
  parseCliArgs,
  runIngest,
} from "./cli";

describe("parseCliArgs", () => {
  it("既定はドライラン・samples/pdf", () => {
    expect(parseCliArgs([])).toEqual({ execute: false, dir: DEFAULT_INPUT_DIR });
  });
  it("--execute と --dir を解釈する", () => {
    expect(parseCliArgs(["--execute", "--dir", "x"])).toEqual({ execute: true, dir: "x" });
    expect(parseCliArgs(["--dir=y"])).toEqual({ execute: false, dir: "y" });
  });
  it("不明な引数・値なしはエラー", () => {
    expect(() => parseCliArgs(["--force"])).toThrow(/不明/);
    expect(() => parseCliArgs(["--dir"])).toThrow();
    expect(() => parseCliArgs(["--dir", "--execute"])).toThrow();
  });
});

describe("listPdfFiles / runIngest", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("直下の PDF のみを名前順に返す", () => {
    dir = mkdtempSync(path.join(tmpdir(), "ingest-"));
    writeFileSync(path.join(dir, "b.pdf"), "x");
    writeFileSync(path.join(dir, "a.PDF"), "x");
    writeFileSync(path.join(dir, "c.md"), "x");
    mkdirSync(path.join(dir, "sub.pdf"));
    expect(listPdfFiles(dir).map((f) => path.basename(f))).toEqual(["a.PDF", "b.pdf"]);
  });

  it("壊れた PDF はエラー行になり、他のファイルの処理は続く（本文はログに出さない）", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "ingest-"));
    writeFileSync(path.join(dir, "broken.pdf"), "not a pdf");
    const rows = await runIngest(listPdfFiles(dir), createDryRunDeps());
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("error");
    expect(rows[0].error).toBeTruthy();
    expect(formatSummary(rows)).toContain("1 errors");
  });
});
