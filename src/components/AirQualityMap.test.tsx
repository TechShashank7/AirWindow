import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AirQualityMap } from './AirQualityMap';
import * as openMeteoApi from '../api/openmeteo';
import * as observationsApi from '../api/observationsApi';
import type { LocationResult } from '../api/openmeteo';
import type { GridPoint } from '../utils/mapGrid';
import type { ObservationsResponse } from '../api/observationsApi';

// Mock Leaflet methods so jsdom doesn't complain about missing SVG/Canvas methods
vi.mock('leaflet', () => {
  const dummyLayer = {
    addTo: vi.fn().mockReturnThis(),
    clearLayers: vi.fn(),
  };
  const dummyMap = {
    setView: vi.fn(),
    remove: vi.fn(),
    invalidateSize: vi.fn(),
  };

  return {
    default: {
      map: vi.fn(() => dummyMap),
      tileLayer: vi.fn(() => ({ addTo: vi.fn() })),
      layerGroup: vi.fn(() => dummyLayer),
      marker: vi.fn(() => ({
        on: vi.fn(),
        addTo: vi.fn(),
      })),
      divIcon: vi.fn(() => ({})),
    },
  };
});

const mockLocation: LocationResult = {
  id: 1,
  name: 'New Delhi',
  latitude: 28.6139,
  longitude: 77.209,
  elevation: 216,
  country: 'India',
  timezone: 'Asia/Kolkata',
};

const mockGridPoints: GridPoint[] = [
  {
    id: 'center',
    label: 'City Center',
    offsetName: 'Center',
    latitude: 28.6139,
    longitude: 77.209,
    pm25: 45.2,
    pm10: 88.0,
    score: 89.2,
    windSpeed: 10,
    windDir: 180,
    forecastTime: '2026-10-11T20:00',
    sourceType: 'MODELLED_FORECAST',
    tier: 'elevated',
  },
  {
    id: 'north',
    label: 'North',
    offsetName: 'North (~17 km)',
    latitude: 28.7639,
    longitude: 77.209,
    pm25: 65.0,
    pm10: 120.0,
    score: 125.0,
    windSpeed: 12,
    windDir: 190,
    forecastTime: '2026-10-11T20:00',
    sourceType: 'MODELLED_FORECAST',
    tier: 'elevated',
  },
];

const mockObservationResponse: ObservationsResponse = {
  location: { latitude: 28.6139, longitude: 77.209 },
  searchRadiusKm: 25,
  stationCount: 2,
  stations: [
    {
      stationId: 'st-rkpuram',
      stationName: 'R K Puram, Delhi - DPCC',
      coordinates: { latitude: 28.563, longitude: 77.186 },
      distanceKm: 6.1,
      provider: 'CPCB / OpenAQ',
      country: 'IN',
      timezone: 'Asia/Kolkata',
      measurements: [
        {
          pollutant: 'PM2.5',
          value: 48.0,
          unit: 'µg/m³',
          timestamp: '2026-10-12T02:00:00Z',
          localTimestamp: '2026-10-12T07:30',
          freshness: 'RECENT',
          freshnessLabel: 'Recent (<3h)',
          ageHours: 1.5,
        },
        {
          pollutant: 'PM10',
          value: 95.0,
          unit: 'µg/m³',
          timestamp: '2026-10-12T02:00:00Z',
          localTimestamp: '2026-10-12T07:30',
          freshness: 'RECENT',
          freshnessLabel: 'Recent (<3h)',
          ageHours: 1.5,
        },
      ],
    },
    {
      stationId: 'st-anandvihar',
      stationName: 'Anand Vihar, Delhi - DPCC',
      coordinates: { latitude: 28.647, longitude: 77.316 },
      distanceKm: 11.2,
      provider: 'CPCB / OpenAQ',
      country: 'IN',
      timezone: 'Asia/Kolkata',
      measurements: [
        {
          pollutant: 'PM2.5',
          value: 78.5,
          unit: 'µg/m³',
          timestamp: '2026-10-11T12:00:00Z',
          localTimestamp: '2026-10-11T17:30',
          freshness: 'STALE',
          freshnessLabel: 'Stale (12-48h)',
          ageHours: 15.5,
        },
      ],
    },
  ],
  providerConfigured: true,
  retrievedAt: '2026-10-12T07:30:00Z',
  disclaimer: 'Ground monitoring station measurements sourced via OpenAQ API v3.',
};

describe('AirQualityMap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders map card with layer tabs, forecast grid, and integrity notice', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);
    vi.spyOn(observationsApi, 'fetchGroundObservations').mockResolvedValue(mockObservationResponse);

    render(<AirQualityMap location={mockLocation} />);

    expect(screen.getByText(/Local Air-Quality Spatial Explorer/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Explore atmospheric model dispersion alongside physical monitoring observations/i)
    ).toBeInTheDocument();

    // Verify Layer selector tabs
    expect(screen.getByRole('tab', { name: /Modelled Forecast/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Ground Stations/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText(/City Center/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('45.2')).toBeInTheDocument();
    });

    // Verify legend
    expect(screen.getByText(/Forecast \(PM2.5\)/i)).toBeInTheDocument();

    // Verify Data Integrity Disclosure
    expect(screen.getAllByText(/Modelled Forecast/i).length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/Values are computed by Open-Meteo numerical atmospheric models/i)
    ).toBeInTheDocument();
  });

  it('allows switching to Ground-Station Observations layer with real station data', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);
    vi.spyOn(observationsApi, 'fetchGroundObservations').mockResolvedValue(mockObservationResponse);

    render(<AirQualityMap location={mockLocation} />);

    // Wait for initial data loading to resolve
    await waitFor(() => {
      expect(screen.getAllByText(/City Center/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    // Switch to Ground Stations tab
    const obsTab = screen.getByRole('tab', { name: /Ground Stations/i });
    fireEvent.click(obsTab);

    // Verify station details
    await waitFor(() => {
      expect(screen.getAllByText(/R K Puram, Delhi - DPCC/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Source: CPCB \/ OpenAQ/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Recent \(<3h\)/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText(/48\.0/).length).toBeGreaterThanOrEqual(1);
    });

    // Verify Physical Ground Monitor disclosure
    expect(screen.getByText(/Physical Ground Monitor/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Measurements are sourced from public ground equipment via OpenAQ/i)
    ).toBeInTheDocument();

    // Verify Model vs Ground Station comparison and non-validation disclaimer
    expect(screen.getByText(/Observation vs Nearby Model Grid/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Differences do not constitute formal model validation/i)
    ).toBeInTheDocument();
  });

  it('displays stale badge when a station has older measurements', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);
    vi.spyOn(observationsApi, 'fetchGroundObservations').mockResolvedValue(mockObservationResponse);

    render(<AirQualityMap location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getByText('2')).toBeInTheDocument();
    });

    const obsTab = screen.getByRole('tab', { name: /Ground Stations/i });
    fireEvent.click(obsTab);

    await waitFor(() => {
      expect(screen.getAllByText(/Anand Vihar, Delhi - DPCC/i).length).toBeGreaterThanOrEqual(1);
    });

    // Click Anand Vihar pill in quick-selector
    const anandPill = screen.getByRole('button', { name: /Anand Vihar, Delhi - DPCC/i });
    fireEvent.click(anandPill);

    // Should display stale badge
    await waitFor(() => {
      expect(screen.getByText(/Stale \(12-48h\)/i)).toBeInTheDocument();
      expect(screen.getAllByText(/78\.5/).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('handles empty stations gracefully without fabricating data', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);
    vi.spyOn(observationsApi, 'fetchGroundObservations').mockResolvedValue({
      location: { latitude: 28.6139, longitude: 77.209 },
      searchRadiusKm: 25,
      stationCount: 0,
      stations: [],
      providerConfigured: true,
      retrievedAt: '2026-10-12T07:30:00Z',
      disclaimer: 'No stations nearby.',
    });

    render(<AirQualityMap location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getAllByText(/City Center/i).length).toBeGreaterThanOrEqual(1);
    });

    const obsTab = screen.getByRole('tab', { name: /Ground Stations/i });
    fireEvent.click(obsTab);

    await waitFor(() => {
      expect(screen.getByText(/No Certified Ground Stations Nearby/i)).toBeInTheDocument();
      expect(
        screen.getByText(/No public ground-monitoring stations were found within 25 km of New Delhi/i)
      ).toBeInTheDocument();
    });
  });

  it('allows switching metric between PM2.5, Relative Score, and PM10 in forecast mode', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);
    vi.spyOn(observationsApi, 'fetchGroundObservations').mockResolvedValue(mockObservationResponse);

    render(<AirQualityMap location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getAllByText(/City Center/i).length).toBeGreaterThanOrEqual(1);
    });

    const scoreToggle = screen.getByRole('button', { name: /Relative Score/i });
    fireEvent.click(scoreToggle);

    expect(screen.getByText(/Forecast \(Score\)/i)).toBeInTheDocument();
  });

  it('allows clicking grid cell to view different spatial points', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);
    vi.spyOn(observationsApi, 'fetchGroundObservations').mockResolvedValue(mockObservationResponse);

    render(<AirQualityMap location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getAllByText(/City Center/i).length).toBeGreaterThanOrEqual(1);
    });

    // Click "North" quick select pill
    const northPill = screen.getByRole('button', { name: /North/i });
    fireEvent.click(northPill);

    expect(screen.getByText(/North \(North \(~17 km\)\)/i)).toBeInTheDocument();
    expect(screen.getByText('65.0')).toBeInTheDocument();
  });

  it('renders error state when grid fetch fails', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockRejectedValue(new Error('Network error'));
    vi.spyOn(observationsApi, 'fetchGroundObservations').mockResolvedValue(mockObservationResponse);

    render(<AirQualityMap location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to load nearby forecast points/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry Grid/i })).toBeInTheDocument();
  });

  it('displays outdated alert banner and disables numerical comparison when all stations are >48h old', async () => {
    const outdatedResponse: ObservationsResponse = {
      location: { latitude: 28.6139, longitude: 77.209 },
      searchRadiusKm: 25,
      stationCount: 1,
      stations: [
        {
          stationId: 'st-old',
          stationName: 'Dormant Station',
          coordinates: { latitude: 28.563, longitude: 77.186 },
          distanceKm: 6.1,
          provider: 'CPCB / OpenAQ',
          country: 'IN',
          timezone: 'Asia/Kolkata',
          measurements: [
            {
              pollutant: 'PM2.5',
              value: 110.0,
              unit: 'µg/m³',
              timestamp: '2026-10-07T14:30:00Z',
              localTimestamp: '2026-10-07T20:00',
              freshness: 'OUTDATED',
              freshnessLabel: '5d ago (Outdated)',
              ageHours: 110.0,
            },
          ],
        },
      ],
      providerConfigured: true,
      retrievedAt: '2026-10-12T07:30:00Z',
      disclaimer: 'Ground monitoring station measurements sourced via OpenAQ API v3.',
    };

    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);
    vi.spyOn(observationsApi, 'fetchGroundObservations').mockResolvedValue(outdatedResponse);

    render(<AirQualityMap location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    const obsTab = screen.getByRole('tab', { name: /Ground Stations/i });
    fireEvent.click(obsTab);

    await waitFor(() => {
      expect(screen.getByText(/All Nearby Monitoring Stations Report Outdated Data/i)).toBeInTheDocument();
      expect(screen.getByText(/Direct Comparison Disabled/i)).toBeInTheDocument();
      expect(screen.getByText(/5d ago \(Outdated\)/i)).toBeInTheDocument();
    });
  });
});
