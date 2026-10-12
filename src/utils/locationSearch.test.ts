import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  searchLocationsWithFallback,
  resolveLocationCoordinates,
  type SearchResultItem,
} from './locationSearch';
import * as openMeteoApi from '../api/openmeteo';
import * as googleLoader from './googleMapsLoader';

describe('locationSearch utility', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchLocationsWithFallback', () => {
    it('returns empty array for empty query', async () => {
      const res = await searchLocationsWithFallback('   ');
      expect(res).toEqual([]);
    });

    it('falls back to Open-Meteo when no Google Maps API key is configured', async () => {
      vi.spyOn(googleLoader, 'getGoogleMapsApiKey').mockReturnValue('');
      const mockOpenMeteoResults: openMeteoApi.LocationResult[] = [
        {
          id: 101,
          name: 'London',
          latitude: 51.5074,
          longitude: -0.1278,
          elevation: 25,
          country: 'United Kingdom',
          admin1: 'England',
          timezone: 'Europe/London',
        },
      ];
      vi.spyOn(openMeteoApi, 'searchLocations').mockResolvedValue(mockOpenMeteoResults);

      const res = await searchLocationsWithFallback('London');

      expect(res).toHaveLength(1);
      expect(res[0].name).toBe('London');
      expect(res[0].source).toBe('openmeteo');
      expect(openMeteoApi.searchLocations).toHaveBeenCalledWith('London');
    });

    it('uses Google Places AutocompleteService when Google API key is available', async () => {
      const mockPredictions = [
        {
          place_id: 'place_delhi_123',
          description: 'Delhi, India',
          structured_formatting: {
            main_text: 'Delhi',
            secondary_text: 'India',
          },
        },
      ];

      const mockGetPlacePredictions = vi.fn((_opts, callback) => {
        callback(mockPredictions, 'OK');
      });

      class MockAutocompleteService {
        getPlacePredictions = mockGetPlacePredictions;
      }

      const mockGoogle = {
        maps: {
          places: {
            AutocompleteService: MockAutocompleteService,
            PlacesServiceStatus: { OK: 'OK' },
          },
        },
      };

      vi.spyOn(googleLoader, 'loadGoogleMaps').mockResolvedValue(mockGoogle as any);

      const res = await searchLocationsWithFallback('Delhi', 'fake-google-key');

      expect(res).toHaveLength(1);
      expect(res[0].name).toBe('Delhi');
      expect(res[0].country).toBe('India');
      expect(res[0].placeId).toBe('place_delhi_123');
      expect(res[0].source).toBe('google');
      expect(mockGetPlacePredictions).toHaveBeenCalled();
    });

    it('falls back to Open-Meteo if Google Places throws or fails', async () => {
      vi.spyOn(googleLoader, 'loadGoogleMaps').mockRejectedValue(new Error('Google Maps script error'));
      const mockOpenMeteoResults: openMeteoApi.LocationResult[] = [
        {
          id: 202,
          name: 'Tokyo',
          latitude: 35.6762,
          longitude: 139.6503,
          elevation: 40,
          country: 'Japan',
          timezone: 'Asia/Tokyo',
        },
      ];
      vi.spyOn(openMeteoApi, 'searchLocations').mockResolvedValue(mockOpenMeteoResults);

      const res = await searchLocationsWithFallback('Tokyo', 'fake-key');

      expect(res).toHaveLength(1);
      expect(res[0].name).toBe('Tokyo');
      expect(res[0].source).toBe('openmeteo');
    });
  });

  describe('resolveLocationCoordinates', () => {
    it('returns existing item directly if coordinates are already set with valid timezone', async () => {
      const item: SearchResultItem = {
        id: 303,
        name: 'Berlin',
        latitude: 52.52,
        longitude: 13.405,
        elevation: 34,
        country: 'Germany',
        admin1: 'Berlin',
        timezone: 'Europe/Berlin',
      };

      const resolved = await resolveLocationCoordinates(item);
      expect(resolved).toEqual(item);
    });

    it('resolves placeId via Google Geocoder when coordinates are zero', async () => {
      const item: SearchResultItem = {
        id: 404,
        name: 'Sydney',
        latitude: 0,
        longitude: 0,
        elevation: 0,
        country: 'Australia',
        timezone: 'UTC',
        placeId: 'place_sydney_abc',
        source: 'google',
      };

      class MockGeocoder {
        geocode = vi.fn((_opts) =>
          Promise.resolve({
            results: [
              {
                geometry: {
                  location: {
                    lat: () => -33.8688,
                    lng: () => 151.2093,
                  },
                },
                formatted_address: 'Sydney NSW, Australia',
                address_components: [
                  { long_name: 'Sydney', types: ['locality'] },
                  { long_name: 'New South Wales', types: ['administrative_area_level_1'] },
                  { long_name: 'Australia', types: ['country'] },
                ],
              },
            ],
          })
        );
      }

      const mockGoogle = {
        maps: {
          Geocoder: MockGeocoder,
        },
      };

      vi.spyOn(googleLoader, 'loadGoogleMaps').mockResolvedValue(mockGoogle as any);

      // Mock fetch for Open-Meteo timezone resolution
      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('api.open-meteo.com/v1/forecast')) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ timezone: 'Australia/Sydney' }),
          });
        }
        return Promise.reject(new Error(`Unhandled URL: ${url}`));
      });

      const resolved = await resolveLocationCoordinates(item, 'fake-google-key');

      expect(resolved.latitude).toBe(-33.8688);
      expect(resolved.longitude).toBe(151.2093);
      expect(resolved.timezone).toBe('Australia/Sydney');
      expect(resolved.name).toBe('Sydney');
      expect(resolved.admin1).toBe('New South Wales');
      expect(resolved.country).toBe('Australia');

      global.fetch = originalFetch;
    });
  });
});
