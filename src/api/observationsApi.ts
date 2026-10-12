/**
 * observationsApi.ts
 *
 * Frontend client for genuine ground-monitoring station observations.
 * Queries the backend observation API (OpenAQ v3 proxy with DynamoDB caching).
 *
 * Strict Data Integrity:
 * - Never invents synthetic station coordinates or values.
 * - Preserves provider attribution, units, and timestamps.
 * - Clearly categorizes stale or outdated measurements.
 */

export interface StationMeasurement {
  pollutant: 'PM2.5' | 'PM10';
  value: number | null;
  unit: string;
  timestamp: string | null;
  localTimestamp: string | null;
  freshness: 'RECENT' | 'MODERATE' | 'STALE' | 'OUTDATED' | 'UNKNOWN';
  freshnessLabel: string;
  ageHours: number | null;
}

export interface GroundStation {
  stationId: string;
  stationName: string;
  coordinates: {
    latitude: number;
    longitude: number;
  };
  distanceKm: number;
  provider: string;
  country: string;
  timezone: string;
  measurements: StationMeasurement[];
}

export interface ObservationsResponse {
  location: {
    latitude: number;
    longitude: number;
  };
  searchRadiusKm: number;
  stationCount: number;
  stations: GroundStation[];
  providerConfigured: boolean;
  retrievedAt: string;
  disclaimer: string;
  cached?: boolean;
  warning?: string;
}

function getBaseUrl(): string {
  const url = import.meta.env.VITE_EVALUATE_API_URL as string | undefined;
  return (url || '').replace(/\/+$/, '');
}

export function isBackendEnabled(): boolean {
  return Boolean(import.meta.env.VITE_EVALUATE_API_URL);
}

/**
 * Retrieves nearby ground monitoring stations from the backend observation proxy.
 */
export async function fetchGroundObservations(
  lat: number,
  lon: number,
  radiusKm = 25
): Promise<ObservationsResponse> {
  const baseUrl = getBaseUrl();

  if (!baseUrl) {
    return {
      location: { latitude: lat, longitude: lon },
      searchRadiusKm: radiusKm,
      stationCount: 0,
      stations: [],
      providerConfigured: false,
      retrievedAt: new Date().toISOString(),
      disclaimer: 'Backend observation service is unconfigured. Set VITE_EVALUATE_API_URL to enable.',
    };
  }

  // Strategy 1: Dedicated GET /observations endpoint
  try {
    const getUrl = `${baseUrl}/observations?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius=${encodeURIComponent(radiusKm)}`;
    const res = await fetch(getUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const data: ObservationsResponse = await res.json();
      return data;
    }

    // If 404, the dedicated route might not be mapped yet in API Gateway; try evaluate route
    if (res.status === 404) {
      // Strategy 2: Call evaluate endpoint with includeObservations: true
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const currentTime = `${today}T${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}`;
      const preferredStart = `${today}T06:00`;
      const preferredEnd = `${today}T22:00`;

      const evalRes = await fetch(`${baseUrl}/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: lat,
          longitude: lon,
          timezone: 'UTC',
          durationMinutes: 60,
          preferredStart,
          preferredEnd,
          currentTime,
          includeObservations: true,
          observationRadiusKm: radiusKm,
        }),
      });

      if (evalRes.ok) {
        const evalData = await evalRes.json();
        if (evalData.observations) {
          return evalData.observations as ObservationsResponse;
        }
      }
    }
  } catch (err) {
    console.warn('Observation fetch encountered network failure:', err);
  }

  return {
    location: { latitude: lat, longitude: lon },
    searchRadiusKm: radiusKm,
    stationCount: 0,
    stations: [],
    providerConfigured: false,
    retrievedAt: new Date().toISOString(),
    disclaimer: 'Ground observation data is currently unavailable for this location.',
  };
}
