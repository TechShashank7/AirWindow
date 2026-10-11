import { buildSpatialGridCoords, getTierForPM25, type GridPoint } from '../utils/mapGrid';
import { calculatePollutionScore } from '../utils/recommendation';

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
    windspeed_10m?: (number | null)[];
    winddirection_10m?: (number | null)[];
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
  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm10,pm2_5&timezone=auto&forecast_days=2`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=windspeed_10m,winddirection_10m&timezone=auto&forecast_days=2`;
  
  const [aqRes, weatherRes] = await Promise.all([
    fetch(aqUrl),
    fetch(weatherUrl)
  ]);
  
  if (!aqRes.ok || !weatherRes.ok) {
    throw new Error('Failed to fetch forecast data from Open-Meteo');
  }
  
  const aqData = await aqRes.json();
  const weatherData = await weatherRes.json();
  
  // Merge the weather data into the air quality hourly array
  if (aqData.hourly && weatherData.hourly) {
    aqData.hourly.windspeed_10m = weatherData.hourly.windspeed_10m;
    aqData.hourly.winddirection_10m = weatherData.hourly.winddirection_10m;
  }
  
  return aqData;
}

export async function fetchSpatialForecastGrid(
  centerLat: number,
  centerLon: number,
  timezone: string = 'auto',
  targetLocalTime?: string
): Promise<GridPoint[]> {
  const coords = buildSpatialGridCoords(centerLat, centerLon);
  const latStr = coords.map((c) => c.lat).join(',');
  const lonStr = coords.map((c) => c.lon).join(',');

  const aqUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latStr}&longitude=${lonStr}&hourly=pm10,pm2_5&forecast_days=2&timezone=${encodeURIComponent(timezone)}`;
  const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${latStr}&longitude=${lonStr}&hourly=windspeed_10m,winddirection_10m&forecast_days=2&timezone=${encodeURIComponent(timezone)}`;

  const [aqRes, weatherRes] = await Promise.all([fetch(aqUrl), fetch(weatherUrl)]);

  if (!aqRes.ok || !weatherRes.ok) {
    throw new Error('Failed to fetch spatial grid data from Open-Meteo');
  }

  const rawAq = await aqRes.json();
  const rawWeather = await weatherRes.json();

  const aqList = Array.isArray(rawAq) ? rawAq : [rawAq];
  const weatherList = Array.isArray(rawWeather) ? rawWeather : [rawWeather];

  const targetHour = targetLocalTime ? targetLocalTime.substring(0, 13) : '';

  return coords.map((coord, idx) => {
    // Strictly read matching index without cross-point fallback
    const aqItem = aqList[idx];
    const weatherItem = weatherList[idx];

    // If point is missing from upstream API, strictly return null values (do not fabricate)
    if (!aqItem || !aqItem.hourly) {
      return {
        id: coord.id,
        label: coord.label,
        offsetName: coord.offsetName,
        latitude: coord.lat,
        longitude: coord.lon,
        pm25: null,
        pm10: null,
        score: null,
        windSpeed: null,
        windDir: null,
        forecastTime: targetLocalTime || new Date().toISOString(),
        sourceType: 'MODELLED_FORECAST' as const,
        tier: 'low' as const,
      };
    }

    const hourlyAq = aqItem.hourly;
    const hourlyWeather = weatherItem?.hourly || { windspeed_10m: [], winddirection_10m: [] };

    // Find the time index corresponding to target hour, or earliest available point
    let timeIdx = 0;
    if (targetHour && hourlyAq.time && hourlyAq.time.length > 0) {
      const foundIdx = hourlyAq.time.findIndex((t: string) => t.substring(0, 13) >= targetHour);
      timeIdx = foundIdx >= 0 ? foundIdx : hourlyAq.time.length - 1;
    }

    const pm25 = hourlyAq.pm2_5?.[timeIdx] ?? null;
    const pm10 = hourlyAq.pm10?.[timeIdx] ?? null;
    const windSpeed = hourlyWeather.windspeed_10m?.[timeIdx] ?? null;
    const windDir = hourlyWeather.winddirection_10m?.[timeIdx] ?? null;
    const forecastTime = hourlyAq.time?.[timeIdx] || targetLocalTime || new Date().toISOString();

    const score = calculatePollutionScore(pm25, pm10);
    const tier = getTierForPM25(pm25).tier;

    return {
      id: coord.id,
      label: coord.label,
      offsetName: coord.offsetName,
      latitude: typeof aqItem.latitude === 'number' ? aqItem.latitude : coord.lat,
      longitude: typeof aqItem.longitude === 'number' ? aqItem.longitude : coord.lon,
      pm25,
      pm10,
      score,
      windSpeed,
      windDir,
      forecastTime,
      sourceType: 'MODELLED_FORECAST' as const,
      tier,
    };
  });
}
