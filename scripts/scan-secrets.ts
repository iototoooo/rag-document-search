/**
 * 秘密情報の混入確認（外部通信なし・値は表示しない）
 *
 *   npm run scan:secrets          # Git 管理下のファイル + ビルド済みのブラウザ向けファイル（.next/static）
 *
 * - .env.local の秘密の値（service_role・OpenAI・Anthropic・検証用パスワード）がそのまま含まれていないか
 * - 秘密キーらしい形式（sb_secret_ / sk-ant- / sk-proj- / service_role の JWT）がないか
 * 見つかった場合はファイル名と種類だけを表示し、終了コード 1。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { detectSupabaseKeyKind } from "@/lib/config/env-check";

const SECRET_KEYS = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "VERIFY_USER_PASSWORD",
  "VERIFY_UNREGISTERED_PASSWORD",
] as const;

const PATTERNS: Array<[string, RegExp]> = [
  ["Supabase Secret key 形式", /sb_secret_[A-Za-z0-9_-]{10,}/],
  ["Anthropic キー形式", /sk-ant-[A-Za-z0-9_-]{10,}/],
  ["OpenAI キー形式", /sk-(proj-)?[A-Za-z0-9_-]{30,}/],
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

const secrets: Record<string, string> = {};
try {
  process.loadEnvFile(".env.local");
} catch {
  // .env.local がなければ形式チェックのみ
}
for (const k of SECRET_KEYS) {
  const v = (process.env[k] ?? "").trim();
  if (v.length >= 8) secrets[k] = v;
}

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean)
  .filter((f) => existsSync(f));
const bundle = existsSync(path.join(".next", "static")) ? walk(path.join(".next", "static")) : [];
const targets: Array<[string, string]> = [
  ...tracked.map((f) => ["Git 管理下", f] as [string, string]),
  ...bundle.map((f) => ["ブラウザ向けビルド", f] as [string, string]),
];

const findings: string[] = [];
for (const [where, file] of targets) {
  let text: string;
  try {
    if (statSync(file).size > 5_000_000) continue;
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [k, v] of Object.entries(secrets)) {
    if (text.includes(v)) findings.push(`${where}: ${file} に ${k} の値が含まれています`);
  }
  for (const [label, re] of PATTERNS) {
    if (re.test(text)) findings.push(`${where}: ${file} に ${label} の文字列があります`);
  }
  for (const m of text.match(JWT) ?? []) {
    if (detectSupabaseKeyKind(m) === "jwt-service_role") {
      findings.push(`${where}: ${file} に service_role の JWT があります`);
    }
  }
}

console.log(`検査: Git 管理下 ${tracked.length} ファイル / ブラウザ向けビルド ${bundle.length} ファイル${bundle.length ? "" : "（未ビルドのため対象なし）"}`);
console.log(`照合した秘密の値: ${Object.keys(secrets).join(", ") || "なし"}`);
if (findings.length) {
  for (const f of [...new Set(findings)]) console.log(`[NG] ${f}`);
  process.exitCode = 1;
} else {
  console.log("[OK] 秘密情報の混入は見つかりませんでした");
}
