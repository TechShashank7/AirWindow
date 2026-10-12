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
  validateObservationParams,
  classifyFreshness,
  calculateDistanceKm,
  getNearbyObservations,
  fetchOpenAQObservations,
} = require('../observations/observationsApi');

describe('observationsApi backend module', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
    delete process.env.OPENAQ_API_KEY;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe('validateObservationParams', () => {
    it('accepts valid coordinates, radius, and limit', () => {
      const { errors, lat, lon, radiusKm, limit } = validateObservationParams({
        latitude: '28.6139',
        longitude: '77.2090',
        radiusKm: '30',
        limit: '5',
      });
      expect(errors).toHaveLength(0);
      expect(lat).toBe(28.6139);
      expect(lon).toBe(77.209);
      expect(radiusKm).toBe(30);
      expect(limit).toBe(5);
    });

    it('rejects invalid or out-of-bounds latitude and longitude', () => {
      const { errors } = validateObservationParams({
        latitude: 95,
        longitude: -200,
        radiusKm: 200,
        limit: 0,
      });
      expect(errors.length).toBeGreaterThanOrEqual(3);
      expect(errors.some((e) => e.includes('latitude'))).toBe(true);
      expect(errors.some((e) => e.includes('longitude'))).toBe(true);
      expect(errors.some((e) => e.includes('radiusKm'))).toBe(true);
    });
  });

  describe('classifyFreshness', () => {
    it('classifies recent readings (< 3h)', () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const freshness = classifyFreshness(oneHourAgo);
      expect(freshness.status).toBe('RECENT');
      expect(freshness.ageHours).toBeLessThan(3);
    });

    it('classifies moderate readings (3h - 12h)', () => {
      const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
      const freshness = classifyFreshness(fiveHoursAgo);
      expect(freshness.status).toBe('MODERATE');
    });

    it('classifies stale readings (12h - 48h)', () => {
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const freshness = classifyFreshness(dayAgo);
      expect(freshness.status).toBe('STALE');
    });

    it('classifies outdated readings (> 48h)', () => {
      const fourDaysAgo = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString();
      const freshness = classifyFreshness(fourDaysAgo);
      expect(freshness.status).toBe('OUTDATED');
    });

    it('handles missing or invalid timestamps gracefully', () => {
      expect(classifyFreshness(null).status).toBe('UNKNOWN');
      expect(classifyFreshness('not-a-date').status).toBe('UNKNOWN');
    });
  });

  describe('calculateDistanceKm', () => {
    it('calculates geographic distance with haversine', () => {
      // Distance between New Delhi (28.6139, 77.2090) and R K Puram (28.5633, 77.1869) is ~6.0 km
      const dist = calculateDistanceKm(28.6139, 77.209, 28.5633, 77.1869);
      expect(dist).toBeGreaterThan(5);
      expect(dist).toBeLessThan(7);
    });
  });

  describe('fetchOpenAQObservations', () => {
    it('returns configured: false when apiKey is missing', async () => {
      const res = await fetchOpenAQObservations(28.61, 77.21, 25, 5, '');
      expect(res.configured).toBe(false);
      expect(res.stations).toEqual([]);
    });

    it('parses stations and latest measurements successfully', async () => {
      const mockLocationsResponse = {
        results: [
          {
            id: 17,
            name: 'R K Puram, Delhi - DPCC',
            coordinates: { latitude: 28.5633, longitude: 77.1869 },
            distance: 6000,
            provider: { name: 'CPCB' },
            country: { name: 'India' },
            timezone: 'Asia/Kolkata',
            datetimeLast: { utc: new Date().toISOString() },
            sensors: [
              {
                id: 101,
                parameter: { name: 'pm25', displayName: 'PM2.5', units: 'µg/m³' },
              },
              {
                id: 102,
                parameter: { name: 'pm10', displayName: 'PM10', units: 'µg/m³' },
              },
            ],
          },
        ],
      };

      const mockLatestResponse = {
        results: [
          {
            sensorsId: 101,
            value: 65.4,
            datetime: { utc: new Date(Date.now() - 3600000).toISOString() },
          },
          {
            sensorsId: 102,
            value: 142.1,
            datetime: { utc: new Date(Date.now() - 3600000).toISOString() },
          },
        ],
      };

      global.fetch.mockImplementation((url) => {
        if (url.includes('/locations?')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockLocationsResponse,
          });
        }
        if (url.includes('/locations/17/latest')) {
          return Promise.resolve({
            ok: true,
            json: async () => mockLatestResponse,
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      const res = await fetchOpenAQObservations(28.61, 77.21, 25, 5, 'test-key');

      expect(res.configured).toBe(true);
      expect(res.stations).toHaveLength(1);
      const st = res.stations[0];
      expect(st.stationId).toBe('17');
      expect(st.stationName).toBe('R K Puram, Delhi - DPCC');
      expect(st.provider).toBe('CPCB');
      expect(st.distanceKm).toBe(6);
      expect(st.measurements).toHaveLength(2);
      expect(st.measurements[0].pollutant).toBe('PM2.5');
      expect(st.measurements[0].value).toBe(65.4);
      expect(st.measurements[0].unit).toBe('µg/m³');
      expect(st.measurements[0].freshness).toBe('RECENT');
    });
  });

  describe('getNearbyObservations caching and error handling', () => {
    it('returns validation failure response on bad input', async () => {
      const res = await getNearbyObservations({ latitude: 'bad', longitude: 77.2 });
      expect(res.statusCode).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });

    it('returns cached observation payload if fresh', async () => {
      const cachedPayload = {
        location: { latitude: 28.61, longitude: 77.21 },
        stations: [{ stationId: '99', stationName: 'Cached Station' }],
      };

      mockDbSend.mockResolvedValueOnce({
        Item: {
          CacheKey: 'OBS#LOC#28.61,77.21#RAD#25',
          payload: cachedPayload,
          staleAfter: Date.now() + 600000,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      const res = await getNearbyObservations({ latitude: 28.61, longitude: 77.21 });
      expect(res.statusCode).toBe(200);
      expect(res.body.cached).toBe(true);
      expect(res.body.stations[0].stationName).toBe('Cached Station');
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('recalculates measurement freshness dynamically on cache hit to prevent frozen age', async () => {
      const fiftyHoursAgo = new Date(Date.now() - 50 * 3600 * 1000).toISOString();
      const cachedPayload = {
        location: { latitude: 28.61, longitude: 77.21 },
        stations: [
          {
            stationId: '101',
            stationName: 'Old Station',
            measurements: [
              {
                pollutant: 'PM2.5',
                value: 42,
                timestamp: fiftyHoursAgo,
                freshness: 'RECENT', // was cached as RECENT earlier
                ageHours: 1.0,
              },
            ],
          },
        ],
      };

      mockDbSend.mockResolvedValueOnce({
        Item: {
          CacheKey: 'OBS#LOC#28.61,77.21#RAD#25',
          payload: cachedPayload,
          staleAfter: Date.now() + 600000,
          expiresAt: Math.floor(Date.now() / 1000) + 3600,
        },
      });

      const res = await getNearbyObservations({ latitude: 28.61, longitude: 77.21 });
      expect(res.statusCode).toBe(200);
      expect(res.body.cached).toBe(true);
      const measurement = res.body.stations[0].measurements[0];
      // Must be recalculated to OUTDATED, not the stale cached 'RECENT'
      expect(measurement.freshness).toBe('OUTDATED');
      expect(measurement.ageHours).toBeGreaterThanOrEqual(49);
      expect(measurement.freshnessLabel).toMatch(/Outdated/i);
    });
  });
});
