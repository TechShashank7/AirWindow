export interface LocationResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number;
  country: string;
  admin1?: string;
  timezone: string;
}

export interface AirQualityForecast {
  latitude: number;
  longitude: number;
  timezone: string;
  hourly: {
    time: string[];
    pm10: (number | null)[];
    pm2_5: (number | null)[];
  };
}

export async function searchLocations(query: string): Promise<LocationResult[]> {
  if (!query) return [];
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch locations');
  }
  const data = await res.json();
  return data.results || [];
}

export async function getAirQualityForecast(lat: number, lon: number): Promise<AirQualityForecast> {
  const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm10,pm2_5&timezone=auto&forecast_days=2`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error('Failed to fetch air quality forecast');
  }
  return await res.json();
}
