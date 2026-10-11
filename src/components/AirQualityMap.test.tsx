import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AirQualityMap } from './AirQualityMap';
import * as openMeteoApi from '../api/openmeteo';
import type { LocationResult } from '../api/openmeteo';
import type { GridPoint } from '../utils/mapGrid';

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

describe('AirQualityMap', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders map card with title, legend, and modelled forecast notice', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);

    render(<AirQualityMap location={mockLocation} />);

    expect(screen.getByText(/Local Air-Quality Forecast Map/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Spatial atmospheric dispersion points within ~20 km of New Delhi/i)
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText(/City Center/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('45.2')).toBeInTheDocument();
    });

    // Verify legend
    expect(screen.getByText(/Legend \(PM2.5\)/i)).toBeInTheDocument();

    // Verify Data Integrity Disclosure
    expect(screen.getByText(/Modelled Forecast/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Values are computed by Open-Meteo numerical atmospheric models/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Ground station monitoring is currently not available for this point/i)
    ).toBeInTheDocument();
  });

  it('allows switching metric between PM2.5, Relative Score, and PM10', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);

    render(<AirQualityMap location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getAllByText(/City Center/i).length).toBeGreaterThanOrEqual(1);
    });

    const scoreToggle = screen.getByRole('button', { name: /Relative Score/i });
    fireEvent.click(scoreToggle);

    expect(screen.getByText(/Legend \(Score\)/i)).toBeInTheDocument();
  });

  it('allows clicking grid cell to view different spatial points', async () => {
    vi.spyOn(openMeteoApi, 'fetchSpatialForecastGrid').mockResolvedValue(mockGridPoints);

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

    render(<AirQualityMap location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to load nearby forecast points/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry Grid/i })).toBeInTheDocument();
  });
});
