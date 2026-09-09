export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  const media = window.matchMedia('(display-mode: standalone)').matches;
  const ios = 'standalone' in navigator && (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return media || ios;
}
