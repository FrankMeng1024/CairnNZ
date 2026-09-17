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
  it('encodes title-only with an explicit separator', () => {
    const enc = encodeTitleBody('Found it', '');
    expect(enc).toBe(`Found it${TITLE_BODY_SEP}`);
    expect(splitTitleBody(enc)).toEqual({ title: 'Found it', body: '' });
  });

  it('encodes body-only without moving it into the title field', () => {
    const enc = encodeTitleBody('', 'Bring water.');
    expect(enc).toBe(`${TITLE_BODY_SEP}Bring water.`);
    expect(splitTitleBody(enc)).toEqual({ title: '', body: 'Bring water.' });
  });

  it('preserves multiline body without title (the original data-loss bug)', () => {
    const body = 'Beautiful spot.\nReally peaceful.';
    const enc = encodeTitleBody('', body);
    const { title, body: out } = splitTitleBody(enc);
    expect(title).toBe('');
    expect(out).toBe(body);
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

  it('preserves Unicode and empty content exactly', () => {
    const encoded = encodeTitleBody('溪谷 🥾', 'Kia ora — pō mārie\n第二行');
    expect(splitTitleBody(encoded)).toEqual({
      title: '溪谷 🥾',
      body: 'Kia ora — pō mārie\n第二行',
    });
    expect(encodeTitleBody('', '')).toBe('');
    expect(splitTitleBody('')).toEqual({ title: '', body: '' });
  });

  it('treats a pre-separator legacy record as body-only content', () => {
    expect(splitTitleBody('Legacy note\nSecond line')).toEqual({
      title: '',
      body: 'Legacy note\nSecond line',
    });
  });
});
