import { useEffect, useRef, useState } from 'react';
import { getMapsApiKey, loadGoogleMaps } from '../lib/loadGoogleMaps';

export type RestaurantMapPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string | null;
  imageUrl?: string | null;
};

type Props = {
  pins: RestaurantMapPin[];
  customer?: { lat: number; lng: number } | null;
  height?: string;
  onPinClick?: (id: string) => void;
  focusedPinId?: string | null;
};

export default function RestaurantMap({ pins, customer, height = '420px', onPinClick, focusedPinId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const markerByIdRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const infoByIdRef = useRef<Map<string, google.maps.InfoWindow>>(new Map());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!getMapsApiKey()) {
      setError('missing_key');
      return;
    }
    if (!containerRef.current) return;

    let cancelled = false;

    loadGoogleMaps()
      .then(() => {
        if (cancelled || !containerRef.current) return;

        const center = customer ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : { lat: 48.2082, lng: 16.3738 });
        if (!mapRef.current) {
          mapRef.current = new google.maps.Map(containerRef.current, {
            center,
            zoom: 12,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          });
        }

        markersRef.current.forEach((m) => m.setMap(null));
        markersRef.current = [];
        markerByIdRef.current.clear();
        infoByIdRef.current.clear();

        const bounds = new google.maps.LatLngBounds();

        if (customer) {
          const you = new google.maps.Marker({
            map: mapRef.current,
            position: customer,
            title: 'You',
            label: 'U',
            icon: {
              path: google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: '#4285F4',
              fillOpacity: 1,
              strokeColor: '#ffffff',
              strokeWeight: 2,
            },
          });
          markersRef.current.push(you);
          bounds.extend(customer);
        }

        pins.forEach((pin, i) => {
          const position = { lat: pin.lat, lng: pin.lng };
          const marker = new google.maps.Marker({
            map: mapRef.current!,
            position,
            title: pin.name,
            label: String(i + 1),
          });
          const info = new google.maps.InfoWindow({
            content: `<div style="font-family:sans-serif;max-width:240px">${pin.imageUrl ? `<img src="${escapeHtml(pin.imageUrl)}" style="width:100%;max-width:240px;border-radius:8px;margin-bottom:8px"/>` : ''}<strong>${escapeHtml(pin.name)}</strong>${pin.address ? `<br><span style="color:#666;font-size:12px">${escapeHtml(pin.address)}</span>` : ''}</div>`,
          });
          marker.addListener('click', () => {
            infoByIdRef.current.forEach((iw) => iw.close());
            info.open({ map: mapRef.current!, anchor: marker });
            onPinClick?.(pin.id);
          });
          markersRef.current.push(marker);
          markerByIdRef.current.set(pin.id, marker);
          infoByIdRef.current.set(pin.id, info);
          bounds.extend(position);
        });

        if (customer || pins.length) {
          mapRef.current.fitBounds(bounds, 56);
        }
      })
      .catch(() => {
        if (!cancelled) setError('load_failed');
      });

    return () => { cancelled = true; };
  }, [pins, customer, onPinClick]);

  useEffect(() => {
    if (!focusedPinId || !mapRef.current) return;

    const marker = markerByIdRef.current.get(focusedPinId);
    const info = infoByIdRef.current.get(focusedPinId);
    if (!marker) return;

    const position = marker.getPosition();
    if (position) {
      mapRef.current.panTo(position);
      const zoom = mapRef.current.getZoom() ?? 14;
      if (zoom < 14) mapRef.current.setZoom(14);
    }

    infoByIdRef.current.forEach((iw) => iw.close());
    info?.open({ map: mapRef.current, anchor: marker });
  }, [focusedPinId]);

  if (error === 'missing_key') {
    return (
      <div style={{ padding: '1rem', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, color: '#92400e' }}>
        Set <code>VITE_GOOGLE_MAPS_API_KEY</code> in dashboard env (Maps JavaScript API).
      </div>
    );
  }

  if (error === 'load_failed') {
    return (
      <div style={{ padding: '1rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c' }}>
        Could not load Google Maps.
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height, borderRadius: 10, border: '1px solid #e5e7eb' }} />;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
