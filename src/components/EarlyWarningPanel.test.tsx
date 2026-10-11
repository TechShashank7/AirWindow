import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EarlyWarningPanel } from './EarlyWarningPanel';
import type { DataPoint } from '../utils/recommendation';

const mockDataPoints: DataPoint[] = [
  {
    time: '2026-10-11T12:00',
    pm25: 22.0,
    pm10: 45.0,
    windSpeed: 8,
    windDir: 180,
    score: 44.5,
  },
  {
    time: '2026-10-11T15:00',
    pm25: 68.5, // Spike >= 35
    pm10: 110.0,
    windSpeed: 5,
    windDir: 200,
    score: 123.5,
  },
  {
    time: '2026-10-11T18:00',
    pm25: 40.0,
    pm10: 80.0,
    windSpeed: 10,
    windDir: 210,
    score: 80.0,
  },
];

describe('EarlyWarningPanel', () => {
  it('renders a spike warning when peak PM2.5 exceeds 35 µg/m³', () => {
    const handleOpen = vi.fn();
    render(
      <EarlyWarningPanel
        dataPoints={mockDataPoints}
        locationName="Delhi"
        onOpenAlertModal={handleOpen}
      />
    );

    expect(screen.getByText(/Pollution spike expected in Delhi/i)).toBeInTheDocument();
    expect(screen.getAllByText(/68.5 µg\/m³/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Early Warning Spike/i)).toBeInTheDocument();
  });

  it('triggers onOpenAlertModal when user clicks the Set Air Alert button', () => {
    const handleOpen = vi.fn();
    render(
      <EarlyWarningPanel
        dataPoints={mockDataPoints}
        locationName="Delhi"
        onOpenAlertModal={handleOpen}
      />
    );

    const alertBtn = screen.getByRole('button', { name: /Set Air Alert for this spike/i });
    fireEvent.click(alertBtn);
    expect(handleOpen).toHaveBeenCalledTimes(1);
  });

  it('renders favorable condition when PM2.5 remains below 15 µg/m³', () => {
    const cleanPoints: DataPoint[] = [
      {
        time: '2026-10-11T12:00',
        pm25: 8.5,
        pm10: 15.0,
        windSpeed: 14,
        windDir: 180,
        score: 16.0,
      },
      {
        time: '2026-10-11T15:00',
        pm25: 11.2,
        pm10: 20.0,
        windSpeed: 12,
        windDir: 190,
        score: 21.2,
      },
    ];

    render(
      <EarlyWarningPanel
        dataPoints={cleanPoints}
        locationName="Geneva"
        onOpenAlertModal={vi.fn()}
      />
    );

    expect(screen.getByText(/Cleaner air window projected for Geneva/i)).toBeInTheDocument();
    expect(screen.getByText(/Favorable Conditions/i)).toBeInTheDocument();
  });
});
