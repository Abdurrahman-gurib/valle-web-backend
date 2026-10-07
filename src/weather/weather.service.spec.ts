import { conditionOf, WeatherService } from './weather.service';

describe('weather', () => {
  it('folds WMO codes into the site conditions', () => {
    expect(conditionOf(0)).toBe('clear');
    expect(conditionOf(2)).toBe('partly-cloudy');
    expect(conditionOf(45)).toBe('fog');
    expect(conditionOf(53)).toBe('drizzle');
    expect(conditionOf(61)).toBe('rain-light');
    expect(conditionOf(65)).toBe('rain-heavy');
    expect(conditionOf(81)).toBe('showers');
    expect(conditionOf(95)).toBe('thunderstorm');
    expect(conditionOf(99)).toBe('thunder-hail');
    expect(conditionOf(123)).toBe('partly-cloudy');
  });

  it('shapes an Open-Meteo answer into now, the next 12 hours and the week', () => {
    const svc = new WeatherService();
    const hours = Array.from({ length: 48 }, (_, i) => `2026-10-07T${String(i % 24).padStart(2, '0')}:00`);
    const view = svc.toView({
      current: { time: '2026-10-07T10:17', temperature_2m: 24.36, relative_humidity_2m: 71, apparent_temperature: 25.1, precipitation: 0.2, weather_code: 80, wind_speed_10m: 18.4, wind_gusts_10m: 33.9, is_day: 1 },
      hourly: { time: hours, temperature_2m: hours.map((_, i) => 20 + (i % 10)), precipitation_probability: hours.map((_, i) => i * 2), weather_code: hours.map(() => 3), wind_speed_10m: hours.map(() => 12) },
      daily: { time: ['2026-10-07', '2026-10-08'], weather_code: [80, 0], temperature_2m_max: [26.2, 27.9], temperature_2m_min: [19.1, 18.4], precipitation_probability_max: [60, 10], wind_speed_10m_max: [30, 22], sunrise: ['2026-10-07T05:41', '2026-10-08T05:40'], sunset: ['2026-10-07T18:12', '2026-10-08T18:13'] },
    }, new Date('2026-10-07T06:20:00Z'));
    expect(view.now).toMatchObject({ tempC: 24.4, condition: 'showers', isDay: true, windKmh: 18.4 });
    expect(view.hours).toHaveLength(12);
    expect(view.hours[0].time).toBe('2026-10-07T10:00');
    expect(view.hours[0].rainPct).toBe(20);
    expect(view.days[1]).toMatchObject({ date: '2026-10-08', condition: 'clear', maxC: 27.9, sunrise: '05:40' });
  });
});
