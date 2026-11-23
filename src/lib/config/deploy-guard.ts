import { detectSupabaseKeyKind } from "./env-check";

/**
 * Vercel（公開環境）のビルド時に、設定してはいけない環境変数を検出する。
 * 返すのは変数名と理由だけで、値は含めない。
 *
 * Web アプリは service_role キーを一切使わない（取り込み CLI 専用）。
 * Vercel に設定されていると、将来のコード変更や依存関係の不具合で漏えいする余地が生まれるため、
 * ビルドを失敗させて設定ミスに気づけるようにする。
 */
export const FORBIDDEN_ON_DEPLOY = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "VERIFY_USER_EMAIL",
  "VERIFY_USER_PASSWORD",
  "VERIFY_UNREGISTERED_EMAIL",
  "VERIFY_UNREGISTERED_PASSWORD",
] as const;

const SECRET_LIKE_NAME = /SECRET|SERVICE_ROLE|PRIVATE|PASSWORD|API_KEY|TOKEN/i;

export function findDeployEnvViolations(env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  for (const k of FORBIDDEN_ON_DEPLOY) {
    if ((env[k] ?? "").trim() !== "") {
      out.push(`${k}: 公開環境には設定しないでください（管理者・検証用の値です）`);
    }
  }
  for (const [k, v] of Object.entries(env)) {
    if (!k.startsWith("NEXT_PUBLIC_") || (v ?? "").trim() === "") continue;
    if (SECRET_LIKE_NAME.test(k)) {
      out.push(`${k}: NEXT_PUBLIC_ 変数はブラウザに公開されます。秘密の値を入れないでください`);
      continue;
    }
    const kind = detectSupabaseKeyKind(v ?? "");
    if (kind === "secret" || kind === "jwt-service_role") {
      out.push(`${k}: service_role / Secret key が入っています（ブラウザに公開されます）`);
    }
  }
  return out;
}

/** Vercel 上のビルドでのみ検査する（ローカルの .env.local には取り込み用キーがあってよい）。 */
export function assertSafeDeployEnv(env: Record<string, string | undefined> = process.env): void {
  if (!env.VERCEL) return;
  const violations = findDeployEnvViolations(env);
  if (violations.length > 0) {
    throw new Error(
      ["公開環境の環境変数に問題があるため、ビルドを中止しました:", ...violations.map((v) => `- ${v}`)].join("\n"),
    );
  }
}
