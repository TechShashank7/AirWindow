import { describe, it, expect } from 'vitest';
import { calculatePollutionScore, getBestTimeWindow } from './recommendation';
import type { DataPoint } from './recommendation';

describe('recommendation algorithm', () => {
  it('should correctly calculate pollution score', () => {
    expect(calculatePollutionScore(10, 20)).toBe(20); // 10 + 0.5*20
    expect(calculatePollutionScore(null, null)).toBe(null);
    expect(calculatePollutionScore(10, null)).toBe(10);
  });

  it('should find the best time window within preferred range', () => {
    const data: DataPoint[] = [
      { time: '2026-10-09T10:00', pm25: 50, pm10: 100, score: 100 },
      { time: '2026-10-09T11:00', pm25: 20, pm10: 40, score: 40 },
      { time: '2026-10-09T12:00', pm25: 30, pm10: 60, score: 60 },
      { time: '2026-10-09T13:00', pm25: 10, pm10: 20, score: 20 }, // Best overall, but outside preferred
    ];

    const result = getBestTimeWindow(
      data,
      60, // 1 hour
      '2026-10-09T10:00',
      '2026-10-09T12:00',
      '2026-10-09T10:00'
    );

    expect(result).not.toBeNull();
    expect(result?.recommendedWindow[0].time).toBe('2026-10-09T11:00');
    expect(result?.averageScore).toBe(40);
    expect(result?.originalWindow).toBeNull();
  });

  it('should fallback to best overall if preferred range has no data or is missed', () => {
     const data: DataPoint[] = [
      { time: '2026-10-09T10:00', pm25: 50, pm10: 100, score: 100 },
      { time: '2026-10-09T11:00', pm25: 20, pm10: 40, score: 40 },
      { time: '2026-10-09T12:00', pm25: 30, pm10: 60, score: 60 },
    ];

    const result = getBestTimeWindow(
      data,
      60, // 1 hour
      '2026-10-09T15:00', // Preferred time is way in the future where we have no data
      '2026-10-09T16:00',
      '2026-10-09T10:00'
    );

    expect(result).not.toBeNull();
    expect(result?.recommendedWindow[0].time).toBe('2026-10-09T11:00');
    expect(result?.averageScore).toBe(40);
  });
});
