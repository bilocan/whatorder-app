declare global {
  interface Window {
    google?: typeof google;
    __whatorderMapsInit?: () => void;
  }
}

let loadPromise: Promise<void> | null = null;

export function getMapsApiKey(): string | undefined {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  return key?.trim() || undefined;
}

export function loadGoogleMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.maps) return Promise.resolve();

  const key = getMapsApiKey();
  if (!key) return Promise.reject(new Error('VITE_GOOGLE_MAPS_API_KEY is not set'));

  if (!loadPromise) {
    loadPromise = new Promise((resolve, reject) => {
      window.__whatorderMapsInit = () => {
        delete window.__whatorderMapsInit;
        resolve();
      };
      const script = document.createElement('script');
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__whatorderMapsInit`;
      script.async = true;
      script.onerror = () => reject(new Error('Google Maps script failed to load'));
      document.head.appendChild(script);
    });
  }

  return loadPromise;
}
