import { useEffect, useId, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors, isMorningSky, sky, type SkyVariant } from './theme';

/** A fixed, scattered star field: the same sky every time (seeded), denser towards the top. */
function starField(count: number, seed: number) {
  let s = seed;
  const rand = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
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

/** The background of every screen: a gradient sky with faint stars, fixed while content scrolls. */
export function NightSky({ variant = 'night' }: { variant?: SkyVariant }) {
  const { width, height } = useWindowDimensions();
  const id = `sky${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const stops = sky[variant];
  const morning = isMorningSky(variant);
  // No stars in the morning; fewer and dimmer while recording.
  const stars = useMemo(() => (morning ? [] : starField(variant === 'deep' ? 28 : 70, 11)), [variant, morning]);
  const dim = variant === 'deep' ? 0.35 : 1;
  const reach = 0.8;
  // How much of the sun shows through the weather.
  const sun = variant === 'dawn' || variant === 'dawnPartly' ? 1 : variant === 'dawnCloudy' ? 0.45 : variant === 'dawnFog' ? 0.3 : 0;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            {stops.map((c, i) => (
              <Stop key={c} offset={i / (stops.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
          {sun > 0 ? (
            <RadialGradient id={`${id}sun`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor="#FFF4D6" stopOpacity={0.95 * sun} />
              <Stop offset="0.3" stopColor="#FFD9A0" stopOpacity={0.55 * sun} />
              <Stop offset="1" stopColor="#FFC58A" stopOpacity={0} />
            </RadialGradient>
          ) : null}
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
        {sun > 0 ? (
          <>
            {/* The sun just rising over the top of the screen, and its warm glow. */}
            <Circle cx={width * 0.72} cy={height * 0.02} r={width * 0.62} fill={`url(#${id}sun)`} />
            {sun === 1 ? <Circle cx={width * 0.72} cy={height * 0.02} r={width * 0.085} fill="#FFF6E0" opacity={0.9} /> : null}
          </>
        ) : null}
        {stars.map((st, i) => (
          <Circle key={i} cx={st.x * width} cy={st.y * height * reach} r={st.r} fill="#FFFFFF" opacity={st.o * dim} />
        ))}
      </Svg>
      {variant === 'night' ? <Twinkles width={width} height={height * reach} /> : null}
      {variant === 'dawnPartly' ? <Clouds width={width} height={height} count={2} color="#FFFFFF" opacity={0.4} /> : null}
      {variant === 'dawnCloudy' ? <Clouds width={width} height={height} count={4} color="#FFFFFF" opacity={0.36} /> : null}
      {variant === 'dawnRain' ? (
        <>
          <Clouds width={width} height={height} count={4} color="#E4E9F2" opacity={0.3} />
          <Falling width={width} height={height} kind="rain" />
        </>
      ) : null}
      {variant === 'dawnSnow' ? <Falling width={width} height={height} kind="snow" /> : null}
      {variant === 'dawnFog' ? <Fog width={width} height={height} /> : null}
    </View>
  );
}

/** One soft cloud: overlapping circles, drawn in a box 160 by 64. */
function CloudShape({ color, opacity }: { color: string; opacity: number }) {
  return (
    <Svg width={160} height={64}>
      <Circle cx={48} cy={40} r={22} fill={color} opacity={opacity} />
      <Circle cx={80} cy={30} r={28} fill={color} opacity={opacity} />
      <Circle cx={114} cy={40} r={20} fill={color} opacity={opacity} />
      <Rect x={30} y={40} width={102} height={22} rx={11} fill={color} opacity={opacity} />
    </Svg>
  );
}

/** Clouds drifting slowly to and fro across the upper sky. */
function Clouds({ width, height, count, color, opacity }: { width: number; height: number; count: number; color: string; opacity: number }) {
  const reduce = useReduceMotion();
  const clouds = useMemo(() => starField(count, 17).map((c, i) => ({ x: c.x * width - 60, y: (0.05 + c.y * 0.3) * height, scale: 0.8 + c.o * 0.8, ms: 40_000 + i * 12_000 })), [count, width, height]);
  const drift = useMemo(() => clouds.map(() => new Animated.Value(0)), [clouds]);
  useEffect(() => {
    if (reduce) return;
    const loops = drift.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: clouds[i].ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: clouds[i].ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduce, drift, clouds]);
  return (
    <>
      {clouds.map((c, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: c.x,
            top: c.y,
            transform: [{ translateX: drift[i].interpolate({ inputRange: [0, 1], outputRange: [-40, 40] }) }, { scale: c.scale }],
          }}
        >
          <CloudShape color={color} opacity={opacity} />
        </Animated.View>
      ))}
    </>
  );
}

/** Gentle rain streaks or snowflakes falling (still, when reduced motion is on). */
function Falling({ width, height, kind }: { width: number; height: number; kind: 'rain' | 'snow' }) {
  const reduce = useReduceMotion();
  const rain = kind === 'rain';
  const items = useMemo(
    () =>
      starField(rain ? 36 : 30, rain ? 23 : 29).map((d) => ({
        x: d.x * width,
        restY: d.y * height * 0.85,
        delay: d.o * (rain ? 1500 : 6000),
        ms: rain ? 1100 + d.r * 600 : 7000 + d.r * 4000,
        size: rain ? 12 + d.r * 10 : 3 + d.r * 2.5,
      })),
    [rain, width, height],
  );
  const values = useMemo(() => items.map(() => new Animated.Value(0)), [items]);
  useEffect(() => {
    if (reduce) return;
    const loops = values.map((v, i) =>
      Animated.loop(Animated.sequence([Animated.delay(items[i].delay), Animated.timing(v, { toValue: 1, duration: items[i].ms, easing: Easing.linear, useNativeDriver: true })])),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduce, values, items]);
  return (
    <>
      {items.map((it, i) => (
        <Animated.View
          key={i}
          style={[
            rain ? { width: 1.5, height: it.size, borderRadius: 1, backgroundColor: 'rgba(255, 255, 255, 0.45)' } : { width: it.size, height: it.size, borderRadius: it.size / 2, backgroundColor: 'rgba(255, 255, 255, 0.8)' },
            {
              position: 'absolute',
              left: it.x,
              top: 0,
              transform: [{ translateY: reduce ? it.restY : values[i].interpolate({ inputRange: [0, 1], outputRange: [-30, height * 0.9] }) }],
            },
          ]}
        />
      ))}
    </>
  );
}

/** Soft bands of mist drifting slowly across. */
function Fog({ width, height }: { width: number; height: number }) {
  const reduce = useReduceMotion();
  const bands = useMemo(() => [0.12, 0.27, 0.44].map((y, i) => ({ y: y * height, h: 70 + i * 18, ms: 45_000 + i * 15_000 })), [height]);
  const drift = useMemo(() => bands.map(() => new Animated.Value(0)), [bands]);
  useEffect(() => {
    if (reduce) return;
    const loops = drift.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: bands[i].ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
          Animated.timing(v, { toValue: 0, duration: bands[i].ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduce, drift, bands]);
  return (
    <>
      {bands.map((b, i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            left: -width * 0.3,
            top: b.y,
            width: width * 1.6,
            height: b.h,
            borderRadius: b.h / 2,
            backgroundColor: 'rgba(255, 255, 255, 0.2)',
            transform: [{ translateX: drift[i].interpolate({ inputRange: [0, 1], outputRange: [-width * 0.15, width * 0.15] }) }],
          }}
        />
      ))}
    </>
  );
}

/** A few brighter stars that slowly twinkle (still when the system asks for reduced motion). */
function Twinkles({ width, height }: { width: number; height: number }) {
  const reduce = useReduceMotion();
  const spots = useMemo(() => starField(6, 3), []);
  const values = useMemo(() => spots.map(() => new Animated.Value(0.3)), [spots]);
  useEffect(() => {
    if (reduce) return;
    const loops = values.map((v, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: 1800 + i * 450, useNativeDriver: true }),
          Animated.timing(v, { toValue: 0.25, duration: 2200 + i * 380, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, [reduce, values]);
  return (
    <>
      {spots.map((s, i) => (
        <Animated.View
          key={i}
          style={[styles.twinkle, { left: s.x * width, top: s.y * height, opacity: reduce ? 0.6 : values[i] }]}
        />
      ))}
    </>
  );
}

/** A crescent moon with a soft glow. */
export function Moon({ size = 96, glow = true }: { size?: number; glow?: boolean }) {
  const id = `moon${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const c = size / 2;
  const r = size * 0.3;
  return (
    <Svg width={size} height={size}>
      <Defs>
        <RadialGradient id={`${id}glow`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={colors.accent} stopOpacity={0.3} />
          <Stop offset="1" stopColor={colors.accent} stopOpacity={0} />
        </RadialGradient>
        <Mask id={`${id}cut`}>
          <Rect x={0} y={0} width={size} height={size} fill="#FFFFFF" />
          <Circle cx={c + r * 0.55} cy={c - r * 0.35} r={r * 0.92} fill="#000000" />
        </Mask>
      </Defs>
      {glow ? <Circle cx={c} cy={c} r={size / 2} fill={`url(#${id}glow)`} /> : null}
      <Circle cx={c} cy={c} r={r} fill={colors.accent} mask={`url(#${id}cut)`} />
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
  twinkle: { position: 'absolute', width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#FFF6DA' },
});
