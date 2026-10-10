/**
 * evaluateApi.ts
 *
 * Thin frontend client for the /evaluate Lambda endpoint.
 * Only called when VITE_EVALUATE_API_URL is defined in the build environment.
 * If the env var is absent, App.tsx falls back to the existing local computation.
 *
 * No secrets live here — the API Gateway URL is public by design.
 */

export interface EvaluateRequest {
  latitude: number;
  longitude: number;
  timezone: string;
  durationMinutes: 30 | 60 | 90;
  preferredStart: string;   // "YYYY-MM-DDTHH:MM"
  preferredEnd: string;     // "YYYY-MM-DDTHH:MM"
  currentTime: string;      // "YYYY-MM-DDTHH:MM"
}

export interface EvaluateResponse {
  metadata: {
    location: { lat: number; lon: number; timezone: string };
    units: { pm25: string; pm10: string; windSpeed: string; windDir: string };
    retrievedAt: string;
    isStale: boolean;
    sources: string[];
  };
  data: Array<{
    time: string;
    pm25: number | null;
    pm10: number | null;
    windSpeed: number | null;
    windDir: number | null;
    score: number | null;
  }>;
  recommendation: {
    recommendedWindow: Array<{ time: string; pm25: number | null; pm10: number | null; score: number | null }>;
    averageScore: number;
    isInPreferredRange: boolean;
    qualityLabel: 'Good' | 'Moderate' | 'Poor';
    message: string;
    originalWindow: Array<{ time: string }> | null;
    originalAverageScore: number | null;
  } | null;
  scoreFormula: string;
  disclaimer: string;
}

const EVALUATE_URL = import.meta.env.VITE_EVALUATE_API_URL as string | undefined;

export function isBackendEnabled(): boolean {
  return Boolean(EVALUATE_URL);
}

export async function callEvaluateApi(req: EvaluateRequest): Promise<EvaluateResponse> {
  if (!EVALUATE_URL) {
    throw new Error('VITE_EVALUATE_API_URL is not configured.');
  }

  const res = await fetch(`${EVALUATE_URL}/evaluate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  return res.json();
}
