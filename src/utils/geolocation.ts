import type { LocationResult } from '../api/openmeteo';
import { getGoogleMapsApiKey, loadGoogleMaps } from './googleMapsLoader';

export interface GeolocationError {
  code: 'UNSUPPORTED' | 'PERMISSION_DENIED' | 'POSITION_UNAVAILABLE' | 'TIMEOUT' | 'UNKNOWN';
  message: string;
}

/**
 * Prompts the browser for current one-shot GPS coordinates.
 * Strictly does not continuously track or monitor background location.
 */
export function getBrowserCoordinates(
  options: PositionOptions = { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
): Promise<{ latitude: number; longitude: number }> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      reject({
        code: 'UNSUPPORTED',
        message: 'Geolocation is not supported by your browser. Please search for your city manually.',
      } as GeolocationError);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        let code: GeolocationError['code'] = 'UNKNOWN';
        let message = 'Unable to determine your location. Please search for your city manually.';

        if (error.code === error.PERMISSION_DENIED) {
          code = 'PERMISSION_DENIED';
          message = 'Location access was denied. Please allow location permissions in your browser or search manually.';
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          code = 'POSITION_UNAVAILABLE';
          message = 'Location information is currently unavailable. Please check your device settings or search manually.';
        } else if (error.code === error.TIMEOUT) {
          code = 'TIMEOUT';
          message = 'Location request timed out. Please try again or search for your city manually.';
        }

        reject({ code, message } as GeolocationError);
      },
      options
    );
  });
}

/**
 * Resolves the official IANA timezone and locality details for the coordinates.
 * Priority 1: Google Maps Geocoder (if API key available).
 * Priority 2: Photon (OpenStreetMap) lightweight CORS reverse geocoder.
 * Priority 3: Formatted coordinate fallback.
 * Queries Open-Meteo for the accurate IANA timezone (timezone=auto).
 */
export async function reverseGeocodeCoordinates(
  lat: number,
  lon: number,
  apiKeyOverride?: string
): Promise<LocationResult> {
  const roundedLat = Number(lat.toFixed(4));
  const roundedLon = Number(lon.toFixed(4));

  // 1. Resolve IANA timezone via Open-Meteo (never assume browser timezone)
  let resolvedTimezone = 'UTC';
  try {
    const tzUrl = `https://api.open-meteo.com/v1/forecast?latitude=${roundedLat}&longitude=${roundedLon}&current_weather=true&timezone=auto`;
    const tzRes = await fetch(tzUrl);
    if (tzRes.ok) {
      const tzData = await tzRes.json();
      if (tzData.timezone && typeof tzData.timezone === 'string') {
        resolvedTimezone = tzData.timezone;
      }
    }
  } catch (tzErr) {
    console.warn('Failed to resolve timezone from Open-Meteo, falling back to local:', tzErr);
    resolvedTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  }

  // 2. Resolve place name: Tier 1 - Google Geocoder (if key available)
  let cityName = '';
  let countryName = '';
  let admin1Name = '';

  const activeKey = apiKeyOverride ?? getGoogleMapsApiKey();

  if (activeKey) {
    try {
      const google = await loadGoogleMaps(activeKey);
      if (google?.maps?.Geocoder) {
        const geocoder = new google.maps.Geocoder();
        const response = await geocoder.geocode({
          location: { lat: roundedLat, lng: roundedLon },
        });

        if (response.results && response.results.length > 0) {
          for (const res of response.results) {
            for (const comp of res.address_components) {
              if (
                !cityName &&
                (comp.types.includes('locality') ||
                  comp.types.includes('sublocality_level_1') ||
                  comp.types.includes('postal_town'))
              ) {
                cityName = comp.long_name;
              }
              if (!admin1Name && comp.types.includes('administrative_area_level_1')) {
                admin1Name = comp.long_name;
              }
              if (!countryName && comp.types.includes('country')) {
                countryName = comp.long_name;
              }
            }
            if (cityName && countryName) break;
          }
          if (!cityName && response.results[0]) {
            cityName = response.results[0].formatted_address.split(',')[0];
          }
        }
      }
    } catch (gErr) {
      console.warn('Google reverse geocoding lookup failed or unavailable; falling back to Photon:', gErr);
    }
  }

  // Tier 2: Photon (OpenStreetMap) if Google didn't return a locality name
  if (!cityName) {
    try {
      const reverseUrl = `https://photon.komoot.io/reverse?lat=${roundedLat}&lon=${roundedLon}`;
      const reverseRes = await fetch(reverseUrl);
      if (reverseRes.ok) {
        const geoJson = await reverseRes.json();
        const feature = geoJson?.features?.[0];
        if (feature && feature.properties) {
          const props = feature.properties;
          cityName = props.name || props.city || props.locality || props.district || '';
          if (!countryName) countryName = props.country || '';
          if (!admin1Name) admin1Name = props.state || props.county || '';
        }
      }
    } catch (revErr) {
      console.warn('Photon reverse geocoding lookup failed or unavailable; using coordinate label:', revErr);
    }
  }

  // Graceful fallback display name if reverse geocoding returns no locality
  const displayName = cityName || `Location (${roundedLat.toFixed(2)}°, ${roundedLon.toFixed(2)}°)`;

  return {
    id: Date.now(),
    name: displayName,
    latitude: roundedLat,
    longitude: roundedLon,
    elevation: 0,
    country: countryName,
    admin1: admin1Name,
    timezone: resolvedTimezone,
  };
}
