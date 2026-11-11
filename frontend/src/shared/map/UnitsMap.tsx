import { useEffect } from 'react';
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { env } from '@/core/config/env';

export interface MapPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  color: string;
  /** dashed ring = position is the assigned post, not a GPS fix */
  approximate?: boolean;
  pulse?: boolean;
}

interface UnitsMapProps {
  points: MapPoint[];
  height?: number | string;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  zoom?: number;
  interactive?: boolean;
  /** Permanent callsign labels (full map page); hover-only otherwise. */
  showLabels?: boolean;
}

function FlyToSelection({ point }: { point: MapPoint | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (point) map.flyTo([point.lat, point.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [map, point]);
  return null;
}

/**
 * Operational map: Leaflet + OpenStreetMap tiles (no API key), darkened with
 * a CSS filter (.map-tiles-dark) to match the operations-room theme.
 */
export function UnitsMap({ points, height = 420, selectedId, onSelect, zoom = 11, interactive = true, showLabels = false }: UnitsMapProps) {
  const selected = points.find((point) => point.id === selectedId);
  return (
    <div dir="ltr" style={{ height, width: '100%', borderRadius: 'inherit', overflow: 'hidden' }}>
      <MapContainer
        center={env.mapCenter}
        zoom={zoom}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={interactive}
        dragging={interactive}
        zoomControl={interactive}
        attributionControl
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
          className="map-tiles-dark"
        />
        {points.map((point) => (
          <CircleMarker
            key={point.id}
            center={[point.lat, point.lng]}
            radius={point.id === selectedId ? 13 : 10}
            pathOptions={{
              color: point.id === selectedId ? '#ffffff' : point.color,
              weight: point.id === selectedId ? 3 : 2,
              fillColor: point.color,
              fillOpacity: 0.85,
              dashArray: point.approximate ? '4 3' : undefined,
              className: point.pulse ? 'map-pulse' : undefined,
            }}
            eventHandlers={onSelect ? { click: () => onSelect(point.id) } : undefined}
          >
            <Tooltip direction="top" offset={[0, -10]} permanent={showLabels}>
              <span style={{ fontWeight: 700, fontSize: 11 }}>{point.label}</span>
            </Tooltip>
          </CircleMarker>
        ))}
        <FlyToSelection point={selected} />
      </MapContainer>
    </div>
  );
}
