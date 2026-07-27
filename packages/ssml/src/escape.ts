/**
 * XML-safe text handling for SSML projection.
 *
 * Acquired research content is untrusted (Section 11). All text that becomes
 * SSML must be escaped to prevent XML/SSML injection and invalid nesting.
 */

const XML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&apos;',
};

/** Escapes text content for safe inclusion inside an SSML element. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => XML_ESCAPES[ch] ?? ch);
}

/** Escapes an attribute value (same rules, kept separate for intent clarity). */
export function escapeAttr(value: string): string {
  return escapeXml(value);
}

/**
 * Strips characters that are not valid in XML 1.0 to avoid producing a
 * malformed document that a synthesis engine would reject.
 */
export function stripInvalidXmlChars(text: string): string {
  // Allow tab, LF, CR and the standard XML character ranges.
  // eslint-disable-next-line no-control-regex
  return text.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD]/g, '');
}
