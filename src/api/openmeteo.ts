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
