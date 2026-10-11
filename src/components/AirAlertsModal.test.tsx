import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AirAlertsModal } from './AirAlertsModal';
import * as alertsApi from '../api/alertsApi';

vi.mock('../api/alertsApi', () => ({
  createAlert: vi.fn(),
  verifyAlert: vi.fn(),
  manageAlert: vi.fn(),
}));

describe('AirAlertsModal Component', () => {
  const mockLocation = {
    id: 1,
    name: 'London',
    latitude: 51.5,
    longitude: -0.12,
    elevation: 25,
    country: 'United Kingdom',
    timezone: 'Europe/London',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal in CREATE mode with prefilled location and default presets', () => {
    render(
      <AirAlertsModal
        isOpen={true}
        onClose={vi.fn()}
        initialMode="CREATE"
        currentLocation={mockLocation}
      />
    );

    expect(screen.getByText('Personalized Air Alerts')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('name@example.com')).toBeInTheDocument();
    expect(screen.getByText('PM2.5 Concentration (µg/m³)')).toBeInTheDocument();
  });

  it('shows transparency disclaimer when Relative Score metric is chosen', () => {
    render(
      <AirAlertsModal
        isOpen={true}
        onClose={vi.fn()}
        initialMode="CREATE"
        currentLocation={mockLocation}
      />
    );

    const scoreTab = screen.getByText('Relative Pollution Score');
    fireEvent.click(scoreTab);

    expect(screen.getByText(/not an official AQI/i)).toBeInTheDocument();
    expect(screen.getByText(/PM2.5 \+ \(0.5 × PM10\)/)).toBeInTheDocument();
  });

  it('submits alert creation and displays success confirmation', async () => {
    vi.mocked(alertsApi.createAlert).mockResolvedValueOnce({
      message: 'Alert created.',
      alertId: 'alert-123',
    });

    render(
      <AirAlertsModal
        isOpen={true}
        onClose={vi.fn()}
        initialMode="CREATE"
        currentLocation={mockLocation}
      />
    );

    const emailInput = screen.getByPlaceholderText('name@example.com');
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } });

    const submitBtn = screen.getByRole('button', { name: /Create Alert/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(alertsApi.createAlert).toHaveBeenCalledWith({
        email: 'alice@example.com',
        latitude: 51.5,
        longitude: -0.12,
        timezone: 'Europe/London',
        thresholdType: 'PM25',
        thresholdValue: 25,
      });
    });

    expect(await screen.findByText('Verification Email Sent!')).toBeInTheDocument();
    expect(screen.getByText(/alice@example.com/)).toBeInTheDocument();
  });

  it('handles verification mode success', async () => {
    vi.mocked(alertsApi.verifyAlert).mockResolvedValueOnce({
      message: 'Alert verified and activated.',
    });

    render(
      <AirAlertsModal
        isOpen={true}
        onClose={vi.fn()}
        initialMode="VERIFY"
        initialToken="valid-token-123"
      />
    );

    expect(await screen.findByText('Alert Activated!')).toBeInTheDocument();
    expect(screen.getByText('Alert verified and activated.')).toBeInTheDocument();
  });

  it('handles verification mode failure with informative error', async () => {
    vi.mocked(alertsApi.verifyAlert).mockRejectedValueOnce(new Error('Token expired'));

    render(
      <AirAlertsModal
        isOpen={true}
        onClose={vi.fn()}
        initialMode="VERIFY"
        initialToken="expired-token-123"
      />
    );

    expect(await screen.findByText('Verification Failed')).toBeInTheDocument();
    expect(screen.getAllByText('Token expired').length).toBeGreaterThan(0);
  });

  it('renders management mode and allows pausing alert', async () => {
    vi.mocked(alertsApi.manageAlert).mockResolvedValueOnce({
      alertId: 'alert-abc',
      status: 'ACTIVE',
      threshold: { type: 'PM25', value: 35 },
      lat: 51.5,
      lon: -0.12,
    });

    render(
      <AirAlertsModal
        isOpen={true}
        onClose={vi.fn()}
        initialMode="MANAGE"
        initialToken="manage-token-123"
      />
    );

    expect(await screen.findByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText(/35 µg\/m³/)).toBeInTheDocument();

    const pauseBtn = screen.getByRole('button', { name: /Pause Alert/i });
    
    vi.mocked(alertsApi.manageAlert).mockResolvedValueOnce({
      message: 'Alert updated to PAUSED',
    });

    fireEvent.click(pauseBtn);

    await waitFor(() => {
      expect(alertsApi.manageAlert).toHaveBeenCalledWith('manage-token-123', 'PAUSE');
    });

    expect(await screen.findByText('Alert updated to PAUSED')).toBeInTheDocument();
    expect(await screen.findByText('PAUSED')).toBeInTheDocument();
  });
});
