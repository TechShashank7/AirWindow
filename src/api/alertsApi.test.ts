import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAlert, verifyAlert, manageAlert } from './alertsApi';

describe('alertsApi client', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubEnv('VITE_EVALUATE_API_URL', 'https://api.example.com');
  });

  describe('createAlert', () => {
    it('sends correct POST payload to /alerts/create', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: 'Alert created. Please check your email to verify.',
          alertId: 'alert-123',
        }),
      });
      global.fetch = mockFetch;

      const req = {
        email: 'user@example.com',
        latitude: 28.61,
        longitude: 77.23,
        timezone: 'Asia/Kolkata',
        thresholdType: 'PM25' as const,
        thresholdValue: 25,
      };

      const res = await createAlert(req);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/alerts/create');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual(req);
      expect(res.alertId).toBe('alert-123');
    });

    it('throws formatted error message on backend rejection (e.g. 403 max limit)', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Maximum of 3 alerts allowed per email address.' }),
      });

      await expect(
        createAlert({
          email: 'user@example.com',
          latitude: 28.61,
          longitude: 77.23,
          timezone: 'Asia/Kolkata',
          thresholdType: 'PM25',
          thresholdValue: 25,
        })
      ).rejects.toThrow('Maximum of 3 alerts allowed per email address.');
    });
  });

  describe('verifyAlert', () => {
    it('sends token in body to /alerts/verify', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Alert verified and activated.' }),
      });
      global.fetch = mockFetch;

      const res = await verifyAlert('dummy-token-abc');
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/alerts/verify');
      expect(options.method).toBe('POST');
      expect(JSON.parse(options.body)).toEqual({ token: 'dummy-token-abc' });
      expect(res.message).toBe('Alert verified and activated.');
    });

    it('throws error when token is expired or invalid', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Token expired' }),
      });

      await expect(verifyAlert('expired-token')).rejects.toThrow('Token expired');
    });
  });

  describe('manageAlert', () => {
    it('sends action LIST with token to /alerts/manage', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          alertId: 'alert-123',
          status: 'ACTIVE',
          threshold: { type: 'PM25', value: 25 },
          lat: 28.61,
          lon: 77.23,
        }),
      });
      global.fetch = mockFetch;

      const res = await manageAlert('manage-token-xyz', 'LIST');
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain('/alerts/manage');
      expect(JSON.parse(options.body)).toEqual({ token: 'manage-token-xyz', action: 'LIST' });
      expect(res.status).toBe('ACTIVE');
    });

    it('sends action PAUSE to /alerts/manage', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Alert updated to PAUSED' }),
      });
      global.fetch = mockFetch;

      const res = await manageAlert('manage-token-xyz', 'PAUSE');
      const [, options] = mockFetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ token: 'manage-token-xyz', action: 'PAUSE' });
      expect(res.message).toBe('Alert updated to PAUSED');
    });

    it('sends action DELETE to /alerts/manage', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: 'Alert deleted' }),
      });
      global.fetch = mockFetch;

      const res = await manageAlert('manage-token-xyz', 'DELETE');
      const [, options] = mockFetch.mock.calls[0];
      expect(JSON.parse(options.body)).toEqual({ token: 'manage-token-xyz', action: 'DELETE' });
      expect(res.message).toBe('Alert deleted');
    });
  });
});
