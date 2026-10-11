export type PollutionTier = 'low' | 'moderate' | 'elevated' | 'high';

export interface GridPointOffset {
  id: string;
  label: string;
  offsetName: string;
  dLat: number;
  dLon: number;
}

export interface GridPoint {
  id: string;
  label: string;
  offsetName: string;
  latitude: number;
  longitude: number;
  pm25: number | null;
  pm10: number | null;
  score: number | null;
  windSpeed: number | null;
  windDir: number | null;
  forecastTime: string;
  sourceType: 'MODELLED_FORECAST';
  tier: PollutionTier;
}

export interface TierInfo {
  tier: PollutionTier;
  label: string;
  color: string;
  bg: string;
  border: string;
}

/**
 * 9 Spatial offsets surrounding the target city coordinate (~15-18 km distance)
 */
export const GRID_OFFSETS: GridPointOffset[] = [
  { id: 'center', label: 'City Center', offsetName: 'Center', dLat: 0, dLon: 0 },
  { id: 'north', label: 'North', offsetName: 'North (~17 km)', dLat: 0.15, dLon: 0 },
  { id: 'northeast', label: 'North-East', offsetName: 'North-East (~17 km)', dLat: 0.11, dLon: 0.12 },
  { id: 'east', label: 'East', offsetName: 'East (~17 km)', dLat: 0, dLon: 0.15 },
  { id: 'southeast', label: 'South-East', offsetName: 'South-East (~17 km)', dLat: -0.11, dLon: 0.12 },
  { id: 'south', label: 'South', offsetName: 'South (~17 km)', dLat: -0.15, dLon: 0 },
  { id: 'southwest', label: 'South-West', offsetName: 'South-West (~17 km)', dLat: -0.11, dLon: -0.12 },
  { id: 'west', label: 'West', offsetName: 'West (~17 km)', dLat: 0, dLon: -0.15 },
  { id: 'northwest', label: 'North-West', offsetName: 'North-West (~17 km)', dLat: 0.11, dLon: -0.12 },
];

/**
 * Color-blind accessible palette:
 * Low: Calm Teal/Blue (#0284c7)
 * Moderate: Warm Amber (#d97706)
 * Elevated: Coral Rust (#ea580c)
 * High: Deep Violet/Plum (#9333ea)
 */
export function getTierForPM25(pm25: number | null): TierInfo {
  if (pm25 === null) {
    return { tier: 'low', label: 'Unknown', color: '#94a3b8', bg: '#f1f5f9', border: '#cbd5e1' };
  }
  if (pm25 <= 15) {
    return { tier: 'low', label: 'Low (0-15 µg/m³)', color: '#0284c7', bg: '#e0f2fe', border: '#7dd3fc' };
  }
  if (pm25 <= 35) {
    return { tier: 'moderate', label: 'Moderate (15-35 µg/m³)', color: '#d97706', bg: '#fef3c7', border: '#fcd34d' };
  }
  if (pm25 <= 75) {
    return { tier: 'elevated', label: 'Elevated (35-75 µg/m³)', color: '#ea580c', bg: '#ffedd5', border: '#fdba74' };
  }
  return { tier: 'high', label: 'High (>75 µg/m³)', color: '#9333ea', bg: '#f3e8ff', border: '#d8b4fe' };
}

export function getTierForScore(score: number | null): TierInfo {
  if (score === null) {
    return { tier: 'low', label: 'Unknown', color: '#94a3b8', bg: '#f1f5f9', border: '#cbd5e1' };
  }
  if (score <= 25) {
    return { tier: 'low', label: 'Low (Score ≤ 25)', color: '#0284c7', bg: '#e0f2fe', border: '#7dd3fc' };
  }
  if (score <= 50) {
    return { tier: 'moderate', label: 'Moderate (25-50)', color: '#d97706', bg: '#fef3c7', border: '#fcd34d' };
  }
  if (score <= 85) {
    return { tier: 'elevated', label: 'Elevated (50-85)', color: '#ea580c', bg: '#ffedd5', border: '#fdba74' };
  }
  return { tier: 'high', label: 'High (> 85)', color: '#9333ea', bg: '#f3e8ff', border: '#d8b4fe' };
}

export function getTierForPM10(pm10: number | null): TierInfo {
  if (pm10 === null) {
    return { tier: 'low', label: 'Unknown', color: '#94a3b8', bg: '#f1f5f9', border: '#cbd5e1' };
  }
  if (pm10 <= 45) {
    return { tier: 'low', label: 'Low (0-45 µg/m³)', color: '#0284c7', bg: '#e0f2fe', border: '#7dd3fc' };
  }
  if (pm10 <= 80) {
    return { tier: 'moderate', label: 'Moderate (45-80 µg/m³)', color: '#d97706', bg: '#fef3c7', border: '#fcd34d' };
  }
  if (pm10 <= 150) {
    return { tier: 'elevated', label: 'Elevated (80-150 µg/m³)', color: '#ea580c', bg: '#ffedd5', border: '#fdba74' };
  }
  return { tier: 'high', label: 'High (>150 µg/m³)', color: '#9333ea', bg: '#f3e8ff', border: '#d8b4fe' };
}

/**
 * Generate coordinates for 9 spatial points around the center
 */
export function buildSpatialGridCoords(centerLat: number, centerLon: number): {
  id: string;
  label: string;
  offsetName: string;
  lat: number;
  lon: number;
}[] {
  return GRID_OFFSETS.map((offset) => ({
    id: offset.id,
    label: offset.label,
    offsetName: offset.offsetName,
    lat: Number((centerLat + offset.dLat).toFixed(4)),
    lon: Number((centerLon + offset.dLon).toFixed(4)),
  }));
}
