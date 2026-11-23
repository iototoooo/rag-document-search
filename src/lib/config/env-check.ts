/**
 * .env.local の Supabase 接続設定を、値を表示せずに点検する（外部通信なし）。
 * 出力にはキー名と判定結果だけを含め、キーや URL の値そのものは含めない。
 */

type Source = Record<string, string | undefined>;

export type CheckLevel = "ok" | "warn" | "error";
export type CheckItem = { level: CheckLevel; key: string; message: string };

const PLACEHOLDER_URL = "https://your-project-ref.supabase.co";

/** キーの種類を値から判定する（値は返さない）。 */
export type SupabaseKeyKind =
  | "publishable"
  | "secret"
  | "jwt-anon"
  | "jwt-service_role"
  | "jwt-other"
  | "unknown";

export function detectSupabaseKeyKind(value: string): SupabaseKeyKind {
  const v = value.trim();
  if (v.startsWith("sb_publishable_")) return "publishable";
  if (v.startsWith("sb_secret_")) return "secret";
  const parts = v.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as {
        role?: unknown;
      };
      if (payload.role === "anon") return "jwt-anon";
      if (payload.role === "service_role") return "jwt-service_role";
      return "jwt-other";
    } catch {
      return "unknown";
    }
  }
  return "unknown";
}

const isSecretKind = (k: SupabaseKeyKind) => k === "secret" || k === "jwt-service_role";
const isPublicKind = (k: SupabaseKeyKind) => k === "publishable" || k === "jwt-anon";

export function checkSupabaseEnv(env: Source): CheckItem[] {
  const items: CheckItem[] = [];
  const val = (k: string) => (env[k] ?? "").trim();

  // --- URL ---
  const url = val("NEXT_PUBLIC_SUPABASE_URL");
  const urlKey = "NEXT_PUBLIC_SUPABASE_URL";
  if (!url) {
    items.push({ level: "error", key: urlKey, message: "未設定です" });
  } else if (url === PLACEHOLDER_URL) {
    items.push({ level: "error", key: urlKey, message: "テンプレートの仮の値のままです" });
  } else {
    let parsed: URL | null = null;
    try {
      parsed = new URL(url);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:") {
      items.push({ level: "error", key: urlKey, message: "https:// で始まる URL ではありません" });
    } else if (!/^[a-z0-9]+\.supabase\.co$/.test(parsed.hostname)) {
      items.push({
        level: "warn",
        key: urlKey,
        message: "形式が https://<Project ID>.supabase.co ではありません（独自ドメインなら問題なし）",
      });
    } else if (parsed.pathname !== "/" || parsed.search) {
      items.push({
        level: "error",
        key: urlKey,
        message: "末尾に /rest/v1 などのパスが付いています。https://<Project ID>.supabase.co までにしてください",
      });
    } else {
      items.push({ level: "ok", key: urlKey, message: "形式 OK" });
    }
  }

  // --- anon / publishable key（ブラウザに公開される） ---
  const anon = val("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const anonKey = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
  const anonKind = anon ? detectSupabaseKeyKind(anon) : null;
  if (!anonKind) {
    items.push({ level: "error", key: anonKey, message: "未設定です" });
  } else if (isSecretKind(anonKind)) {
    items.push({
      level: "error",
      key: anonKey,
      message:
        "service_role / Secret key が入っています。ブラウザに公開されるため危険です。anon / Publishable key に差し替えてください",
    });
  } else if (isPublicKind(anonKind)) {
    items.push({ level: "ok", key: anonKey, message: `種類 OK（${anonKind === "publishable" ? "Publishable key" : "anon key"}）` });
  } else {
    items.push({ level: "warn", key: anonKey, message: "キーの種類を判定できません。コピー漏れがないか確認してください" });
  }

  // --- service_role / secret key（取り込み CLI 専用） ---
  const service = val("SUPABASE_SERVICE_ROLE_KEY");
  const serviceKey = "SUPABASE_SERVICE_ROLE_KEY";
  const serviceKind = service ? detectSupabaseKeyKind(service) : null;
  if (!serviceKind) {
    items.push({
      level: "warn",
      key: serviceKey,
      message: "未設定です（ログイン確認には不要。文書の取り込み前に設定）",
    });
  } else if (isPublicKind(serviceKind)) {
    items.push({
      level: "error",
      key: serviceKey,
      message: "anon / Publishable key が入っています。service_role / Secret key に差し替えてください",
    });
  } else if (isSecretKind(serviceKind)) {
    items.push({ level: "ok", key: serviceKey, message: "種類 OK（サーバー専用キー）" });
  } else {
    items.push({ level: "warn", key: serviceKey, message: "キーの種類を判定できません。コピー漏れがないか確認してください" });
  }

  // service_role の値が NEXT_PUBLIC_* のどこかに入っていないか（ブラウザ公開の防止）
  if (service) {
    for (const [k, v] of Object.entries(env)) {
      if (k.startsWith("NEXT_PUBLIC_") && (v ?? "").trim() === service) {
        items.push({
          level: "error",
          key: k,
          message: "SUPABASE_SERVICE_ROLE_KEY と同じ値です。NEXT_PUBLIC_ 変数はブラウザに公開されます",
        });
      }
    }
  }
  for (const k of Object.keys(env)) {
    if (k.startsWith("NEXT_PUBLIC_") && /SERVICE_ROLE|SECRET/i.test(k)) {
      items.push({
        level: "error",
        key: k,
        message: "秘密の値を NEXT_PUBLIC_ 変数に入れないでください（ブラウザに公開されます）",
      });
    }
  }

  // --- 許可ドメイン ---
  const domainsRaw = env.ALLOWED_EMAIL_DOMAINS;
  const domains = (domainsRaw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const domKey = "ALLOWED_EMAIL_DOMAINS";
  if (domains.length === 0) {
    items.push({
      level: "warn",
      key: domKey,
      message: "空のためドメインの絞り込みなし（app_users の登録は引き続き必須）",
    });
  } else if (domains.some((d) => d.includes("@") || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d))) {
    items.push({
      level: "error",
      key: domKey,
      message: "ドメインのみをカンマ区切りで指定してください（例: example.co.jp。@ やメールアドレス全体は不可）",
    });
  } else if (domains.includes("example.com")) {
    items.push({
      level: "warn",
      key: domKey,
      message: "テンプレートの example.com が残っています。テストユーザーのドメインと異なるとログイン後に「権限なし」になります",
    });
  } else {
    items.push({ level: "ok", key: domKey, message: `${domains.length} 件のドメインを設定済み` });
  }

  return items;
}

export function formatCheckReport(items: CheckItem[]): string {
  const mark = { ok: "OK  ", warn: "注意", error: "NG  " } as const;
  const lines = items.map((i) => `[${mark[i.level]}] ${i.key}: ${i.message}`);
  const errors = items.filter((i) => i.level === "error").length;
  const warns = items.filter((i) => i.level === "warn").length;
  lines.push("");
  lines.push(
    errors > 0
      ? `NG が ${errors} 件あります。.env.local を修正してから再実行してください。`
      : `NG はありません（注意 ${warns} 件）。`,
  );
  return lines.join("\n");
}
