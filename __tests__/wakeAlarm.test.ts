import { STOP_BEFORE_ALARM_MS, stopForAlarm, tonightsAlarm } from '../src/domain/wakeAlarm';

const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime();
const HOURS_12 = 12 * 3600_000;

describe('the wake-up alarm on Tonight', () => {
  it('is the phone’s next alarm when it rings tomorrow morning', () => {
    expect(tonightsAlarm(at(17, 7), at(16, 22))).toBe(at(17, 7));
  });

  it('is none when the phone has no alarm', () => {
    expect(tonightsAlarm(null, at(16, 22))).toBeNull();
  });

  it('ignores a weekday alarm seen on a Saturday night', () => {
    expect(tonightsAlarm(at(19, 7), at(17, 22))).toBeNull();
  });

  it('ignores an alarm within the hour, like a bedtime reminder', () => {
    expect(tonightsAlarm(at(16, 22, 30), at(16, 22))).toBeNull();
  });
});

describe('stopping the recording for the alarm', () => {
  it('stops just before an alarm in the morning', () => {
    const start = at(16, 23);
    expect(stopForAlarm(at(17, 7), start, start + HOURS_12)).toBe(at(17, 7) - STOP_BEFORE_ALARM_MS);
  });

  it('works for a recording started in the middle of the night', () => {
    const start = at(17, 3, 45);
    expect(stopForAlarm(at(17, 7, 30), start, start + HOURS_12)).toBe(at(17, 7, 30) - STOP_BEFORE_ALARM_MS);
  });

  it('does not stop for an alarm in the first hour', () => {
    const start = at(16, 23);
    expect(stopForAlarm(at(16, 23, 30), start, start + HOURS_12)).toBeNull();
  });

  it('leaves alarms past the recording’s own limit to the usual automatic stop', () => {
    const start = at(16, 18);
    expect(stopForAlarm(at(17, 7), start, start + HOURS_12)).toBeNull();
  });

  it('does nothing without an alarm', () => {
    expect(stopForAlarm(null, at(16, 23), at(17, 11))).toBeNull();
  });
});
