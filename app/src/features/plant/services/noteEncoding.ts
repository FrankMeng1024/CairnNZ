/**
 * Marker note encoding — tiny pure module so the round-trip is
 * unit-testable without pulling RN/navigation imports into jest.
 *
 * Title and body are stored together in a single Marker.note field
 * (the existing schema). They are joined by U+001E (Record Separator),
 * a control character that mobile keyboards cannot type — so the
 * delimiter is unambiguous even when the body contains newlines.
 *
 * Migrating Marker to a real `title` column is deferred to v0.2.7.
 */

/** Title/body separator — U+001E "Record Separator". */
export const TITLE_BODY_SEP = '\u001E';

export function encodeTitleBody(title: string, body: string): string {
  if (!title) return body;
  if (!body) return title;
  return `${title}${TITLE_BODY_SEP}${body}`;
}

export function splitTitleBody(note: string): { title: string; body: string } {
  // Preferred: explicit U+001E separator (plant flow encodes title +
  // body unambiguously even when body contains newlines).
  const sepIdx = note.indexOf(TITLE_BODY_SEP);
  if (sepIdx !== -1) {
    return { title: note.slice(0, sepIdx), body: note.slice(sepIdx + 1) };
  }
  // Note has no separator: it's either title-only OR body-only. Don't
  // promote a body's first line to a title — that's the data-loss bug
  // the previous '\n' split caused. Treat the whole thing as title.
  return { title: note, body: '' };
}
