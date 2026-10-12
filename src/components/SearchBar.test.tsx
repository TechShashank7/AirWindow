import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchBar } from './SearchBar';
import * as geolocationUtils from '../utils/geolocation';

describe('SearchBar component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders search input and "Use my current location" button', () => {
    render(<SearchBar onSelect={vi.fn()} />);

    expect(
      screen.getByPlaceholderText(/Search for a city/i)
    ).toBeInTheDocument();

    const locateBtn = screen.getByRole('button', {
      name: /Use my current location/i,
    });
    expect(locateBtn).toBeInTheDocument();
    expect(locateBtn).not.toBeDisabled();
  });

  it('triggers geolocation and calls onSelect with resolved location when clicked', async () => {
    const mockOnSelect = vi.fn();
    const mockOnLocateStart = vi.fn();
    const mockOnLocateEnd = vi.fn();

    vi.spyOn(geolocationUtils, 'getBrowserCoordinates').mockResolvedValue({
      latitude: 12.9716,
      longitude: 77.5946,
    });

    vi.spyOn(geolocationUtils, 'reverseGeocodeCoordinates').mockResolvedValue({
      id: 12345,
      name: 'Bengaluru',
      latitude: 12.9716,
      longitude: 77.5946,
      elevation: 920,
      country: 'India',
      admin1: 'Karnataka',
      timezone: 'Asia/Kolkata',
    });

    render(
      <SearchBar
        onSelect={mockOnSelect}
        onLocateStart={mockOnLocateStart}
        onLocateEnd={mockOnLocateEnd}
      />
    );

    const locateBtn = screen.getByRole('button', {
      name: /Use my current location/i,
    });
    fireEvent.click(locateBtn);

    expect(mockOnLocateStart).toHaveBeenCalled();

    await waitFor(() => {
      expect(mockOnSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Bengaluru',
          latitude: 12.9716,
          longitude: 77.5946,
          timezone: 'Asia/Kolkata',
        })
      );
    });

    expect(mockOnLocateEnd).toHaveBeenCalled();
  });

  it('calls onLocateError with actionable message when geolocation fails', async () => {
    const mockOnSelect = vi.fn();
    const mockOnLocateError = vi.fn();

    vi.spyOn(geolocationUtils, 'getBrowserCoordinates').mockRejectedValue({
      code: 'PERMISSION_DENIED',
      message: 'Location access was denied. Please allow location permissions in your browser or search manually.',
    });

    render(
      <SearchBar
        onSelect={mockOnSelect}
        onLocateError={mockOnLocateError}
      />
    );

    const locateBtn = screen.getByRole('button', {
      name: /Use my current location/i,
    });
    fireEvent.click(locateBtn);

    await waitFor(() => {
      expect(mockOnLocateError).toHaveBeenCalledWith(
        expect.stringContaining('denied')
      );
    });

    expect(mockOnSelect).not.toHaveBeenCalled();
  });

  it('disables the button when isExternalLocating is true', () => {
    render(<SearchBar onSelect={vi.fn()} isExternalLocating={true} />);

    const locateBtn = screen.getByRole('button', {
      name: /Use my current location/i,
    });
    expect(locateBtn).toBeDisabled();
  });

  it('searches for locations and selects a search result from dropdown', async () => {
    const mockOnSelect = vi.fn();
    render(<SearchBar onSelect={mockOnSelect} />);

    const input = screen.getByPlaceholderText(/Search for a city/i);
    fireEvent.change(input, { target: { value: 'Paris' } });

    // Open-Meteo search fallback is called when no Google key in test env
    // Wait for dropdown to display results
    await waitFor(
      () => {
        expect(screen.getByRole('listbox')).toBeInTheDocument();
      },
      { timeout: 2000 }
    );

    const options = screen.getAllByRole('option');
    expect(options.length).toBeGreaterThan(0);

    fireEvent.click(options[0]);

    expect(mockOnSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: expect.any(Number),
        longitude: expect.any(Number),
      })
    );
  });
});
