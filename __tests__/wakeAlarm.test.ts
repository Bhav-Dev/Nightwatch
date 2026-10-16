import { nextAlarm, parseWakeTime, wakeSetting } from '../src/domain/wakeAlarm';

describe('wake-up alarm', () => {
  it('reads and writes the stored time', () => {
    expect(parseWakeTime('07:00')).toEqual({ hour: 7, minute: 0 });
    expect(parseWakeTime('6:45')).toEqual({ hour: 6, minute: 45 });
    expect(wakeSetting({ hour: 6, minute: 5 })).toBe('06:05');
    expect(parseWakeTime(wakeSetting({ hour: 23, minute: 59 }))).toEqual({ hour: 23, minute: 59 });
  });

  it('treats anything else as no alarm', () => {
    for (const bad of [null, '', 'off', '24:00', '07:60', '7', '07:00:00']) expect(parseWakeTime(bad)).toBeNull();
  });

  it('rings the next morning when recording starts in the evening', () => {
    const at = nextAlarm(new Date(2026, 9, 16, 23, 10), { hour: 7, minute: 0 });
    expect(at).toEqual(new Date(2026, 9, 17, 7, 0));
  });

  it('rings later the same night when recording starts after midnight', () => {
    const at = nextAlarm(new Date(2026, 9, 17, 3, 45), { hour: 7, minute: 30 });
    expect(at).toEqual(new Date(2026, 9, 17, 7, 30));
  });

  it('moves to tomorrow once the time has passed, as the Clock app does', () => {
    expect(nextAlarm(new Date(2026, 9, 17, 7, 0, 0), { hour: 7, minute: 0 })).toEqual(new Date(2026, 9, 18, 7, 0));
    expect(nextAlarm(new Date(2026, 9, 17, 6, 59, 59), { hour: 7, minute: 0 })).toEqual(new Date(2026, 9, 17, 7, 0));
  });
});
