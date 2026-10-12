'use strict';

const mockDbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({
    send: mockDbSend,
  })),
  GetItemCommand: jest.fn((input) => input),
  PutItemCommand: jest.fn((input) => input),
}));

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj),
}));

const {
  validateCoordinates,
  normalizeUnits,
  normalizeGoogleResponse,
  refreshCachedPayload,
  fetchGoogleCurrentConditions,
  getCurrentAirQuality,
} = require('../googleAirQuality/googleAirQualityApi');

describe('googleAirQualityApi module', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    delete process.env.GOOGLE_MAPS_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('validateCoordinates', () => {
    it('accepts valid coordinates', () => {
      const { errors, lat, lon } = validateCoordinates(28.6139, 77.209);
      expect(errors).toHaveLength(0);
      expect(lat).toBe(28.6139);
      expect(lon).toBe(77.209);
    });

    it('rejects out-of-range coordinates', () => {
      const { errors } = validateCoordinates(100, -200);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toMatch(/latitude/);
      expect(errors[1]).toMatch(/longitude/);
    });
  });

  describe('normalizeUnits', () => {
    it('normalizes Google documented unit strings', () => {
      expect(normalizeUnits('MICROGRAMS_PER_CUBIC_METER')).toBe('µg/m³');
      expect(normalizeUnits('PARTS_PER_BILLION')).toBe('ppb');
      expect(normalizeUnits('PARTS_PER_MILLION')).toBe('ppm');
      expect(normalizeUnits('OTHER')).toBe('OTHER');
      expect(normalizeUnits(null)).toBe('');
    });
  });

  describe('normalizeGoogleResponse', () => {
    it('normalizes full response with ind_cpcb and uaqi correctly', () => {
      const raw = {
        dateTime: '2026-10-12T05:00:00Z',
        regionCode: 'in',
        indexes: [
          {
            code: 'uaqi',
            displayName: 'Universal AQI',
            aqi: 74,
            category: 'Good air quality',
            dominantPollutant: 'pm10',
          },
          {
            code: 'ind_cpcb',
            displayName: 'NAQI (IN)',
            aqi: 79,
            category: 'Satisfactory air quality',
            dominantPollutant: 'co',
          },
        ],
        pollutants: [
          {
            code: 'pm25',
            displayName: 'PM2.5',
            concentration: { value: 15.2, units: 'MICROGRAMS_PER_CUBIC_METER' },
          },
          {
            code: 'pm10',
            displayName: 'PM10',
            concentration: { value: 28.66, units: 'MICROGRAMS_PER_CUBIC_METER' },
          },
        ],
        healthRecommendations: {
          generalPopulation: 'Enjoy the outdoors!',
        },
      };

      const normalized = normalizeGoogleResponse(raw, 28.6139, 77.209);
      expect(normalized.configured).toBe(true);
      expect(normalized.indiaAqi.aqi).toBe(79);
      expect(normalized.indiaAqi.category).toBe('Satisfactory air quality');
      expect(normalized.universalAqi.aqi).toBe(74);
      expect(normalized.pollutants).toHaveLength(2);
      expect(normalized.pollutants[0].units).toBe('µg/m³');
      expect(normalized.healthRecommendations.generalPopulation).toBe('Enjoy the outdoors!');
      expect(normalized.provenance.isPhysicalStation).toBe(false);
      expect(normalized.measurementTimestamp).toBe('2026-10-12T05:00:00Z');
    });

    it('handles missing ind_cpcb gracefully without inventing a zero index', () => {
      const raw = {
        dateTime: '2026-10-12T05:00:00Z',
        indexes: [
          {
            code: 'uaqi',
            displayName: 'Universal AQI',
            aqi: 50,
            category: 'Moderate',
          },
        ],
      };

      const normalized = normalizeGoogleResponse(raw, 51.5, -0.1);
      expect(normalized.indiaAqi).toBeNull();
      expect(normalized.universalAqi.aqi).toBe(50);
    });
  });

  describe('refreshCachedPayload', () => {
    it('recalculates ageHours dynamically against current time', () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
      const cached = {
        measurementTimestamp: twoHoursAgo,
        ageHours: 0.1, // old stale age
      };

      const refreshed = refreshCachedPayload(cached);
      expect(refreshed.ageHours).toBeGreaterThanOrEqual(1.9);
      expect(refreshed.ageHours).toBeLessThanOrEqual(2.1);
    });
  });

  describe('fetchGoogleCurrentConditions', () => {
    it('returns unconfigured if apiKey is missing', async () => {
      const res = await fetchGoogleCurrentConditions(28.6, 77.2, '');
      expect(res.configured).toBe(false);
      expect(res.error.code).toBe('UNCONFIGURED');
    });

    it('handles HTTP error responses (e.g. quota exhausted)', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        json: async () => ({
          error: {
            code: 429,
            status: 'RESOURCE_EXHAUSTED',
            message: 'Quota exceeded for Air Quality API',
          },
        }),
      });

      await expect(
        fetchGoogleCurrentConditions(28.6, 77.2, 'test-key')
      ).rejects.toThrow(/Quota exceeded/);
    });
  });

  describe('getCurrentAirQuality handler with caching & fallbacks', () => {
    it('returns 400 on invalid coordinates', async () => {
      const res = await getCurrentAirQuality({ latitude: 'bad', longitude: 77.2 });
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('returns configured: false when GOOGLE_MAPS_API_KEY is not set', async () => {
      const res = await getCurrentAirQuality({ latitude: 28.6, longitude: 77.2 });
      expect(res.statusCode).toBe(200);
      expect(res.body.configured).toBe(false);
    });

    it('returns fresh cached payload when available', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'test-key';
      const cachedPayload = {
        configured: true,
        measurementTimestamp: new Date().toISOString(),
        indiaAqi: { aqi: 75, category: 'Satisfactory' },
      };

      mockDbSend.mockResolvedValueOnce({
        Item: {
          CacheKey: 'GOOGLE_AQ#LOC#28.60,77.20',
          payload: cachedPayload,
          staleAfter: Date.now() + 600000,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      const res = await getCurrentAirQuality({ latitude: 28.6, longitude: 77.2 });
      expect(res.statusCode).toBe(200);
      expect(res.body.cached).toBe(true);
      expect(res.body.indiaAqi.aqi).toBe(75);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('falls back to stale cache on upstream failure', async () => {
      process.env.GOOGLE_MAPS_API_KEY = 'test-key';
      const cachedPayload = {
        configured: true,
        measurementTimestamp: new Date(Date.now() - 3600000).toISOString(),
        indiaAqi: { aqi: 80, category: 'Satisfactory' },
      };

      // 1. GetItem returns expired staleAfter but within expiresAt
      mockDbSend.mockResolvedValueOnce({
        Item: {
          CacheKey: 'GOOGLE_AQ#LOC#28.60,77.20',
          payload: cachedPayload,
          staleAfter: Date.now() - 1000,
          expiresAt: Math.floor(Date.now() / 1000) + 1800,
        },
      });

      // 2. Fetch fails (upstream 500)
      global.fetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => ({ error: { message: 'Upstream crash' } }),
      });

      const res = await getCurrentAirQuality({ latitude: 28.6, longitude: 77.2 });
      expect(res.statusCode).toBe(200);
      expect(res.body.cached).toBe(true);
      expect(res.body.isStale).toBe(true);
      expect(res.body.indiaAqi.aqi).toBe(80);
    });
  });
});
