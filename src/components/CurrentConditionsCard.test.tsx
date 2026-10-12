import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CurrentConditionsCard } from './CurrentConditionsCard';
import * as currentAqiApi from '../api/currentAqiApi';
import type { LocationResult } from '../api/openmeteo';
import type { GoogleCurrentConditionsResponse } from '../api/currentAqiApi';

const mockLocation: LocationResult = {
  id: 1,
  name: 'New Delhi',
  latitude: 28.6139,
  longitude: 77.209,
  elevation: 216,
  country: 'India',
  timezone: 'Asia/Kolkata',
};

describe('CurrentConditionsCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders unconfigured / unavailable notice gracefully when backend returns null or unconfigured', async () => {
    vi.spyOn(currentAqiApi, 'fetchCurrentAirQuality').mockResolvedValue(null);

    render(<CurrentConditionsCard location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getByText(/Current Conditions & National AQI/i)).toBeInTheDocument();
      expect(
        screen.getByText(/Current atmospheric conditions and National AQI are currently unavailable/i)
      ).toBeInTheDocument();
    });
  });

  it('renders Indian National AQI, Universal AQI, pollutants, and health advisory correctly', async () => {
    const mockResponse: GoogleCurrentConditionsResponse = {
      configured: true,
      location: { latitude: 28.6139, longitude: 77.209 },
      measurementTimestamp: '2026-10-12T05:00:00Z',
      retrievedAt: '2026-10-12T05:15:00Z',
      ageHours: 0.2,
      indiaAqi: {
        code: 'ind_cpcb',
        displayName: 'NAQI (IN)',
        aqi: 79,
        category: 'Satisfactory air quality',
        dominantPollutant: 'co',
      },
      universalAqi: {
        code: 'uaqi',
        displayName: 'Universal AQI',
        aqi: 74,
        category: 'Good air quality',
        dominantPollutant: 'pm10',
      },
      pollutants: [
        { code: 'pm25', displayName: 'PM2.5', value: 15.2, units: 'µg/m³' },
        { code: 'pm10', displayName: 'PM10', value: 28.66, units: 'µg/m³' },
        { code: 'co', displayName: 'CO', value: 2223.17, units: 'ppb' },
      ],
      healthRecommendations: {
        generalPopulation: 'With this level of air quality, you have no limitations. Enjoy the outdoors!',
      },
      provenance: {
        provider: 'Google Maps Platform Air Quality API',
        methodology: 'Hyperlocal 500m derived model via Google Maps Platform Air Quality API.',
        isPhysicalStation: false,
      },
    };

    vi.spyOn(currentAqiApi, 'fetchCurrentAirQuality').mockResolvedValue(mockResponse);

    render(<CurrentConditionsCard location={mockLocation} />);

    await waitFor(() => {
      expect(screen.getByText('79')).toBeInTheDocument();
      expect(screen.getByText(/Satisfactory air quality/i)).toBeInTheDocument();
      expect(screen.getByText(/National AQI \(India \/ CPCB\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Universal AQI \(UAQI\):/i)).toBeInTheDocument();
      expect(screen.getByText(/74 \/ 100/i)).toBeInTheDocument();
      expect(screen.getByText(/With this level of air quality, you have no limitations/i)).toBeInTheDocument();
      expect(screen.getByText(/Hyperlocal 500m derived model/i)).toBeInTheDocument();
    });
  });
});
