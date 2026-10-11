import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiRequest, buildApiHeaders } from './client';

const { mockPb } = vi.hoisted(() => ({
  mockPb: { authStore: { token: 'test-token', clear: vi.fn() } },
}));

vi.mock('./pocketbase', () => ({ pb: mockPb }));

describe('API client', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adds the PocketBase bearer token without replacing explicit auth headers', () => {
    expect(buildApiHeaders(undefined, 'session-token').get('Authorization')).toBe(
      'Bearer session-token',
    );
    expect(
      buildApiHeaders({ Authorization: 'Bearer custom-token' }, 'session-token').get(
        'Authorization',
      ),
    ).toBe('Bearer custom-token');
  });

  it('returns typed JSON responses', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://piggybudget.test' } });
    const fetch = vi.fn().mockResolvedValue(Response.json({ mode: 'approval' }));
    vi.stubGlobal('fetch', fetch);

    await expect(apiRequest<{ mode: string }>('/api/auth/registration-policy')).resolves.toEqual({
      mode: 'approval',
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://piggybudget.test/api/auth/registration-policy',
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it('parses PocketBase error envelopes into an ApiError', async () => {
    const response = Response.json(
      { code: 403, message: 'Forbidden', data: { owner: { code: 'validation_required' } } },
      { status: 403, statusText: 'Forbidden' },
    );
    const error = await (async () => {
      const fetch = vi.fn().mockResolvedValue(response);
      vi.stubGlobal('window', { location: { origin: 'http://piggybudget.test' } });
      vi.stubGlobal('fetch', fetch);
      try {
        await apiRequest('/api/finance/accounts');
      } catch (caught) {
        return caught;
      }
      throw new Error('expected API request to fail');
    })();

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      message: 'Forbidden',
      status: 403,
      code: 403,
      details: { owner: { code: 'validation_required' } },
    });
  });
});
