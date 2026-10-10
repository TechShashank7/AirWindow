'use strict';

const mockDbSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => {
  return {
    DynamoDBClient: jest.fn(() => ({
      send: mockDbSend
    })),
    GetItemCommand: jest.fn((input) => input),
    PutItemCommand: jest.fn((input) => input)
  };
});

jest.mock('@aws-sdk/util-dynamodb', () => ({
  marshall: jest.fn((obj) => obj),
  unmarshall: jest.fn((obj) => obj)
}));

const { handler } = require('../handler');

const FIXTURE = {
  latitude: 28.67,
  longitude: 77.22,
  timezone: 'Asia/Kolkata',
  hourly: {
    time: ['2026-10-09T10:00', '2026-10-09T11:00'],
    pm2_5: [50, null],
    pm10: [100, 40],
    windspeed_10m: [12, 10],
    winddirection_10m: [270, 280]
  }
};

global.fetch = jest.fn();
console.log = jest.fn();

function makeEvent(body) {
  return {
    requestContext: { http: { method: 'POST' } },
    httpMethod: 'POST',
    rawPath: '/evaluate',
    body: JSON.stringify(body),
  };
}

const VALID_BODY = {
  latitude: 28.67,
  longitude: 77.22,
  timezone: 'Asia/Kolkata',
  durationMinutes: 60,
  preferredStart: '2026-10-09T10:00',
  preferredEnd: '2026-10-09T13:00',
  currentTime: '2026-10-09T10:00',
};

describe('API Gateway Handler Phase 1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDbSend.mockClear();
    global.fetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(FIXTURE),
      text: () => Promise.resolve(''),
    });
  });

  it('rejects malformed JSON', async () => {
    const res = await handler({ requestContext: { http: { method: 'POST' } }, body: 'bad{json' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('MALFORMED_JSON');
  });

  it('validates request parameters (bad duration)', async () => {
    const res = await handler(makeEvent({ ...VALID_BODY, durationMinutes: 45 }));
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.details[0]).toMatch(/durationMinutes/);
  });

  it('preserves backward compatibility and matches normalized contract', async () => {
    mockDbSend.mockResolvedValue({}); // Cache miss
    const res = await handler(makeEvent(VALID_BODY));
    expect(res.statusCode).toBe(200);
    
    const body = JSON.parse(res.body);
    
    // Normalized check
    expect(body.metadata.location.lat).toBe(28.67);
    expect(body.metadata.units.windSpeed).toBe('km/h');
    expect(body.data[0].windSpeed).toBe(12);
    expect(body.data[1].pm25).toBeNull(); // null preservation
    
    // Backward compatibility check
    expect(body.forecastTimezone).toBe('Asia/Kolkata');
    expect(body.forecastData).toBeDefined();
    expect(body.forecastData.length).toBe(2);
  });

  it('handles Cache Hit (Fresh)', async () => {
    mockDbSend.mockResolvedValueOnce({
      Item: {
        rawForecast: FIXTURE,
        staleAfter: Date.now() + 100000,
        expiresAt: Math.floor(Date.now() / 1000) + 1000
      }
    });

    const res = await handler(makeEvent(VALID_BODY));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).metadata.isStale).toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('handles Cache Stale -> Upstream Success', async () => {
    mockDbSend.mockResolvedValueOnce({
      Item: {
        rawForecast: FIXTURE,
        staleAfter: Date.now() - 100000, // Stale!
        expiresAt: Math.floor(Date.now() / 1000) + 1000
      }
    });

    const res = await handler(makeEvent(VALID_BODY));
    expect(res.statusCode).toBe(200);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(mockDbSend).toHaveBeenCalledTimes(2); // GetItem + PutItem
  });

  it('handles Cache Stale -> Upstream Failure (Stale Fallback)', async () => {
    mockDbSend.mockResolvedValueOnce({
      Item: {
        rawForecast: FIXTURE,
        staleAfter: Date.now() - 10000, // Stale
        expiresAt: Math.floor(Date.now() / 1000) + 10000 // But not expired (in seconds)
      }
    });
    
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const res = await handler(makeEvent(VALID_BODY));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.metadata.isStale).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handles Cache Expired -> Upstream Failure (Complete Failure)', async () => {
    mockDbSend.mockResolvedValueOnce({
      Item: {
        rawForecast: FIXTURE,
        staleAfter: Date.now() - 100000,
        expiresAt: Math.floor(Date.now() / 1000) - 1000 // Expired!
      }
    });
    
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const res = await handler(makeEvent(VALID_BODY));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('UPSTREAM_FAILED');
  });

  it('handles Complete Cache Miss -> Upstream Failure', async () => {
    mockDbSend.mockResolvedValueOnce({}); // Miss
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    const res = await handler(makeEvent(VALID_BODY));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error.code).toBe('UPSTREAM_FAILED');
  });
});
