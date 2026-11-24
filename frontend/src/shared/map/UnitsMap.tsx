import L from 'leaflet';
import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { env } from '@/core/config/env';

/** normal / watch / critical for an online unit; offline = no recent contact. */
export type MarkerStatus = 'normal' | 'watch' | 'critical' | 'offline';

export interface MapPoint {
  id: string;
  label: string;
  lat: number;
  lng: number;
  color: string;
  status: MarkerStatus;
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
  /** Permanent callsign labels; hover-only otherwise. */
  showLabels?: boolean;
  /** Start zoomed to fit every unit instead of the city centre. */
  fitToPoints?: boolean;
  /** Don't fly to the selection the map starts with (only to later changes). */
  keepInitialView?: boolean;
  /** The unit to fly to when it changes; the selected unit by default. */
  focusId?: string | null;
}

// Stroke icons (24×24) drawn inside the marker badge.
const MARKER_ICON: Record<MarkerStatus, string> = {
  normal: 'M12 3 20 6v6c0 5-3.4 8.6-8 10-4.6-1.4-8-5-8-10V6z',
  watch: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v5M12 16.5h.01',
  critical: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01',
  offline: 'M18 6 6 18M6 6l12 12',
};

function markerIcon(point: MapPoint, selected: boolean): L.DivIcon {
  const classes = ['unit-marker'];
  if (selected) classes.push('unit-marker--selected');
  if (point.approximate) classes.push('unit-marker--approx');
  if (point.pulse) classes.push('unit-marker--pulse');
  return L.divIcon({
    className: classes.join(' '),
    html:
      `<div class="unit-marker__badge" style="--marker:${point.color}">` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
      `<path d="${MARKER_ICON[point.status]}"/></svg></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/** Fly to the selected unit when the selection changes (not on every data refresh). */
function FlyToSelection({ point, skipFirst }: { point: MapPoint | undefined; skipFirst: boolean }) {
  const map = useMap();
  const latest = useRef(point);
  // The selection the map opened with is left alone when skipFirst is set.
  const initial = useRef<string | undefined>(skipFirst ? point?.id : undefined);
  latest.current = point;
  const id = point?.id;
  useEffect(() => {
    if (initial.current !== undefined) {
      if (id === initial.current) return;
      initial.current = undefined; // a new unit was picked: follow every change from now on
    }
    const target = latest.current;
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 13), { duration: 0.6 });
  }, [map, id]);
  return null;
}

/** Zoom to show every unit once, when the map opens. */
function FitToPoints({ points }: { points: MapPoint[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    map.invalidateSize(); // the card may have been laid out after the map was created
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 13);
      return;
    }
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [56, 56], maxZoom: 13 });
  }, [map, points]);
  return null;
}

/** Leaflet does not notice when its box changes size (responsive grid): tell it. */
function TrackSize() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize());
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

/**
 * Operational map: Leaflet + OpenStreetMap tiles (no API key), turned into a
 * charcoal basemap with a CSS filter (.map-tiles-dark). Units are round
 * badges: shield = normal, "!" = under watch, triangle = critical, × = offline.
 */
export function UnitsMap({
  points,
  height = 420,
  selectedId,
  onSelect,
  zoom = 11,
  interactive = true,
  showLabels = false,
  fitToPoints = false,
  keepInitialView = false,
  focusId,
}: UnitsMapProps) {
  const focus = points.find((point) => point.id === (focusId === undefined ? selectedId : focusId));
  // Icons are rebuilt only when what they show changes, not on every poll.
  const iconKey = points.map((p) => `${p.id}:${p.status}:${p.color}:${p.approximate}:${p.pulse}`).join('|');
  const icons = useMemo(
    () => new Map(points.map((point) => [point.id, markerIcon(point, point.id === selectedId)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- iconKey captures every field markerIcon reads
    [iconKey, selectedId],
  );

  return (
    <div dir="ltr" style={{ height, width: '100%', borderRadius: 'inherit', overflow: 'hidden' }}>
      <MapContainer
        className="map-dots"
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
          <Marker
            key={point.id}
            position={[point.lat, point.lng]}
            icon={icons.get(point.id)!}
            zIndexOffset={point.id === selectedId ? 1000 : point.status === 'critical' ? 500 : 0}
            eventHandlers={onSelect ? { click: () => onSelect(point.id) } : undefined}
            keyboard={Boolean(onSelect)}
            title={point.label}
          >
            <Tooltip direction="top" offset={[0, -17]} permanent={showLabels}>
              <span style={{ fontWeight: 500, fontSize: 11 }}>{point.label}</span>
            </Tooltip>
          </Marker>
        ))}
        <TrackSize />
        {fitToPoints && <FitToPoints points={points} />}
        <FlyToSelection point={focus} skipFirst={keepInitialView} />
      </MapContainer>
    </div>
  );
}
