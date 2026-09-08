const EARTH_RADIUS_METERS = 6371008.8

const toRadians = degrees => degrees * Math.PI / 180

export function haversineDistanceMeters(from, to) {
  const latitudeDelta = toRadians(to.latitude - from.latitude)
  const longitudeDelta = toRadians(to.longitude - from.longitude)
  const latitude1 = toRadians(from.latitude)
  const latitude2 = toRadians(to.latitude)
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2
  return 2 * EARTH_RADIUS_METERS * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function evaluateGeofence(position, checkpoints) {
  const distances = checkpoints
    .filter(point => point.active)
    .map(point => ({ checkpoint: point, distanceMeters: haversineDistanceMeters(position, point) }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
  const nearest = distances[0] ?? null
  return {
    canPunch: distances.some(item => item.distanceMeters <= item.checkpoint.radiusMeters),
    nearest,
    distances,
  }
}

export const GEOFENCE_WARNING_ACCURACY_METERS = 100
