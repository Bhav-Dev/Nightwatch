import { useEffect, useId, useMemo, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Mask, RadialGradient, Rect, Stop } from 'react-native-svg';

import { colors, sky, type SkyVariant } from './theme';

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
  const stars = useMemo(() => starField(variant === 'deep' ? 28 : 70, 11), [variant]);
  const dim = variant === 'deep' ? 0.35 : variant === 'dawn' ? 0.55 : 1;
  // At dawn the stars fade out lower down the sky.
  const reach = variant === 'dawn' ? 0.5 : 0.8;
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
          <Circle key={i} cx={st.x * width} cy={st.y * height * reach} r={st.r} fill="#FFFFFF" opacity={st.o * dim} />
        ))}
      </Svg>
      {variant === 'night' ? <Twinkles width={width} height={height * reach} /> : null}
    </View>
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
