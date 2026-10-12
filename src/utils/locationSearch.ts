import type { LocationResult } from '../api/openmeteo';
import { searchLocations } from '../api/openmeteo';
import { getGoogleMapsApiKey, loadGoogleMaps } from './googleMapsLoader';

export interface SearchResultItem extends LocationResult {
  placeId?: string;
  source?: 'google' | 'openmeteo';
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * Searches for locations using Google Places / Geocoder if available,
 * with resilient fallback to Open-Meteo.
 */
export async function searchLocationsWithFallback(
  query: string,
  apiKeyOverride?: string
): Promise<SearchResultItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const apiKey = apiKeyOverride ?? getGoogleMapsApiKey();

  if (apiKey) {
    try {
      const google = await loadGoogleMaps(apiKey);

      // Strategy 1: Google Places AutocompleteService
      if (google?.maps?.places?.AutocompleteService) {
        const service = new google.maps.places.AutocompleteService();
        const predictions = await new Promise<google.maps.places.AutocompletePrediction[] | null>(
          (resolve) => {
            service.getPlacePredictions(
              {
                input: trimmed,
                types: ['geocode'],
              },
              (results, status) => {
                if (status === google.maps.places.PlacesServiceStatus.OK && results) {
                  resolve(results);
                } else {
                  resolve(null);
                }
              }
            );
          }
        );

        if (predictions && predictions.length > 0) {
          return predictions.slice(0, 6).map((p, idx) => ({
            id: Math.abs(hashString(p.place_id || `${p.description}_${idx}`)),
            name: p.structured_formatting?.main_text || p.description.split(',')[0],
            latitude: 0,
            longitude: 0,
            elevation: 0,
            country: p.structured_formatting?.secondary_text || '',
            admin1: '',
            timezone: 'UTC',
            placeId: p.place_id,
            source: 'google',
          }));
        }
      }

      // Strategy 2: Google Geocoder (if places returned no results or is not available)
      if (google?.maps?.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        const res = await geocoder.geocode({ address: trimmed });
        if (res.results && res.results.length > 0) {
          return res.results.slice(0, 6).map((r, idx) => {
            let city = '';
            let admin1 = '';
            let country = '';
            for (const comp of r.address_components) {
              if (
                !city &&
                (comp.types.includes('locality') ||
                  comp.types.includes('sublocality_level_1') ||
                  comp.types.includes('postal_town'))
              ) {
                city = comp.long_name;
              }
              if (!admin1 && comp.types.includes('administrative_area_level_1')) {
                admin1 = comp.long_name;
              }
              if (!country && comp.types.includes('country')) {
                country = comp.long_name;
              }
            }
            return {
              id: Math.abs(hashString(r.place_id || `${r.formatted_address}_${idx}`)),
              name: city || r.formatted_address.split(',')[0],
              latitude: Number(r.geometry.location.lat().toFixed(4)),
              longitude: Number(r.geometry.location.lng().toFixed(4)),
              elevation: 0,
              country,
              admin1,
              timezone: 'UTC',
              placeId: r.place_id,
              source: 'google',
            };
          });
        }
      }
    } catch (gErr) {
      console.warn('Google location search encountered an issue, falling back to Open-Meteo:', gErr);
    }
  }

  // Fallback: Open-Meteo geocoding search
  const openMeteoResults = await searchLocations(trimmed);
  return openMeteoResults.map((item) => ({
    ...item,
    source: 'openmeteo',
  }));
}

/**
 * Resolves full geographic coordinates and timezone for a selected search result item.
 */
export async function resolveLocationCoordinates(
  item: SearchResultItem,
  apiKeyOverride?: string
): Promise<LocationResult> {
  // If coordinates are already non-zero (e.g. Open-Meteo or Google Geocoder direct result)
  if (item.latitude !== 0 || item.longitude !== 0) {
    if (item.timezone && item.timezone !== 'UTC') {
      return item;
    }
    try {
      const tzUrl = `https://api.open-meteo.com/v1/forecast?latitude=${item.latitude}&longitude=${item.longitude}&current_weather=true&timezone=auto`;
      const tzRes = await fetch(tzUrl);
      if (tzRes.ok) {
        const tzData = await tzRes.json();
        if (tzData.timezone) {
          return { ...item, timezone: tzData.timezone };
        }
      }
    } catch {
      // ignore
    }
    return item;
  }

  // If item came from Google Places autocomplete with placeId:
  const apiKey = apiKeyOverride ?? getGoogleMapsApiKey();
  if (item.placeId && apiKey) {
    try {
      const google = await loadGoogleMaps(apiKey);
      if (google?.maps?.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        const res = await geocoder.geocode({ placeId: item.placeId });
        if (res.results && res.results.length > 0) {
          const r = res.results[0];
          const lat = Number(r.geometry.location.lat().toFixed(4));
          const lon = Number(r.geometry.location.lng().toFixed(4));

          let city = '';
          let admin1 = '';
          let country = '';
          for (const comp of r.address_components) {
            if (
              !city &&
              (comp.types.includes('locality') ||
                comp.types.includes('sublocality_level_1') ||
                comp.types.includes('postal_town'))
            ) {
              city = comp.long_name;
            }
            if (!admin1 && comp.types.includes('administrative_area_level_1')) {
              admin1 = comp.long_name;
            }
            if (!country && comp.types.includes('country')) {
              country = comp.long_name;
            }
          }

          // Fetch canonical IANA timezone for the resolved coordinates
          let tz = 'UTC';
          try {
            const tzRes = await fetch(
              `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true&timezone=auto`
            );
            if (tzRes.ok) {
              const tzData = await tzRes.json();
              if (tzData.timezone) tz = tzData.timezone;
            }
          } catch {
            // ignore
          }

          return {
            id: item.id,
            name: city || item.name,
            latitude: lat,
            longitude: lon,
            elevation: 0,
            country: country || item.country,
            admin1: admin1 || item.admin1,
            timezone: tz,
          };
        }
      }
    } catch (err) {
      console.warn('Failed to resolve placeId with Google, falling back to query search:', err);
    }
  }

  // Secondary fallback: query Open-Meteo for the item's name
  try {
    const omResults = await searchLocations(item.name);
    if (omResults.length > 0) {
      return omResults[0];
    }
  } catch {
    // ignore
  }

  return item;
}
