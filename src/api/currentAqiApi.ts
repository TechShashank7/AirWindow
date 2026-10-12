/**
 * currentAqiApi.ts
 *
 * Client for Google Maps Platform Air Quality current-conditions and Indian AQI enrichment.
 * Proxied securely through the AWS Lambda backend.
 *
 * Security:
 * - Keeps GOOGLE_MAPS_API_KEY on the backend only.
 * - Does not call Google directly from the browser.
 */

export interface GoogleAQIndex {
  code: string;
  displayName: string;
  aqi: number | null;
  category: string;
  dominantPollutant?: string | null;
}

export interface GooglePollutant {
  code: string;
  displayName: string;
  value: number;
  units: string;
}

export interface GoogleCurrentConditionsResponse {
  configured: boolean;
  location: {
    latitude: number;
    longitude: number;
  };
  regionCode?: string | null;
  measurementTimestamp: string | null;
  retrievedAt: string;
  ageHours: number | null;
  indiaAqi: GoogleAQIndex | null;
  universalAqi: GoogleAQIndex | null;
  otherIndexes?: GoogleAQIndex[];
  pollutants: GooglePollutant[];
  healthRecommendations: {
    generalPopulation?: string;
    elderly?: string;
    lungDiseasePopulation?: string;
    heartDiseasePopulation?: string;
    athletes?: string;
    pregnantWomen?: string;
    children?: string;
  } | null;
  provenance: {
    provider: string;
    methodology: string;
    isPhysicalStation: boolean;
  };
  cached?: boolean;
  isStale?: boolean;
  warning?: string;
  error?: {
    code: string;
    message: string;
  };
}

function getBaseUrl(): string {
  const url = import.meta.env.VITE_EVALUATE_API_URL as string | undefined;
  return (url || '').replace(/\/+$/, '');
}

/**
 * Fetches current air quality conditions via backend proxy
 */
export async function fetchCurrentAirQuality(
  lat: number,
  lon: number
): Promise<GoogleCurrentConditionsResponse | null> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return null;
  }

  // Strategy 1: Dedicated GET /current-aqi route
  try {
    const directUrl = `${baseUrl}/current-aqi?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`;
    const res = await fetch(directUrl, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (res.ok) {
      const data: GoogleCurrentConditionsResponse = await res.json();
      return data;
    }

    // If 404, route might not be mapped in API Gateway; try fallback via /evaluate
    if (res.status === 404) {
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
          includeCurrentAqi: true,
        }),
      });

      if (evalRes.ok) {
        const evalData = await evalRes.json();
        if (evalData.currentAqi) {
          return evalData.currentAqi as GoogleCurrentConditionsResponse;
        }
      }
    }
  } catch (err) {
    console.warn('Current air quality fetch encountered an issue:', err);
  }

  return null;
}
