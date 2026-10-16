import * as Location from 'expo-location';

import type { WeatherResponse } from '../../shared/api';
import { weatherArea } from '../../shared/weather';
import { config } from '../config';

/**
 * This morning's weather: approximate location only (precise location is blocked in app.json),
 * rounded to a ~10 km area before it leaves the phone, then our server, which asks MET Norway.
 */
export const weatherConfigured = config.weatherUrl !== '';

export async function locationPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  const { status } = await Location.getForegroundPermissionsAsync();
  return status === Location.PermissionStatus.GRANTED ? 'granted' : status === Location.PermissionStatus.DENIED ? 'denied' : 'undetermined';
}

export async function askForLocation(): Promise<boolean> {
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === Location.PermissionStatus.GRANTED;
}

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);

/** A rough position: the last one the phone knew (within 12 hours), or a quick low-accuracy fix. */
async function roughPosition(): Promise<{ lat: number; lon: number } | null> {
  const last = await Location.getLastKnownPositionAsync({ maxAge: 12 * 3600_000 }).catch(() => null);
  const pos = last ?? (await withTimeout(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Lowest }).catch(() => null), 20_000));
  return pos ? { lat: pos.coords.latitude, lon: pos.coords.longitude } : null;
}

/** The forecast for where the phone is, or null (no permission, no position, or no answer). */
export async function fetchWeatherHere(): Promise<WeatherResponse | null> {
  if (!weatherConfigured || (await locationPermission()) !== 'granted') return null;
  const pos = await roughPosition();
  if (!pos) return null;
  const area = weatherArea(pos.lat, pos.lon);
  try {
    const res = await withTimeout(fetch(`${config.weatherUrl}/v1/weather?lat=${area.lat}&lon=${area.lon}`), 20_000);
    if (!res || !res.ok) return null;
    return (await res.json()) as WeatherResponse;
  } catch {
    return null;
  }
}
