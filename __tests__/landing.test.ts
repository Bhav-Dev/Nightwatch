import { landingTab } from '../src/domain/landingTab';
import { localDateKey, nightDateWithSuffix } from '../src/domain/nightDate';

const at = (h: number) => new Date(2026, 9, 14, h, 0, 0);

describe('landing tab', () => {
  it('shows This Morning before 2pm when last night exists', () => {
    expect(landingTab(at(7), true)).toBe('morning');
    expect(landingTab(at(13), true)).toBe('morning');
  });
  it('shows Tonight otherwise', () => {
    expect(landingTab(at(7), false)).toBe('tonight');
    expect(landingTab(at(15), true)).toBe('tonight');
    expect(landingTab(at(19), true)).toBe('tonight');
  });
  it('honours the Settings override', () => {
    expect(landingTab(at(19), true, 'morning')).toBe('morning');
  });
});

describe('night dates', () => {
  it('keys by local date and suffixes a second recording', () => {
    expect(localDateKey(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
    expect(nightDateWithSuffix('2026-01-05', 0)).toBe('2026-01-05');
    expect(nightDateWithSuffix('2026-01-05', 1)).toBe('2026-01-05#2');
  });
});
