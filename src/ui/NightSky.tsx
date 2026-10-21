import { useEffect, useId, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Mask, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

import { hexPath } from './Hive';
import { isMorningSky, sky, type SkyVariant } from './theme';

/** A seeded random sequence, so the sky looks the same every time. */
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** A fixed, scattered star field: the same sky every time (seeded), denser towards the top. */
function starField(count: number, seed: number) {
  const rand = seeded(seed);
  return Array.from({ length: count }, () => ({ x: rand(), y: Math.pow(rand(), 1.6), r: 0.5 + rand() * 1.1, o: 0.25 + rand() * 0.55 }));
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(true);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduce);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => sub.remove();
  }, []);
  return reduce;
}

/**
 * Values running 0 to 1 over and over, one per duration. Each is a single native timing in a
 * loop (no delays or sequences, which did not always restart on iOS), so it never stops.
 */
function useLoops(durationsMs: readonly number[], reduce: boolean): Animated.Value[] {
  const key = durationsMs.join(',');
  const durations = useMemo(() => key.split(',').map(Number), [key]);
  const values = useMemo(() => durations.map(() => new Animated.Value(0)), [durations]);
  useEffect(() => {
    if (reduce) return;
    const loops = values.map((v, i) => Animated.loop(Animated.timing(v, { toValue: 1, duration: durations[i], easing: Easing.linear, useNativeDriver: true })));
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [values, durations, reduce]);
  return values;
}

/** Values swinging 0 to 1 and back, gently, one per duration (a half swing). */
function useSwings(durationsMs: readonly number[], reduce: boolean, from = 0): Animated.Value[] {
  const key = durationsMs.join(',');
  const durations = useMemo(() => key.split(',').map(Number), [key]);
  const values = useMemo(() => durations.map(() => new Animated.Value(from)), [durations, from]);
  useEffect(() => {
    if (reduce) return;
    const ease = Easing.inOut(Easing.sin);
    const loops = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: durations[i], easing: ease, useNativeDriver: true }),
          Animated.timing(v, { toValue: from, duration: durations[i], easing: ease, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [values, durations, from, reduce]);
  return values;
}

/** How much of the sun shows through each morning's weather. */
function sunFor(variant: SkyVariant): { glow: number; core: number; rings: boolean } | null {
  switch (variant) {
    case 'dawn':
    case 'dawnPartly':
      return { glow: 1, core: 1, rings: true };
    case 'dawnCloudy':
      return { glow: 0.45, core: 0.45, rings: false };
    case 'dawnFog':
      return { glow: 0.3, core: 0, rings: false };
    default:
      return null;
  }
}

interface CloudSpec {
  /** Top, as a share of the screen's height. */
  top: number;
  scale: number;
  /** Seconds to cross the screen. */
  crossS: number;
  /** Where along its crossing it starts (0 to 1), so the clouds are spread out. */
  phase: number;
  /** Cell colour as "r, g, b", and its strength. */
  rgb: string;
  alpha: number;
  flip?: boolean;
}

const WHITE = '255, 255, 255';
const RAIN_GREY = '228, 233, 242';
const CLOUDS: Partial<Record<SkyVariant, CloudSpec[]>> = {
  dawnPartly: [
    { top: 0.094, scale: 1, crossS: 120, phase: 0.33, rgb: WHITE, alpha: 0.6 },
    { top: 0.032, scale: 0.72, crossS: 160, phase: 0.75, rgb: WHITE, alpha: 0.5, flip: true },
  ],
  dawnCloudy: [
    { top: 0.034, scale: 1.1, crossS: 130, phase: 0.15, rgb: WHITE, alpha: 0.58 },
    { top: 0.119, scale: 0.85, crossS: 150, phase: 0.63, rgb: WHITE, alpha: 0.5, flip: true },
    { top: 0.172, scale: 0.7, crossS: 175, phase: 0.34, rgb: WHITE, alpha: 0.42 },
    { top: 0.08, scale: 0.62, crossS: 190, phase: 0.79, rgb: WHITE, alpha: 0.4, flip: true },
  ],
  dawnRain: [
    { top: 0.023, scale: 1.15, crossS: 140, phase: 0.21, rgb: RAIN_GREY, alpha: 0.6 },
    { top: 0.105, scale: 0.9, crossS: 165, phase: 0.6, rgb: RAIN_GREY, alpha: 0.5, flip: true },
    { top: 0.167, scale: 0.7, crossS: 185, phase: 0.32, rgb: RAIN_GREY, alpha: 0.42 },
  ],
  dawnSnow: [
    { top: 0.03, scale: 1.05, crossS: 150, phase: 0.33, rgb: WHITE, alpha: 0.62 },
    { top: 0.126, scale: 0.8, crossS: 175, phase: 0.69, rgb: WHITE, alpha: 0.5, flip: true },
  ],
};

/** The background of every screen: a gradient sky, with hexagon stars at night and the weather in the morning. */
export function NightSky({ variant = 'night' }: { variant?: SkyVariant }) {
  const { width, height } = useWindowDimensions();
  const id = `sky${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const stops = sky[variant];
  const morning = isMorningSky(variant);
  // No stars in the morning or on plain screens; fewer and dimmer while recording.
  const stars = useMemo(() => (morning || variant === 'plain' ? [] : starField(variant === 'deep' ? 28 : 70, 11)), [variant, morning]);
  const dim = variant === 'deep' ? 0.35 : 1;
  const reach = 0.8;
  const sun = sunFor(variant);
  const clouds = CLOUDS[variant];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {stops.map((c, i) => (
              <Stop key={c} offset={i / (stops.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
        {stars.map((st, i) => (
          <Path key={i} d={hexPath(st.x * width, st.y * height * reach, 1 + st.r * 0.9, 0.3)} fill={i % 5 === 0 ? '#FFE6A8' : '#FFFFFF'} opacity={st.o * dim} />
        ))}
      </Svg>
      {variant === 'night' ? <Twinkles width={width} height={height * reach} /> : null}
      {sun ? <HexSun width={width} height={height} {...sun} /> : null}
      {variant === 'dawnFog' ? <Fog width={width} height={height} /> : null}
      {variant === 'dawnRain' ? <Rain width={width} height={height} /> : null}
      {variant === 'dawnSnow' ? <Snow width={width} height={height} /> : null}
      {clouds ? <HoneyClouds width={width} height={height} clouds={clouds} /> : null}
    </View>
  );
}

/**
 * The morning sun as a honey cell: a glow, the cell itself, and, on clear mornings, two hexagon
 * rings that slowly swell and six small cells circling very slowly.
 */
function HexSun({ width, height, glow, core, rings }: { width: number; height: number; glow: number; core: number; rings: boolean }) {
  const id = `sun${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const reduce = useReduceMotion();
  const [breathe] = useSwings([3500], reduce || !rings);
  const [spin] = useLoops([90_000], reduce || !rings);
  const cx = width * 0.76;
  const cy = height * 0.1;
  const r = width * 0.105;
  const glowR = width * 0.42;
  const ringBox = r * 1.85 * 2 + 8;
  const rayDist = r * 1.9;
  const rayBox = (rayDist + r * 0.2) * 2 + 4;
  return (
    <>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={`${id}glow`} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor="#FFF4D6" stopOpacity={0.95 * glow} />
            <Stop offset="0.32" stopColor="#FFD9A0" stopOpacity={0.5 * glow} />
            <Stop offset="0.7" stopColor="#FFC58A" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id={`${id}core`} cx="42%" cy="36%" r="70%">
            <Stop offset="0" stopColor="#FFFBEF" />
            <Stop offset="0.45" stopColor="#FFE6A8" />
            <Stop offset="1" stopColor="#F6C85F" />
          </RadialGradient>
        </Defs>
        <Circle cx={cx} cy={cy} r={glowR} fill={`url(#${id}glow)`} />
        {core > 0 ? <Path d={hexPath(cx, cy, r, r * 0.14)} fill={`url(#${id}core)`} opacity={core} /> : null}
      </Svg>
      {rings ? (
        <>
          <Animated.View
            style={{
              position: 'absolute',
              left: cx - ringBox / 2,
              top: cy - ringBox / 2,
              opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }),
              transform: [{ scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] }) }],
            }}
          >
            <Svg width={ringBox} height={ringBox}>
              <Path d={hexPath(ringBox / 2, ringBox / 2, r * 1.4, r * 0.12)} fill="none" stroke="rgba(255, 244, 214, 0.75)" strokeWidth={2} />
              <Path d={hexPath(ringBox / 2, ringBox / 2, r * 1.85, r * 0.12)} fill="none" stroke="rgba(255, 244, 214, 0.4)" strokeWidth={1.5} />
            </Svg>
          </Animated.View>
          <Animated.View
            style={{
              position: 'absolute',
              left: cx - rayBox / 2,
              top: cy - rayBox / 2,
              transform: [{ rotate: spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] }) }],
            }}
          >
            <Svg width={rayBox} height={rayBox}>
              {Array.from({ length: 6 }, (_, k) => {
                const a = (Math.PI / 180) * (60 * k - 60);
                return (
                  <Path key={k} d={hexPath(rayBox / 2 + rayDist * Math.cos(a), rayBox / 2 + rayDist * Math.sin(a), r * 0.18, r * 0.03)} fill="#FFE6A8" opacity={0.85} />
                );
              })}
            </Svg>
          </Animated.View>
        </>
      ) : null}
    </>
  );
}

/** One honeycomb cloud: eleven cells in three rows, lighter at the top. Drawn in a box 142 by 83. */
const CLOUD_W = 142;
const CLOUD_H = 83;
const CLOUD_CELLS: readonly [number, number, number][] = [
  [28, 0, 1],
  [56, 0, 0.95],
  [14, 24.25, 0.86],
  [42, 24.25, 0.92],
  [70, 24.25, 0.86],
  [98, 24.25, 0.78],
  [0, 48.5, 0.68],
  [28, 48.5, 0.74],
  [56, 48.5, 0.78],
  [84, 48.5, 0.72],
  [112, 48.5, 0.62],
];

function HoneyCloud({ rgb, alpha }: { rgb: string; alpha: number }) {
  return (
    <Svg width={CLOUD_W} height={CLOUD_H}>
      {CLOUD_CELLS.map(([x, y, k]) => (
        <Path key={`${x},${y}`} d={hexPath(x + 15, y + 16.5, 15, 2.2)} fill={`rgba(${rgb}, ${(alpha * k).toFixed(2)})`} />
      ))}
    </Svg>
  );
}

/** Honeycomb clouds drifting steadily across the upper sky, each at its own pace, round and round. */
function HoneyClouds({ width, height, clouds }: { width: number; height: number; clouds: readonly CloudSpec[] }) {
  const reduce = useReduceMotion();
  const drift = useLoops(
    clouds.map((c) => c.crossS * 1000),
    reduce,
  );
  return (
    <>
      {clouds.map((c, i) => {
        const from = -CLOUD_W * c.scale - 10;
        const to = width + 10;
        const translateX = reduce
          ? from + c.phase * (to - from)
          : Animated.modulo(Animated.add(drift[i], c.phase), 1).interpolate({ inputRange: [0, 1], outputRange: [from, to] });
        return (
          <Animated.View key={i} style={{ position: 'absolute', left: 0, top: c.top * height, transform: [{ translateX }] }}>
            {/* Scaled from its top left, so its width on screen is CLOUD_W * scale; mirrored about its middle. */}
            <View style={{ transform: [{ scale: c.scale }], transformOrigin: 'top left', width: CLOUD_W, height: CLOUD_H }}>
              <View style={{ transform: [{ scaleX: c.flip ? -1 : 1 }] }}>
                <HoneyCloud rgb={c.rgb} alpha={c.alpha} />
              </View>
            </View>
          </Animated.View>
        );
      })}
    </>
  );
}

/**
 * Two sheets of rain, near and far, each a pattern one sheet tall drawn twice, one above the
 * other, and moved down by exactly its height over and over, so the rain never stops or bunches.
 */
const RAIN_LAYERS = [
  { seed: 23, count: 46, len: [9, 15], w: 1, alpha: 0.36, ms: 1700 },
  { seed: 41, count: 26, len: [16, 26], w: 1.6, alpha: 0.55, ms: 1050 },
] as const;

function Rain({ width, height }: { width: number; height: number }) {
  const reduce = useReduceMotion();
  const id = `rain${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const fall = useLoops(
    RAIN_LAYERS.map((l) => l.ms),
    reduce,
  );
  const sheetW = width * 1.4;
  const sheetH = height + 80;
  const layers = useMemo(
    () =>
      RAIN_LAYERS.map((l) => {
        const rand = seeded(l.seed);
        return Array.from({ length: l.count }, () => ({ x: rand() * sheetW, y: rand() * sheetH, h: l.len[0] + rand() * (l.len[1] - l.len[0]) }));
      }),
    [sheetW, sheetH],
  );
  return (
    // Tilted a little, as if blown; wider than the screen so the corners stay full.
    <View style={{ position: 'absolute', left: -width * 0.2, top: -40, width: sheetW, height: sheetH, transform: [{ rotate: '9deg' }] }}>
      {RAIN_LAYERS.map((l, i) => (
        <Animated.View
          key={l.seed}
          style={{
            position: 'absolute',
            left: 0,
            top: -sheetH,
            width: sheetW,
            height: sheetH * 2,
            transform: [{ translateY: reduce ? 0 : fall[i].interpolate({ inputRange: [0, 1], outputRange: [0, sheetH] }) }],
          }}
        >
          <Svg width={sheetW} height={sheetH * 2}>
            <Defs>
              <LinearGradient id={`${id}${i}`} x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={l.alpha} />
              </LinearGradient>
            </Defs>
            {layers[i].flatMap((d, k) => [
              <Rect key={`a${k}`} x={d.x} y={d.y} width={l.w} height={d.h} rx={l.w / 2} fill={`url(#${id}${i})`} />,
              <Rect key={`b${k}`} x={d.x} y={d.y + sheetH} width={l.w} height={d.h} rx={l.w / 2} fill={`url(#${id}${i})`} />,
            ])}
          </Svg>
        </Animated.View>
      ))}
    </View>
  );
}

/** Six-sided snowflakes in two sheets, near and far, swaying gently as they fall. */
const SNOW_LAYERS = [
  { seed: 29, count: 34, size: [3, 5], alpha: 0.6, ms: 16_000, swayMs: 6000 },
  { seed: 37, count: 22, size: [5, 8], alpha: 0.92, ms: 10_000, swayMs: 4500 },
] as const;

function Snow({ width, height }: { width: number; height: number }) {
  const reduce = useReduceMotion();
  const fall = useLoops(
    SNOW_LAYERS.map((l) => l.ms),
    reduce,
  );
  const sway = useSwings(
    SNOW_LAYERS.map((l) => l.swayMs),
    reduce,
  );
  const sheetW = width + 40;
  const sheetH = height + 40;
  const layers = useMemo(
    () =>
      SNOW_LAYERS.map((l) => {
        const rand = seeded(l.seed);
        return Array.from({ length: l.count }, () => ({ x: rand() * sheetW, y: rand() * sheetH, r: (l.size[0] + rand() * (l.size[1] - l.size[0])) / Math.sqrt(3) }));
      }),
    [sheetW, sheetH],
  );
  return (
    <>
      {SNOW_LAYERS.map((l, i) => (
        <Animated.View
          key={l.seed}
          style={{
            position: 'absolute',
            left: -20,
            top: -20,
            width: sheetW,
            height: sheetH,
            transform: [{ translateX: reduce ? 0 : sway[i].interpolate({ inputRange: [0, 1], outputRange: [-9, 9] }) }],
          }}
        >
          <Animated.View
            style={{
              position: 'absolute',
              left: 0,
              top: -sheetH,
              width: sheetW,
              height: sheetH * 2,
              transform: [{ translateY: reduce ? 0 : fall[i].interpolate({ inputRange: [0, 1], outputRange: [0, sheetH] }) }],
            }}
          >
            <Svg width={sheetW} height={sheetH * 2}>
              {layers[i].flatMap((f, k) => [
                <Path key={`a${k}`} d={hexPath(f.x, f.y, f.r, f.r * 0.15)} fill="#FFFFFF" opacity={l.alpha} />,
                <Path key={`b${k}`} d={hexPath(f.x, f.y + sheetH, f.r, f.r * 0.15)} fill="#FFFFFF" opacity={l.alpha} />,
              ])}
            </Svg>
          </Animated.View>
        </Animated.View>
      ))}
    </>
  );
}

/** Soft bands of mist, each a pale band with a row of faint overlapping cells, drifting to and fro. */
const FOG_BANDS = [
  { top: 0.046, ms: 40_000, alpha: 0.14, shift: 0 },
  { top: 0.135, ms: 55_000, alpha: 0.12, shift: -30 },
  { top: 0.224, ms: 70_000, alpha: 0.1, shift: -12 },
] as const;

function Fog({ width, height }: { width: number; height: number }) {
  const reduce = useReduceMotion();
  const drift = useSwings(
    FOG_BANDS.map((b) => b.ms),
    reduce,
  );
  const bandW = width * 1.6;
  const cellR = 48;
  return (
    <>
      {FOG_BANDS.map((b, i) => (
        <Animated.View
          key={b.top}
          style={{
            position: 'absolute',
            left: -width * 0.3,
            top: b.top * height,
            width: bandW,
            height: 110,
            transform: [{ translateX: reduce ? 0 : drift[i].interpolate({ inputRange: [0, 1], outputRange: [-50, 50] }) }],
          }}
        >
          <View style={{ position: 'absolute', left: 0, top: 10, width: bandW, height: 90, borderRadius: 45, backgroundColor: `rgba(255, 255, 255, ${b.alpha})` }} />
          <Svg width={bandW} height={110}>
            {Array.from({ length: Math.ceil(bandW / 74) + 1 }, (_, k) => (
              <Path key={k} d={hexPath(k * 74 + b.shift + 42, (k % 2 ? 12 : 2) + cellR, cellR, 6)} fill="rgba(255, 255, 255, 0.09)" />
            ))}
          </Svg>
        </Animated.View>
      ))}
    </>
  );
}

/** A few brighter hexagon stars that slowly twinkle (still when the system asks for reduced motion). */
function Twinkles({ width, height }: { width: number; height: number }) {
  const reduce = useReduceMotion();
  const spots = useMemo(() => starField(6, 3), []);
  const values = useSwings(
    spots.map((_, i) => 1800 + i * 450),
    reduce,
    0.25,
  );
  return (
    <>
      {spots.map((s, i) => (
        <Animated.View key={i} style={[styles.twinkle, { left: s.x * width - 4, top: s.y * height - 4, opacity: reduce ? 0.6 : values[i] }]}>
          <Svg width={8} height={8}>
            <Path d={hexPath(4, 4, 3.4, 0.6)} fill="#FFF6DA" />
          </Svg>
        </Animated.View>
      ))}
    </>
  );
}

/** The honeycomb moon's cells, in its own 200-unit box centred on 0. */
const MOON_R = 60;
const MOON_COMB = (() => {
  const r = 14;
  const step = r * Math.sqrt(3);
  const cells: string[] = [];
  for (let row = -4; row <= 4; row++) {
    for (let col = -3; col <= 3; col++) cells.push(hexPath(col * step + (row % 2 ? step / 2 : 0), row * r * 1.5, r, 1));
  }
  return cells;
})();

/**
 * The moon as a honey cell: a hexagon with a faint comb across it, its shadow a circle, so it
 * reads as a crescent. It fills 60% of the square, in a soft glow.
 */
export function Moon({ size = 96, glow = true }: { size?: number; glow?: boolean }) {
  const id = `moon${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="-100 -100 200 200">
      <Defs>
        <RadialGradient id={`${id}glow`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor="#FFE9AE" stopOpacity={0.34} />
          <Stop offset="0.6" stopColor="#FFE9AE" stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={`${id}fill`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFF2C2" />
          <Stop offset="0.55" stopColor="#F7D990" />
          <Stop offset="1" stopColor="#F2B088" />
        </LinearGradient>
        <Mask id={`${id}mask`} maskUnits="userSpaceOnUse" x={-100} y={-100} width={200} height={200}>
          <Rect x={-100} y={-100} width={200} height={200} fill="#000000" />
          <Path d={hexPath(0, 0, MOON_R, MOON_R * 0.12)} fill="#FFFFFF" />
          <Circle cx={MOON_R * 0.55} cy={-MOON_R * 0.39} r={MOON_R * 0.935} fill="#000000" />
        </Mask>
      </Defs>
      {glow ? <Circle cx={0} cy={0} r={100} fill={`url(#${id}glow)`} /> : null}
      <G mask={`url(#${id}mask)`}>
        <Rect x={-MOON_R} y={-MOON_R} width={MOON_R * 2} height={MOON_R * 2} fill={`url(#${id}fill)`} />
        {MOON_COMB.map((d, i) => (
          <Path key={i} d={d} fill="none" stroke="rgba(233, 162, 63, 0.3)" strokeWidth={1.3} />
        ))}
      </G>
    </Svg>
  );
}

/** The moon, slowly brightening and dimming like breathing (for the recording screen). */
export function BreathingMoon({ size = 110 }: { size?: number }) {
  const reduce = useReduceMotion();
  const glow = useMemo(() => new Animated.Value(0.55), []);
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.95, duration: 4000, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.55, duration: 4000, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, glow]);
  return (
    <Animated.View style={{ opacity: reduce ? 0.75 : glow }}>
      <Moon size={size} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  twinkle: { position: 'absolute', width: 8, height: 8 },
});
