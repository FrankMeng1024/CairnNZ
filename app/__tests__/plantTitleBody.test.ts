/**
 * Regression test — title/body encoding round-trip.
 *
 * Before the v0.2.6 G-review fix, plant flow joined title+text with
 * '\n' and RevealedCairnSheet split on the FIRST newline. This caused
 * data loss for body-only multiline notes:
 *
 *   "Beautiful spot.\nReally peaceful." (body only)
 *     → split → title="Beautiful spot.", body="Really peaceful."
 *
 * Fix: use U+001E (Record Separator) which is never typed by users.
 */

import { encodeTitleBody, splitTitleBody, TITLE_BODY_SEP } from '../src/features/plant/services/noteEncoding';

describe('title/body encoding · round-trip', () => {
  it('encodes title-only as bare title (no separator)', () => {
    const enc = encodeTitleBody('Found it', '');
    expect(enc).toBe('Found it');
    expect(splitTitleBody(enc)).toEqual({ title: 'Found it', body: '' });
  });

  it('encodes body-only as bare body (no separator)', () => {
    const enc = encodeTitleBody('', 'Bring water.');
    expect(enc).toBe('Bring water.');
    // Body-only round-trips into title slot (acceptable — UI renders
    // "title" prominently and that's where the user's content goes).
    // Critical: no data loss.
    expect(splitTitleBody(enc).title + splitTitleBody(enc).body).toBe('Bring water.');
  });

  it('preserves multiline body without title (the original data-loss bug)', () => {
    const body = 'Beautiful spot.\nReally peaceful.';
    const enc = encodeTitleBody('', body);
    const { title, body: out } = splitTitleBody(enc);
    // Either title or body must contain the FULL multiline text — not
    // split into a fake title + truncated body.
    expect(title.includes('Really peaceful') || out.includes('Really peaceful')).toBe(true);
    expect((title + out).includes('Beautiful spot.\nReally peaceful.')).toBe(true);
  });

  it('preserves multiline body with title', () => {
    const enc = encodeTitleBody('Hidden tea spot', 'Bring water.\nThird bend, not second.');
    const { title, body } = splitTitleBody(enc);
    expect(title).toBe('Hidden tea spot');
    expect(body).toBe('Bring water.\nThird bend, not second.');
  });

  it('uses U+001E (not \\n) as the separator', () => {
    const enc = encodeTitleBody('T', 'B');
    expect(enc.includes(TITLE_BODY_SEP)).toBe(true);
    expect(TITLE_BODY_SEP.charCodeAt(0)).toBe(0x1e);
  });
});
