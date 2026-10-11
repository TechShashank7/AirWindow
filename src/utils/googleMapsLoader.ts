let googleMapsPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<typeof google> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Window is not available'));
  }

  if ((window as any).google?.maps) {
    return Promise.resolve((window as any).google);
  }

  if (googleMapsPromise) {
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    );
    if (existing) {
      if ((window as any).google?.maps) {
        resolve((window as any).google);
      } else {
        existing.addEventListener('load', () => resolve((window as any).google));
        existing.addEventListener('error', (err) => reject(err));
      }
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=places,geometry&loading=async`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if ((window as any).google?.maps) {
        resolve((window as any).google);
      } else {
        reject(new Error('Google Maps script loaded but google.maps is not available'));
      }
    };
    script.onerror = (err) => {
      googleMapsPromise = null;
      reject(err);
    };

    document.head.appendChild(script);
  });

  return googleMapsPromise;
}
