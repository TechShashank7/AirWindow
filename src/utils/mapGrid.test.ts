import { describe, it, expect } from 'vitest';
import {
  GRID_OFFSETS,
  buildSpatialGridCoords,
  getTierForPM25,
  getTierForScore,
  getTierForPM10,
} from './mapGrid';

describe('mapGrid utilities', () => {
  it('defines 9 spatial offsets with center and 8 surrounding points', () => {
    expect(GRID_OFFSETS).toHaveLength(9);
    expect(GRID_OFFSETS[0].id).toBe('center');
    expect(GRID_OFFSETS[0].dLat).toBe(0);
    expect(GRID_OFFSETS[0].dLon).toBe(0);
  });

  it('buildSpatialGridCoords generates 9 coordinates around center', () => {
    const coords = buildSpatialGridCoords(28.6139, 77.209);
    expect(coords).toHaveLength(9);
    expect(coords[0].lat).toBe(28.6139);
    expect(coords[0].lon).toBe(77.209);
    // North offset +0.15
    expect(coords[1].lat).toBe(28.7639);
    expect(coords[1].lon).toBe(77.209);
  });

  it('correctly classifies PM2.5 into color-blind accessible tiers', () => {
    expect(getTierForPM25(null).tier).toBe('low');
    expect(getTierForPM25(10).tier).toBe('low');
    expect(getTierForPM25(15).tier).toBe('low');
    expect(getTierForPM25(25).tier).toBe('moderate');
    expect(getTierForPM25(35).tier).toBe('moderate');
    expect(getTierForPM25(55).tier).toBe('elevated');
    expect(getTierForPM25(75).tier).toBe('elevated');
    expect(getTierForPM25(120).tier).toBe('high');
  });

  it('correctly classifies relative scores into tiers', () => {
    expect(getTierForScore(null).tier).toBe('low');
    expect(getTierForScore(20).tier).toBe('low');
    expect(getTierForScore(40).tier).toBe('moderate');
    expect(getTierForScore(65).tier).toBe('elevated');
    expect(getTierForScore(95).tier).toBe('high');
  });

  it('correctly classifies PM10 into tiers', () => {
    expect(getTierForPM10(null).tier).toBe('low');
    expect(getTierForPM10(30).tier).toBe('low');
    expect(getTierForPM10(60).tier).toBe('moderate');
    expect(getTierForPM10(100).tier).toBe('elevated');
    expect(getTierForPM10(180).tier).toBe('high');
  });
});
