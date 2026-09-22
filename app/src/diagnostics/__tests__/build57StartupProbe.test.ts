import {
  diagnosticErrorFields,
  diagnosticRequestDescriptor,
} from '../build57StartupProbe';

describe('Build 57 startup diagnostics', () => {
  it('removes query and fragment data from request receipts', () => {
    expect(diagnosticRequestDescriptor(
      'https://api.yiiling.cn/api/boot?token=do-not-record#private',
      { method: 'post' },
    )).toEqual({
      method: 'POST',
      origin: 'https://api.yiiling.cn',
      path: '/api/boot',
    });
  });

  it('keeps a bounded error identity for a pre-render failure', () => {
    const error = new TypeError('startup failed');
    const fields = diagnosticErrorFields(error);
    expect(fields.errorName).toBe('TypeError');
    expect(fields.errorMessage).toBe('startup failed');
    expect(String(fields.errorStack)).toContain('TypeError: startup failed');
  });

  it('rejects malformed request identities', () => {
    expect(diagnosticRequestDescriptor('not a URL')).toBeNull();
    expect(diagnosticRequestDescriptor(null)).toBeNull();
  });
});

