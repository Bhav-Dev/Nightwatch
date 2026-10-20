import { act, create } from 'react-test-renderer';

import { playbackLog } from '../src/native/playbackLog';
import { useClipPlayer } from '../src/screens/useClipPlayer';

type Listener = (s: Record<string, unknown>) => void;

/** A stand-in for expo-audio's player: `playing` only turns true if `works` says so. */
class MockPlayer {
  playing = false;
  currentTime = 0;
  removed = false;
  played = 0;
  listener: Listener | null = null;
  constructor(
    readonly uri: string,
    readonly works: boolean,
  ) {}
  get currentStatus() {
    return { isLoaded: true, playing: this.playing, currentTime: this.currentTime, duration: 10, didJustFinish: false, playbackState: 'ready', timeControlStatus: this.playing ? 'playing' : 'paused', reasonForWaitingToPlay: '' };
  }
  addListener(_event: string, listener: Listener) {
    this.listener = listener;
    return { remove: () => (this.listener = null) };
  }
  play() {
    this.played++;
    if (!this.works) return;
    this.playing = true;
    this.listener?.(this.currentStatus);
  }
  pause() {
    this.playing = false;
    this.listener?.(this.currentStatus);
  }
  seekTo(s: number) {
    this.currentTime = s;
    return Promise.resolve();
  }
  remove() {
    this.removed = true;
  }
}

const mockPlayers: MockPlayer[] = [];
/** Whether the next mockPlayers made will play when asked. */
let mockNextWorks: boolean[] = [];

jest.mock('expo-audio', () => ({
  createAudioPlayer: (source: { uri: string }) => {
    const p = new MockPlayer(source.uri, mockNextWorks.length ? mockNextWorks.shift()! : true);
    mockPlayers.push(p);
    return p;
  },
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
  setIsAudioActiveAsync: jest.fn(() => Promise.resolve()),
}));

function mount() {
  const api: { current: ReturnType<typeof useClipPlayer> | null } = { current: null };
  function Probe() {
    api.current = useClipPlayer();
    return null;
  }
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<Probe />);
  });
  return { api: () => api.current!, unmount: () => act(() => tree.unmount()) };
}

beforeEach(() => {
  mockPlayers.length = 0;
  mockNextWorks = [];
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe('listening back', () => {
  it('gives each file a new player and lets the last one go', () => {
    const { api } = mount();
    act(() => api().toggle('a.wav'));
    expect(api().playingUri).toBe('a.wav');
    act(() => api().toggle('b.wav'));
    expect(mockPlayers.map((p) => [p.uri, p.removed])).toEqual([
      ['a.wav', true],
      ['b.wav', false],
    ]);
    expect(api().playingUri).toBe('b.wav');
  });

  it('pauses and resumes the same file on the same player', () => {
    const { api } = mount();
    act(() => api().toggle('a.wav'));
    act(() => api().toggle('a.wav'));
    expect(api().playingUri).toBeNull();
    act(() => api().toggle('a.wav'));
    expect(mockPlayers).toHaveLength(1);
    expect(api().playingUri).toBe('a.wav');
  });

  it('tries again on a new player, from the same point, when a play request is ignored', async () => {
    mockNextWorks = [false, true];
    const { api } = mount();
    act(() => api().play('night.m4a', 42));
    expect(api().playingUri).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1200);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockPlayers).toHaveLength(2);
    expect(mockPlayers[0].removed).toBe(true);
    expect(api().playingUri).toBe('night.m4a');
    expect(playbackLog()[0]).toMatch(/not playing after 1200 ms .*trying a new player/);
  });

  it('does not try again once the user has paused', async () => {
    mockNextWorks = [false];
    const { api } = mount();
    act(() => api().toggle('a.wav'));
    act(() => api().stop());
    await act(async () => {
      jest.advanceTimersByTime(3000);
      await Promise.resolve();
    });
    expect(mockPlayers).toHaveLength(1);
    expect(mockPlayers[0].removed).toBe(true);
  });

  it('lets the player go when the screen closes', () => {
    const { api, unmount } = mount();
    act(() => api().toggle('a.wav'));
    unmount();
    expect(mockPlayers[0].removed).toBe(true);
  });
});
