const INSTALLED_DISPLAY_MODES = ['standalone', 'minimal-ui', 'fullscreen', 'window-controls-overlay'] as const;

export function isInstalledPwa(): boolean {
  if (typeof window === 'undefined') return false;
  const installed = INSTALLED_DISPLAY_MODES.some((mode) => window.matchMedia(`(display-mode: ${mode})`).matches);
  const ios = 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return installed || ios;
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const media = window.matchMedia('(display-mode: standalone)').matches;
  const ios = 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return media || ios;
}
