import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchCurrentAirQuality } from './currentAqiApi';

describe('currentAqiApi', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_EVALUATE_API_URL', 'https://api.example.com');
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('falls back to default production endpoint when VITE_EVALUATE_API_URL is unset', async () => {
    vi.stubEnv('VITE_EVALUATE_API_URL', '');
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true }),
    } as Response);
    const res = await fetchCurrentAirQuality(28.61, 77.2);
    expect(res).toEqual({ configured: true });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('https://ifx0gvr7u0.execute-api.ap-southeast-2.amazonaws.com/current-aqi'),
      expect.any(Object)
    );
  });

  it('fetches successfully from dedicated /current-aqi endpoint', async () => {
    const mockData = {
      configured: true,
      indiaAqi: { aqi: 79, category: 'Satisfactory' },
      universalAqi: { aqi: 74, category: 'Good' },
      pollutants: [{ code: 'pm25', displayName: 'PM2.5', value: 15.2, units: 'µg/m³' }],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockData,
    } as Response);

    const res = await fetchCurrentAirQuality(28.6139, 77.209);
    expect(res).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/current-aqi?lat=28.6139&lon=77.209'),
      expect.any(Object)
    );
  });

  it('falls back to /evaluate when /current-aqi returns 404', async () => {
    const mockCurrentAqi = {
      configured: true,
      indiaAqi: { aqi: 82, category: 'Satisfactory' },
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/current-aqi')) {
        return Promise.resolve({ ok: false, status: 404 } as Response);
      }
      if (url.includes('/evaluate')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ currentAqi: mockCurrentAqi }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const res = await fetchCurrentAirQuality(28.6139, 77.209);
    expect(res).toEqual(mockCurrentAqi);
  });

  it('falls back to /evaluate when /current-aqi throws a CORS/network error', async () => {
    const mockCurrentAqi = {
      configured: true,
      indiaAqi: { aqi: 95, category: 'Satisfactory' },
    };

    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/current-aqi')) {
        return Promise.reject(new TypeError('Failed to fetch (CORS block on 404)'));
      }
      if (url.includes('/evaluate')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ currentAqi: mockCurrentAqi }),
        } as Response);
      }
      return Promise.reject(new Error(`Unhandled URL: ${url}`));
    });

    const res = await fetchCurrentAirQuality(28.6139, 77.209);
    expect(res).toEqual(mockCurrentAqi);
  });

  it('handles fetch exception gracefully and returns null when evaluate also fails', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network down'));
    const res = await fetchCurrentAirQuality(28.6139, 77.209);
    expect(res).toBeNull();
  });
});
