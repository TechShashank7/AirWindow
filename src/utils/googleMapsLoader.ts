let googleMapsPromise: Promise<typeof google> | null = null;

export function getGoogleMapsApiKey(): string {
  if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
    return '';
  }
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    if (import.meta.env.MODE === 'test') return '';
    return (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined)?.trim() || '';
  }
  return '';
}

export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is not available'));
  }

  if ((window as any).google?.maps?.Map) {
    return Promise.resolve((window as any).google);
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    if ((window as any).google?.maps?.Map) {
      resolve((window as any).google);
      return;
    }

    const callbackName = `__airwindow_gmaps_cb`;
    let settled = false;

    (window as any)[callbackName] = async () => {
      if (settled) return;
      settled = true;
      try {
        if ((window as any).google?.maps?.importLibrary) {
          await Promise.allSettled([
            (window as any).google.maps.importLibrary('maps'),
            (window as any).google.maps.importLibrary('places'),
            (window as any).google.maps.importLibrary('geocoding'),
          ]);
        }
        delete (window as any)[callbackName];
        resolve((window as any).google);
      } catch (err) {
        delete (window as any)[callbackName];
        googleMapsPromise = null;
        reject(err);
      }
    };

    const prevAuthFailure = (window as any).gm_authFailure;
    (window as any).gm_authFailure = () => {
      console.warn('Google Maps API authentication failed: Check Maps JavaScript API status in Google Cloud Console.');
      if (typeof prevAuthFailure === 'function') prevAuthFailure();
      if (!settled) {
        settled = true;
        delete (window as any)[callbackName];
        googleMapsPromise = null;
        reject(new Error('Google Maps authentication failed (gm_authFailure). Maps JavaScript API may not be enabled.'));
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    );
    if (existing) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if ((window as any).google?.maps?.Map) {
          clearInterval(interval);
          if (!settled) {
            settled = true;
            resolve((window as any).google);
          }
        } else if (attempts > 40) {
          clearInterval(interval);
          if (!settled) {
            settled = true;
            googleMapsPromise = null;
            reject(new Error('Timed out waiting for existing Google Maps script'));
          }
        }
      }, 50);
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places&callback=${callbackName}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onerror = (err) => {
      if (!settled) {
        settled = true;
        delete (window as any)[callbackName];
        googleMapsPromise = null;
        reject(err);
      }
    };

    document.head.appendChild(script);

    setTimeout(() => {
      if (!settled) {
        settled = true;
        delete (window as any)[callbackName];
        googleMapsPromise = null;
        reject(new Error('Google Maps script load timed out'));
      }
    }, 8000);
  });

  return googleMapsPromise;
}
