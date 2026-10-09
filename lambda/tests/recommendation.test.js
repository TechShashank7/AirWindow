'use strict';

/**
 * Unit tests for lambda/recommendation.js
 *
 * Coverage:
 *   - calculatePollutionScore: basic math, null-handling (never imputes zeros)
 *   - processForecastData: correct mapping and score derivation
 *   - getBestTimeWindow:
 *       • finds best window inside preferred range
 *       • falls back to global best when no preferred data exists
 *       • handles 30 / 60 / 90-minute durations (1 h and 2 h slots)
 *       • excludes past hours
 *       • skips windows containing null scores
 *       • handles midnight / date-boundary timestamps
 *       • returns null when all data is null
 *       • sets qualityLabel correctly (Good / Moderate / Poor)
 *       • sets isInPreferredRange correctly
 */

const {
  calculatePollutionScore,
  processForecastData,
  getBestTimeWindow,
} = require('../recommendation');

// ── calculatePollutionScore ────────────────────────────────────────────────────

describe('calculatePollutionScore', () => {
  it('computes PM2.5 + 0.5 × PM10', () => {
    expect(calculatePollutionScore(10, 20)).toBe(20);   // 10 + 0.5*20
    expect(calculatePollutionScore(0, 0)).toBe(0);
    expect(calculatePollutionScore(50, 80)).toBe(90);   // 50 + 40
  });

  it('returns null when PM2.5 is null', () => {
    expect(calculatePollutionScore(null, 20)).toBeNull();
  });

  it('returns null when PM10 is null', () => {
    expect(calculatePollutionScore(10, null)).toBeNull();
  });

  it('returns null when both are null', () => {
    expect(calculatePollutionScore(null, null)).toBeNull();
  });

  it('returns null when values are undefined', () => {
    expect(calculatePollutionScore(undefined, undefined)).toBeNull();
    expect(calculatePollutionScore(10, undefined)).toBeNull();
  });
});

// ── processForecastData ───────────────────────────────────────────────────────

describe('processForecastData', () => {
  const raw = {
    latitude: 28.6,
    longitude: 77.2,
    timezone: 'Asia/Kolkata',
    hourly: {
      time:  ['2026-10-09T00:00', '2026-10-09T01:00', '2026-10-09T02:00'],
      pm2_5: [10, null, 30],
      pm10:  [20, 40,   null],
    },
  };

  it('maps pm2_5 → pm25 and retains pm10', () => {
    const pts = processForecastData(raw);
    expect(pts[0].pm25).toBe(10);
    expect(pts[0].pm10).toBe(20);
  });

  it('computes score when both values are present', () => {
    const pts = processForecastData(raw);
    expect(pts[0].score).toBe(20); // 10 + 0.5*20
  });

  it('sets score to null when pm25 is null', () => {
    const pts = processForecastData(raw);
    expect(pts[1].pm25).toBeNull();
    expect(pts[1].score).toBeNull();
  });

  it('sets score to null when pm10 is null', () => {
    const pts = processForecastData(raw);
    expect(pts[2].pm10).toBeNull();
    expect(pts[2].score).toBeNull();
  });
});

// ── getBestTimeWindow helpers ─────────────────────────────────────────────────

/** Build a DataPoint with pre-computed score */
function pt(time, pm25, pm10) {
  const score = pm25 !== null && pm10 !== null ? pm25 + 0.5 * pm10 : null;
  return { time, pm25, pm10, score };
}

// ── getBestTimeWindow ─────────────────────────────────────────────────────────

describe('getBestTimeWindow', () => {
  // Base dataset: 10:00–13:00, scores: 100, 40, 60, 20
  const data = [
    pt('2026-10-09T10:00', 50, 100), // score 100
    pt('2026-10-09T11:00', 20, 40),  // score 40  ← best in range 10-12
    pt('2026-10-09T12:00', 30, 60),  // score 60
    pt('2026-10-09T13:00', 10, 20),  // score 20  ← global best, outside pref range
  ];

  it('finds best 60-min window inside preferred range', () => {
    const r = getBestTimeWindow(
      data, 60,
      '2026-10-09T10:00', '2026-10-09T12:00',
      '2026-10-09T10:00'
    );
    expect(r).not.toBeNull();
    expect(r.recommendedWindow[0].time).toBe('2026-10-09T11:00');
    expect(r.averageScore).toBe(40);
    expect(r.isInPreferredRange).toBe(true);
    expect(r.originalWindow).toBeNull(); // isInPreferredRange → no comparison needed
  });

  it('falls back to global best when preferred range has no data', () => {
    const r = getBestTimeWindow(
      data, 60,
      '2026-10-09T20:00', '2026-10-09T22:00',
      '2026-10-09T10:00'
    );
    expect(r).not.toBeNull();
    expect(r.recommendedWindow[0].time).toBe('2026-10-09T13:00');
    expect(r.averageScore).toBe(20);
    expect(r.isInPreferredRange).toBe(false);
  });

  it('excludes past hours from consideration', () => {
    // current time is 12:00 — 10:00 and 11:00 are past
    const r = getBestTimeWindow(
      data, 60,
      '2026-10-09T10:00', '2026-10-09T13:00',
      '2026-10-09T12:00'
    );
    expect(r).not.toBeNull();
    // 13:00 is within [10:00, 13:00] and has the lowest score
    expect(r.recommendedWindow[0].time).toBe('2026-10-09T13:00');
  });

  it('handles 90-minute duration using a 2-hour slot', () => {
    const r = getBestTimeWindow(
      data, 90,
      '2026-10-09T10:00', '2026-10-09T13:00',
      '2026-10-09T10:00'
    );
    expect(r).not.toBeNull();
    expect(r.recommendedWindow).toHaveLength(2);
    // Windows: [10,11]=70, [11,12]=50, [12,13]=40 ← best
    expect(r.recommendedWindow[0].time).toBe('2026-10-09T12:00');
  });

  it('handles 30-minute duration (treated as 1-hour slot)', () => {
    const r = getBestTimeWindow(
      data, 30,
      '2026-10-09T10:00', '2026-10-09T13:00',
      '2026-10-09T10:00'
    );
    expect(r).not.toBeNull();
    expect(r.recommendedWindow).toHaveLength(1);
    expect(r.recommendedWindow[0].time).toBe('2026-10-09T13:00');
  });

  it('skips windows containing null scores', () => {
    const dataWithNull = [
      pt('2026-10-09T10:00', null, 100), // score null
      pt('2026-10-09T11:00', 20,   40),  // score 40
      pt('2026-10-09T12:00', 30,   60),  // score 60
    ];
    const r = getBestTimeWindow(
      dataWithNull, 60,
      '2026-10-09T10:00', '2026-10-09T12:00',
      '2026-10-09T10:00'
    );
    expect(r).not.toBeNull();
    // 10:00 is skipped due to null; 11:00 (score 40) is the best valid slot
    expect(r.recommendedWindow[0].time).toBe('2026-10-09T11:00');
  });

  it('returns null when all data has null scores', () => {
    const allNull = [
      pt('2026-10-09T10:00', null, null),
      pt('2026-10-09T11:00', null, null),
    ];
    const r = getBestTimeWindow(
      allNull, 60,
      '2026-10-09T10:00', '2026-10-09T11:00',
      '2026-10-09T10:00'
    );
    expect(r).toBeNull();
  });

  it('handles midnight boundary correctly', () => {
    const midnight = [
      pt('2026-10-09T23:00', 40, 60), // score 70
      pt('2026-10-10T00:00', 10, 20), // score 20 — crosses midnight
      pt('2026-10-10T01:00', 50, 80), // score 90
    ];
    const r = getBestTimeWindow(
      midnight, 60,
      '2026-10-09T23:00', '2026-10-10T01:00',
      '2026-10-09T23:00'
    );
    expect(r).not.toBeNull();
    expect(r.recommendedWindow[0].time).toBe('2026-10-10T00:00');
    expect(r.averageScore).toBe(20);
  });

  it('returns null when no future points exist', () => {
    const r = getBestTimeWindow(
      data, 60,
      '2026-10-09T10:00', '2026-10-09T13:00',
      '2026-10-09T14:00' // currentTime is after all data
    );
    expect(r).toBeNull();
  });

  it('labels quality correctly', () => {
    const good = [pt('2026-10-09T10:00', 10, 10)]; // score 15
    expect(
      getBestTimeWindow(good, 60, '2026-10-09T10:00', '2026-10-09T11:00', '2026-10-09T10:00')?.qualityLabel
    ).toBe('Good');

    const moderate = [pt('2026-10-09T10:00', 40, 40)]; // score 60
    expect(
      getBestTimeWindow(moderate, 60, '2026-10-09T10:00', '2026-10-09T11:00', '2026-10-09T10:00')?.qualityLabel
    ).toBe('Moderate');

    const poor = [pt('2026-10-09T10:00', 80, 80)]; // score 120
    expect(
      getBestTimeWindow(poor, 60, '2026-10-09T10:00', '2026-10-09T11:00', '2026-10-09T10:00')?.qualityLabel
    ).toBe('Poor');
  });

  it('message never claims safety for Poor quality', () => {
    const poor = [pt('2026-10-09T10:00', 80, 80)];
    const r = getBestTimeWindow(poor, 60, '2026-10-09T10:00', '2026-10-09T11:00', '2026-10-09T10:00');
    expect(r?.message).not.toMatch(/safe/i);
    expect(r?.message).toMatch(/comparative|caution|high|indoor/i);
  });
});
