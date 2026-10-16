import type { WeatherHour, WeatherResponse } from '../shared/api';
import type { NightSummary } from '../shared/remedyEffect';
import { weatherArea, weatherAreaKey } from '../shared/weather';
import { nightWeather } from '../src/data/weatherRepo';
import { migrate } from '../src/data/schema';
import { morningSummary, type SummaryInput } from '../src/domain/summary';
import { conditionFor, describeWeather, summariseNightWeather, weatherBands, weatherFactorIds } from '../src/domain/weather';
import { CAPTURE_SAMPLE_RATE, synthesiseNightAudio, type AudioCapture, type CaptureListener } from '../src/native/audioCapture';
import { RecordingSession } from '../src/recording/recordingSession';
import { morningSky } from '../src/ui/theme';
import { openTestDb } from './helpers/nodeDb';

const hour = (iso: string, tempC: number, humidity: number, symbol: string): WeatherHour => ({ time: iso, tempC, humidity, cloud: 50, precipMm: 0, symbol });

describe('weather words and skies', () => {
  it('reads MET Norway symbol codes', () => {
    expect(conditionFor('clearsky_day')).toBe('clear');
    expect(conditionFor('fair_night')).toBe('partly');
    expect(conditionFor('cloudy')).toBe('cloudy');
    expect(conditionFor('lightrainshowers_day')).toBe('rain');
    expect(conditionFor('heavysleet')).toBe('snow');
    expect(conditionFor('rainandthunder')).toBe('thunder');
    expect(conditionFor('fog')).toBe('fog');
    expect(conditionFor(null)).toBeNull();
  });

  it('describes the morning', () => {
    expect(describeWeather('lightrain', 9.4)).toBe('Light rain, 9°C');
    expect(describeWeather('clearsky_day', 14)).toBe('Sunny, 14°C');
    expect(describeWeather('clearsky_night', -1.6)).toBe('Clear, -2°C');
    expect(describeWeather('heavyrainandthunder', null)).toBe('Thunder');
    expect(describeWeather(null, 10)).toBeNull();
  });

  it('picks the morning sky for the weather', () => {
    expect(morningSky('clear')).toBe('dawn');
    expect(morningSky('rain')).toBe('dawnRain');
    expect(morningSky('thunder')).toBe('dawnRain');
    expect(morningSky(null)).toBe('dawn');
  });

  it('rounds a position to its area, the same either side of zero', () => {
    expect(weatherArea(51.50735, -0.12776)).toEqual({ lat: 51.5, lon: -0.1 });
    expect(weatherAreaKey(weatherArea(-0.04, 0.04))).toBe('0.0,0.0');
  });
});

describe('a night’s weather', () => {
  const hours = [
    hour('2026-10-14T21:00:00Z', 12, 70, 'cloudy'),
    hour('2026-10-14T22:00:00Z', 10, 80, 'cloudy'),
    hour('2026-10-14T23:00:00Z', 8, 90, 'lightrain'),
    hour('2026-10-15T06:00:00Z', 6, 95, 'lightrain'),
    hour('2026-10-15T07:00:00Z', 7, 92, 'cloudy'),
  ];
  const start = Date.parse('2026-10-14T22:30:00Z') / 1000;
  const end = Date.parse('2026-10-15T06:40:00Z') / 1000;

  it('takes the hours overlapping the night, and the hour it ended in as the morning', () => {
    const w = summariseNightWeather(hours, start, end);
    expect(w.tempMeanC).toBeCloseTo((10 + 8 + 6) / 3);
    expect(w.tempMinC).toBe(6);
    expect(w.humidityMean).toBeCloseTo((80 + 90 + 95) / 3);
    expect(w).toMatchObject({ morningSymbol: 'lightrain', morningTempC: 6 });
  });

  it('falls into bands that are compared like factors', () => {
    expect(weatherBands({ tempMeanC: 3, humidityMean: 95 })).toEqual(['cold', 'humid']);
    expect(weatherBands({ tempMeanC: 12, humidityMean: 75 })).toEqual([]);
    expect(weatherFactorIds({ tempMeanC: 12, humidityMean: 75 })).toEqual(['weather:known']);
    expect(weatherFactorIds(null)).toEqual([]);
  });
});

describe('the weather sentence in the morning summary', () => {
  const night = (i: number, score: number, factors: string[]): NightSummary => ({
    id: `n${i}`,
    date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    score,
    pct_snoring: 0.2,
    duration_s: 8 * 3600,
    partial: false,
    typical: null,
    remedies: [],
    factors: factors.map((id) => ({ id, value: null })),
  });
  const base: SummaryInput = {
    startedAtEpochS: Date.parse('2026-10-14T22:00:00Z') / 1000,
    pctSnoring: 0.3,
    events: [{ startS: 3600, endS: 3600 + 1800, intensity: 'loud' }],
    health: null,
    factorsLogged: [],
    remediesLogged: [],
    history: [],
    experiment: null,
  };

  it('compares cold nights with other nights that have weather', () => {
    const history = [
      ...Array.from({ length: 5 }, (_, i) => night(i, 50, ['weather:known', 'weather:cold'])),
      ...Array.from({ length: 5 }, (_, i) => night(10 + i, 40, ['weather:known'])),
      // Nights from before weather was kept are left out of the comparison.
      ...Array.from({ length: 5 }, (_, i) => night(20 + i, 90, [])),
    ];
    const lines = morningSummary({ ...base, history, weatherBands: ['cold'] });
    expect(lines).toContain('It was a cold night; your cold nights average 10 points higher.');
  });

  it('says nothing until there are enough nights on each side', () => {
    const history = Array.from({ length: 4 }, (_, i) => night(i, 50, ['weather:known', 'weather:cold']));
    expect(morningSummary({ ...base, history, weatherBands: ['cold'] }).join(' ')).not.toMatch(/cold night/);
  });
});

class FakeCapture implements AudioCapture {
  listener: CaptureListener | null = null;
  async requestPermission() {
    return true;
  }
  async start(l: CaptureListener) {
    this.listener = l;
  }
  async stop() {}
  isRecording() {
    return true;
  }
}

describe('weather in a recorded night', () => {
  it('works out the night’s weather from tonight’s forecast at Stop', async () => {
    const db = openTestDb();
    await migrate(db);
    let n = 0;
    const startedAt = new Date('2026-10-14T22:00:00Z');
    const capture = new FakeCapture();
    const session = await RecordingSession.begin({ db, capture, sensitivity: 'normal', newId: () => `id-${++n}`, now: () => startedAt });
    const forecast: WeatherResponse = {
      area: { lat: 51.5, lon: -0.1 },
      hours: [hour('2026-10-14T22:00:00Z', 9, 88, 'cloudy'), hour('2026-10-14T23:00:00Z', 8, 91, 'lightrain')],
      updatedAt: null,
      attribution: 'Weather data from MET Norway (CC BY 4.0)',
    };
    session.setForecast(forecast);
    for (let s = 0; s < 600; s++) capture.listener!.onWindow({ startS: s, samples: synthesiseNightAudio(s, 1), sampleRate: CAPTURE_SAMPLE_RATE });
    const finished = await session.finish();
    const w = await nightWeather(db, finished!.nightId);
    expect(w).toMatchObject({ temp_mean_c: 9, humidity_mean: 88, morning_symbol: 'cloudy', morning_temp_c: 9, area: '51.5,-0.1' });
    expect(await db.getAllAsync('SELECT * FROM session_weather', [])).toEqual([]);
  });
});
