import { Alert, Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { Db } from '../src/data/db';
import { saveNight } from '../src/data/nightRepo';
import { migrate } from '../src/data/schema';
import { getSetting, setSetting } from '../src/data/settingsRepo';
import { analyseNight } from '../src/domain/scoring';
import type { HealthSource } from '../src/health/source';
import { WatchCard } from '../src/screens/WatchCard';
import { evenNight } from './helpers/fixtureNight';
import { openTestDb } from './helpers/nodeDb';

let mockDb: Db;
let mockSource: HealthSource | null;

jest.mock('expo-sqlite', () => ({ useSQLiteContext: () => mockDb }));
jest.mock('expo-router', () => {
  const { useEffect } = require('react');
  return { useFocusEffect: (fn: () => void) => useEffect(fn, [fn]) };
});
jest.mock('../src/health', () => ({ getHealthSource: () => mockSource }));

function source(granted: boolean): HealthSource & { requestPermission: jest.Mock } {
  return {
    name: 'Apple Health',
    isAvailable: async () => true,
    requestPermission: jest.fn(async () => granted),
    read: async () => [],
  };
}

async function render() {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(<WatchCard />);
  });
  const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));
  const press = async (label: string) => {
    const target = tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === 'function' && n.findAllByType(Text).some((t) => [t.props.children].flat().join('') === label));
    await act(async () => {
      await target.props.onPress();
    });
  };
  return { tree, texts, press };
}

beforeEach(async () => {
  mockDb = openTestDb();
  await migrate(mockDb);
});

describe('Settings: your watch', () => {
  it('connects Apple Health, and This Morning stops offering it', async () => {
    mockSource = source(true);
    const card = await render();
    expect(card.texts()).toContain('Connect Apple Health');

    await card.press('Connect Apple Health');
    expect(mockSource.requestPermission).toHaveBeenCalled();
    expect(await getSetting(mockDb, 'health_enabled')).toBe('1');
    expect(await getSetting(mockDb, 'health_prompted_after')).toBe('done');
    expect(card.texts()).toEqual(expect.arrayContaining(['Apple Health', 'Connected', 'No watch data yet. It appears the morning after a night you wear your watch to bed.']));
  });

  it('shows the latest night with watch data once connected', async () => {
    mockSource = source(true);
    await setSetting(mockDb, 'health_enabled', '1');
    const startedAt = new Date(2026, 9, 19, 23, 0);
    const endedAt = new Date(2026, 9, 20, 7, 0);
    await saveNight(mockDb, { id: 'n1', startedAt, endedAt, partial: false, analysis: analyseNight({ durationS: 8 * 3600, frames: evenNight(8, 0.2, 15) }), newId: () => `x${Math.random()}` });
    await mockDb.runAsync(`INSERT INTO health_sample (night_id, kind, start_s, end_s, value, stage) VALUES ('n1', 'hr', 60, 60, 58, NULL)`, []);

    const card = await render();
    const date = endedAt.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    expect(card.texts()).toContain(`Latest night with watch data: ${date}.`);
    expect(card.texts()).toContain('Stop reading Apple Health');
  });

  it('says what to do when nothing was allowed', async () => {
    mockSource = source(false);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const card = await render();
    await card.press('Connect Apple Health');
    expect(alert).toHaveBeenCalledWith('Nothing to read yet', expect.stringContaining('Allow sleep or heart rate'), undefined);
    expect(await getSetting(mockDb, 'health_enabled')).toBeNull();
    expect(card.texts()).toContain('Connect Apple Health');
    alert.mockRestore();
  });

  it('stops reading after a confirmation, keeping nights already read', async () => {
    mockSource = source(true);
    await setSetting(mockDb, 'health_enabled', '1');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    const card = await render();
    await card.press('Stop reading Apple Health');
    const buttons = alert.mock.calls[0][2]!;
    await act(async () => {
      await buttons.find((b) => b.text === 'Stop')!.onPress!();
    });
    expect(await getSetting(mockDb, 'health_enabled')).toBe('0');
    expect(card.texts()).toContain('Connect Apple Health');
    alert.mockRestore();
  });

  it('says so when the phone has no health store', async () => {
    mockSource = null;
    const card = await render();
    expect(card.texts()).toContain('Watch data is not available on this phone.');
  });
});
