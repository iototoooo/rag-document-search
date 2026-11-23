/**
 * Enter で送信、Shift+Enter で改行。
 * IME 変換確定の Enter（isComposing / keyCode 229）では送信しない。
 */
export function shouldSubmitOnKeyDown(e: {
  key: string;
  shiftKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): boolean {
  if (e.key !== "Enter") return false;
  if (e.shiftKey) return false;
  if (e.isComposing) return false;
  // Safari 等で isComposing が false のまま keyCode 229 が来るケースへの対策
  if (e.keyCode === 229) return false;
  return true;
}
