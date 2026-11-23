/**
 * Normalize plain text before storage. JSON responses are rendered as text by
 * React, which escapes HTML; this helper removes control bytes without
 * changing punctuation that users may legitimately include.
 */
export function sanitizePlainText(value: string, maxLength: number): string {
  return value
    .normalize("NFC")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, maxLength);
}
