declare namespace google.maps {
  interface LatLng {
    lat(): number;
    lng(): number;
  }

  class Map {
    constructor(el: HTMLElement, opts?: Record<string, unknown>);
    fitBounds(bounds: LatLngBounds, padding?: number): void;
    panTo(latLng: LatLng | { lat: number; lng: number }): void;
    getZoom(): number | undefined;
    setZoom(zoom: number): void;
  }
  class Marker {
    constructor(opts?: Record<string, unknown>);
    setMap(map: Map | null): void;
    addListener(event: string, handler: () => void): void;
    getPosition(): LatLng | null | undefined;
  }
  class InfoWindow {
    constructor(opts?: Record<string, unknown>);
    open(opts: { map: Map; anchor?: Marker }): void;
    close(): void;
  }
  class LatLngBounds {
    extend(point: { lat: number; lng: number }): void;
  }
  enum SymbolPath {
    CIRCLE = 0,
  }
}

declare const google: { maps: typeof google.maps };
