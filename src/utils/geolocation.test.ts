import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getBrowserCoordinates,
  reverseGeocodeCoordinates,
  type GeolocationError,
} from './geolocation';
import * as googleLoader from './googleMapsLoader';

describe('geolocation utility', () => {
  const originalGeolocation = navigator.geolocation;
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'geolocation', {
      value: originalGeolocation,
      writable: true,
      configurable: true,
    });
    global.fetch = originalFetch;
  });

  describe('getBrowserCoordinates', () => {
    it('resolves latitude and longitude on success', async () => {
      const mockCoords = {
        coords: {
          latitude: 28.6139,
          longitude: 77.209,
          accuracy: 15,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      };

      const mockGeolocation = {
        getCurrentPosition: vi.fn((success) => {
          success(mockCoords as GeolocationPosition);
        }),
      };

      Object.defineProperty(navigator, 'geolocation', {
        value: mockGeolocation,
        writable: true,
        configurable: true,
      });

      const result = await getBrowserCoordinates();
      expect(result).toEqual({
        latitude: 28.6139,
        longitude: 77.209,
      });
      expect(mockGeolocation.getCurrentPosition).toHaveBeenCalledTimes(1);
    });

    it('rejects with PERMISSION_DENIED when user denies access', async () => {
      const mockError = {
        code: 1, // GeolocationPositionError.PERMISSION_DENIED
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: 'User denied Geolocation',
      };

      const mockGeolocation = {
        getCurrentPosition: vi.fn((_success, error) => {
          error(mockError);
        }),
      };

      Object.defineProperty(navigator, 'geolocation', {
        value: mockGeolocation,
        writable: true,
        configurable: true,
      });

      await expect(getBrowserCoordinates()).rejects.toMatchObject({
        code: 'PERMISSION_DENIED',
        message: expect.stringContaining('denied'),
      });
    });

    it('rejects with TIMEOUT when request times out', async () => {
      const mockError = {
        code: 3, // GeolocationPositionError.TIMEOUT
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: 'Timeout expired',
      };

      const mockGeolocation = {
        getCurrentPosition: vi.fn((_success, error) => {
          error(mockError);
        }),
      };

      Object.defineProperty(navigator, 'geolocation', {
        value: mockGeolocation,
        writable: true,
        configurable: true,
      });

      await expect(getBrowserCoordinates()).rejects.toMatchObject({
        code: 'TIMEOUT',
        message: expect.stringContaining('timed out'),
      });
    });

    it('rejects with POSITION_UNAVAILABLE when position cannot be determined', async () => {
      const mockError = {
        code: 2, // GeolocationPositionError.POSITION_UNAVAILABLE
        PERMISSION_DENIED: 1,
        POSITION_UNAVAILABLE: 2,
        TIMEOUT: 3,
        message: 'Position unavailable',
      };

      const mockGeolocation = {
        getCurrentPosition: vi.fn((_success, error) => {
          error(mockError);
        }),
      };

      Object.defineProperty(navigator, 'geolocation', {
        value: mockGeolocation,
        writable: true,
        configurable: true,
      });

      await expect(getBrowserCoordinates()).rejects.toMatchObject({
        code: 'POSITION_UNAVAILABLE',
        message: expect.stringContaining('unavailable'),
      });
    });

    it('rejects with UNSUPPORTED when navigator.geolocation is not available', async () => {
      Object.defineProperty(navigator, 'geolocation', {
        value: undefined,
        writable: true,
        configurable: true,
      });

      await expect(getBrowserCoordinates()).rejects.toMatchObject({
        code: 'UNSUPPORTED',
        message: expect.stringContaining('not supported'),
      });
    });
  });

  describe('reverseGeocodeCoordinates', () => {
    it('successfully resolves IANA timezone and location details via mocked APIs', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('api.open-meteo.com/v1/forecast')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              timezone: 'Asia/Kolkata',
              latitude: 28.61,
              longitude: 77.21,
            }),
          });
        }
        if (url.includes('photon.komoot.io/reverse')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              features: [
                {
                  properties: {
                    name: 'Connaught Place',
                    city: 'New Delhi',
                    state: 'Delhi',
                    country: 'India',
                  },
                },
              ],
            }),
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      global.fetch = mockFetch;

      const result = await reverseGeocodeCoordinates(28.6139, 77.209);

      expect(result.name).toBe('Connaught Place');
      expect(result.country).toBe('India');
      expect(result.admin1).toBe('Delhi');
      expect(result.timezone).toBe('Asia/Kolkata');
      expect(result.latitude).toBe(28.6139);
      expect(result.longitude).toBe(77.209);
    });

    it('falls back to coordinate label if reverse geocoding lookup fails or returns empty', async () => {
      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('api.open-meteo.com/v1/forecast')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              timezone: 'America/Chicago',
            }),
          });
        }
        if (url.includes('photon.komoot.io/reverse')) {
          // Simulate upstream 503 or network failure
          return Promise.resolve({
            ok: false,
            status: 503,
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      global.fetch = mockFetch;

      const result = await reverseGeocodeCoordinates(41.8781, -87.6298);

      expect(result.name).toBe('Location (41.88°, -87.63°)');
      expect(result.timezone).toBe('America/Chicago');
      expect(result.latitude).toBe(41.8781);
      expect(result.longitude).toBe(-87.6298);
    });

    it('uses Google Geocoder when API key is provided and geocoder returns results', async () => {
      const mockGeocode = vi.fn(() =>
        Promise.resolve({
          results: [
            {
              formatted_address: 'South Extension, New Delhi, Delhi, India',
              address_components: [
                { long_name: 'South Extension', types: ['sublocality_level_1'] },
                { long_name: 'Delhi', types: ['administrative_area_level_1'] },
                { long_name: 'India', types: ['country'] },
              ],
            },
          ],
        })
      );

      class MockGeocoder {
        geocode = mockGeocode;
      }

      const mockGoogle = {
        maps: {
          Geocoder: MockGeocoder,
        },
      };

      vi.spyOn(googleLoader, 'loadGoogleMaps').mockResolvedValue(mockGoogle as any);

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('api.open-meteo.com/v1/forecast')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              timezone: 'Asia/Kolkata',
            }),
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });
      global.fetch = mockFetch;

      const result = await reverseGeocodeCoordinates(28.5678, 77.2189, 'valid-key');

      expect(result.name).toBe('South Extension');
      expect(result.admin1).toBe('Delhi');
      expect(result.country).toBe('India');
      expect(result.timezone).toBe('Asia/Kolkata');
      expect(mockGeocode).toHaveBeenCalledWith({
        location: { lat: 28.5678, lng: 77.2189 },
      });
    });

    it('handles total fetch failure gracefully without throwing', async () => {
      // Both timezone and reverse geocode endpoints reject
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network offline'));
      global.fetch = mockFetch;

      const result = await reverseGeocodeCoordinates(51.5074, -0.1278);

      expect(result.name).toBe('Location (51.51°, -0.13°)');
      expect(result.latitude).toBe(51.5074);
      expect(result.longitude).toBe(-0.1278);
      expect(typeof result.timezone).toBe('string');
      expect(result.timezone.length).toBeGreaterThan(0);
    });
  });
});
