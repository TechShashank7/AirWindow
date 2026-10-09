'use strict';

/**
 * Integration test for lambda/handler.js
 *
 * Uses Jest's manual mocking to replace the Open-Meteo HTTP call with a
 * deterministic fixture so tests run offline and stay reproducible.
 *
 * The handler module is re-loaded for each test to avoid state bleed.
 */

// ── Fixture data ─────────────────────────────────────────────────────────────

const FIXTURE = {
  latitude: 28.67,
  longitude: 77.22,
  timezone: 'Asia/Kolkata',
  hourly: {
    time: [
      '2026-10-09T10:00', '2026-10-09T11:00',
      '2026-10-09T12:00', '2026-10-09T13:00',
    ],
    pm2_5: [50, 20, 30, 10],
    pm10:  [100, 40, 60, 20],
  },
};

// ── Mock global fetch before any require ─────────────────────────────────────

global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve(FIXTURE),
    text: () => Promise.resolve(''),
  })
);

const { handler } = require('../handler');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEvent(body) {
  return {
    requestContext: { http: { method: 'POST' } },
    httpMethod: 'POST',
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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('handler', () => {
  afterEach(() => jest.clearAllMocks());

  it('responds 204 to CORS preflight OPTIONS', async () => {
    const event = { requestContext: { http: { method: 'OPTIONS' } }, httpMethod: 'OPTIONS' };
    const res = await handler(event);
    expect(res.statusCode).toBe(204);
  });

  it('returns 400 for missing body', async () => {
    const res = await handler({ requestContext: { http: { method: 'POST' } }, body: '{}' });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it('returns 400 for out-of-range latitude', async () => {
    const res = await handler(makeEvent({ ...VALID_BODY, latitude: 200 }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).details.join()).toMatch(/latitude/i);
  });

  it('returns 400 for invalid duration', async () => {
    const res = await handler(makeEvent({ ...VALID_BODY, durationMinutes: 45 }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).details.join()).toMatch(/durationMinutes/i);
  });

  it('returns 400 when preferredEnd <= preferredStart', async () => {
    const res = await handler(makeEvent({
      ...VALID_BODY,
      preferredStart: '2026-10-09T12:00',
      preferredEnd:   '2026-10-09T10:00',
    }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for malformed preferredStart', async () => {
    const res = await handler(makeEvent({ ...VALID_BODY, preferredStart: '2026/10/09 10:00' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 200 with a valid recommendation on happy path', async () => {
    const res = await handler(makeEvent(VALID_BODY));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.recommendation).not.toBeNull();
    expect(body.recommendation.averageScore).toBeGreaterThan(0);
    expect(body.recommendation.qualityLabel).toMatch(/^(Good|Moderate|Poor)$/);
    expect(body.forecastData.length).toBe(4);
    expect(body.scoreFormula).toBe('PM2.5 + (0.5 × PM10)');
    expect(body.disclaimer).toMatch(/NOT.*AQI|CPCB/i);
  });

  it('recommendation message never uses the word "safe"', async () => {
    const res = await handler(makeEvent(VALID_BODY));
    const { message } = JSON.parse(res.body).recommendation;
    expect(message).not.toMatch(/\bsafe\b/i);
  });

  it('includes retrievedAt ISO timestamp', async () => {
    const res = await handler(makeEvent(VALID_BODY));
    const { retrievedAt } = JSON.parse(res.body);
    expect(new Date(retrievedAt).toISOString()).toBe(retrievedAt);
  });

  it('returns 502 when Open-Meteo is unavailable', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () => Promise.resolve('Service Unavailable'),
    });
    const res = await handler(makeEvent(VALID_BODY));
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).error).toMatch(/Open-Meteo/i);
  });

  it('returns 200 with null recommendation when all forecast data is null', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        ...FIXTURE,
        hourly: {
          time: FIXTURE.hourly.time,
          pm2_5: [null, null, null, null],
          pm10:  [null, null, null, null],
        },
      }),
      text: () => Promise.resolve(''),
    });
    const res = await handler(makeEvent(VALID_BODY));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).recommendation).toBeNull();
  });
});
