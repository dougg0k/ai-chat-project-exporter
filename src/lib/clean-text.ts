function replaceInternalUiTokens(input: string): string {
  return input.replace(/([^]+)([\s\S]*?)/g, (_match, tokenType: string, rawPayload: string) => {
    const kind = tokenType.trim();

    if (kind === 'entity') {
      const label = extractEntityLabel(rawPayload);
      return label ? ` ${label} ` : '';
    }

    return '';
  });
}

function extractEntityLabel(rawPayload: string): string {
  try {
    const parsed = JSON.parse(rawPayload);
    if (typeof parsed === 'string') return parsed.trim();
    if (Array.isArray(parsed)) {
      const preferred = parsed[1];
      if (typeof preferred === 'string' && preferred.trim()) return preferred.trim();
      const fallback = parsed.find((value) => typeof value === 'string' && value.trim());
      return typeof fallback === 'string' ? fallback.trim() : '';
    }
  } catch {
    // ignore malformed UI payloads
  }
  return '';
}

function stripInternalJsonBlocks(input: string): string {
  return input.replace(/```json\s*\{[\s\S]*?(?:search_query|response_length|image_query|product_query)[\s\S]*?\}\s*```/g, '').trim();
}

function repairSplitHeadings(input: string): string {
  return input.replace(/^(#{1,6}\s+\d+\.)\s*\n+(?![#>]|```|(?:\d+\.|[-*])\s)([^\n].*)$/gm, '$1 $2');
}

export function cleanVisibleMarkdown(input: string): string {
  return repairSplitHeadings(stripInternalJsonBlocks(replaceInternalUiTokens(input)))
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
