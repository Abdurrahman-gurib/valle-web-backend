import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

/**
 * Live weather at the park from Open-Meteo (free, no key): current conditions,
 * the next hours and the week, for the home-page map card, the ticket and the
 * booking picker. Cached for ten minutes; the last good answer survives an
 * outage. WMO weather codes are folded into a short list of conditions the
 * site can translate.
 */

export type Condition =
  | 'clear' | 'mainly-clear' | 'partly-cloudy' | 'overcast' | 'fog'
  | 'drizzle' | 'rain-light' | 'rain' | 'rain-heavy' | 'showers' | 'showers-heavy'
  | 'thunderstorm' | 'thunder-hail' | 'snow';

export interface WeatherNow { time: string; tempC: number; feelsC: number; humidity: number; precipMm: number; windKmh: number; gustKmh: number; code: number; condition: Condition; isDay: boolean }
export interface WeatherHour { time: string; tempC: number; rainPct: number; code: number; condition: Condition; windKmh: number }
export interface WeatherDay { date: string; code: number; condition: Condition; maxC: number; minC: number; rainPct: number; windKmh: number; sunrise: string; sunset: string }
export interface WeatherView { place: string; lat: number; lon: number; fetchedAt: string; now: WeatherNow; hours: WeatherHour[]; days: WeatherDay[] }

/** Vallé Advenature Park, Chamouny. */
export const PARK_LAT = -20.457614;
export const PARK_LON = 57.4826031;
const URL = `https://api.open-meteo.com/v1/forecast?latitude=${PARK_LAT}&longitude=${PARK_LON}`
  + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day'
  + '&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m'
  + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset'
  + '&timezone=Indian%2FMauritius&forecast_days=7';
const CACHE_MS = 10 * 60_000;

export function conditionOf(code: number): Condition {
  if (code === 0) return 'clear';
  if (code === 1) return 'mainly-clear';
  if (code === 2) return 'partly-cloudy';
  if (code === 3) return 'overcast';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if (code === 61 || code === 66) return 'rain-light';
  if (code === 63 || code === 67) return 'rain';
  if (code === 65) return 'rain-heavy';
  if (code >= 71 && code <= 77) return 'snow';
  if (code === 80 || code === 81) return 'showers';
  if (code === 82) return 'showers-heavy';
  if (code === 85 || code === 86) return 'snow';
  if (code === 95) return 'thunderstorm';
  if (code === 96 || code === 99) return 'thunder-hail';
  return 'partly-cloudy';
}

interface OpenMeteo {
  current: { time: string; temperature_2m: number; relative_humidity_2m: number; apparent_temperature: number; precipitation: number; weather_code: number; wind_speed_10m: number; wind_gusts_10m: number; is_day: number };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: number[]; weather_code: number[]; wind_speed_10m: number[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; wind_speed_10m_max: number[]; sunrise: string[]; sunset: string[] };
}

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private cache: { at: number; view: WeatherView } | null = null;
  private inflight: Promise<WeatherView> | null = null;

  async current(): Promise<WeatherView> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.view;
    if (!this.inflight) {
      this.inflight = this.fetchFresh()
        .then((view) => { this.cache = { at: Date.now(), view }; return view; })
        .catch((e: Error) => {
          this.logger.warn(`Open-Meteo unavailable: ${e.message}`);
          if (this.cache) return this.cache.view; // stale beats nothing
          throw new ServiceUnavailableException('Weather is not available right now');
        })
        .finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }

  /** Exposed for tests. */
  toView(raw: OpenMeteo, fetchedAt = new Date()): WeatherView {
    const c = raw.current;
    const nowIdx = Math.max(0, raw.hourly.time.findIndex((t) => t >= c.time.slice(0, 13)));
    const hours: WeatherHour[] = raw.hourly.time.slice(nowIdx, nowIdx + 12).map((time, i) => {
      const j = nowIdx + i;
      return { time, tempC: round1(raw.hourly.temperature_2m[j]), rainPct: raw.hourly.precipitation_probability[j] ?? 0, code: raw.hourly.weather_code[j], condition: conditionOf(raw.hourly.weather_code[j]), windKmh: round1(raw.hourly.wind_speed_10m[j]) };
    });
    const days: WeatherDay[] = raw.daily.time.map((date, i) => ({
      date, code: raw.daily.weather_code[i], condition: conditionOf(raw.daily.weather_code[i]),
      maxC: round1(raw.daily.temperature_2m_max[i]), minC: round1(raw.daily.temperature_2m_min[i]),
      rainPct: raw.daily.precipitation_probability_max[i] ?? 0, windKmh: round1(raw.daily.wind_speed_10m_max[i]),
      sunrise: (raw.daily.sunrise[i] ?? '').slice(11, 16), sunset: (raw.daily.sunset[i] ?? '').slice(11, 16),
    }));
    return {
      place: 'Chamouny, Mauritius', lat: PARK_LAT, lon: PARK_LON, fetchedAt: fetchedAt.toISOString(),
      now: { time: c.time, tempC: round1(c.temperature_2m), feelsC: round1(c.apparent_temperature), humidity: c.relative_humidity_2m, precipMm: round1(c.precipitation), windKmh: round1(c.wind_speed_10m), gustKmh: round1(c.wind_gusts_10m), code: c.weather_code, condition: conditionOf(c.weather_code), isDay: c.is_day === 1 },
      hours, days,
    };
  }

  private async fetchFresh(): Promise<WeatherView> {
    const res = await fetch(URL, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'valle-web (vallepark.com)' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return this.toView((await res.json()) as OpenMeteo);
  }
}

const round1 = (n: number): number => Math.round((n ?? 0) * 10) / 10;
