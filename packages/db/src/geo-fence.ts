// Geo-fence — pure haversine distance + within-fence check.
//
// Used by mobile-source EmployeeCheckin to enforce that a worker
// really is at their assigned Branch. Branch carries the anchor +
// radius; the check-in carries the point.

const EARTH_RADIUS_M = 6_371_000; // mean radius, close-enough at city scale

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

// Great-circle distance in meters. Accurate to ~0.5% up to ~1000 km,
// which is more than enough for a "did the employee stand outside the
// office" check.
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δφ = toRad(lat2 - lat1);
  const Δλ = toRad(lon2 - lon1);
  const a =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeoFence {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface CheckinPoint {
  latitude: number;
  longitude: number;
}

export interface FenceCheckResult {
  ok: boolean;
  distanceMeters: number;
}

// Returns { ok, distanceMeters }. When fence radius is 0 or negative,
// treats as "no fence" and always ok.
export function checkFence(
  fence: GeoFence,
  point: CheckinPoint,
): FenceCheckResult {
  const d = haversineMeters(fence.latitude, fence.longitude, point.latitude, point.longitude);
  if (fence.radiusMeters <= 0) return { ok: true, distanceMeters: d };
  return { ok: d <= fence.radiusMeters, distanceMeters: d };
}
