/**
 * Small charts drawn with react-native-svg. Rules followed throughout: one y-axis only, thin
 * marks, bars with rounded data-ends on a shared baseline, recessive grid, text in text
 * colours (never the series colour), and tap-to-inspect instead of hover.
 */
import { useContext, useId, useRef, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { ScrollLock } from './scrollLock';
import { hexPath } from './Hive';
import { colors, intensityColor, momentColor } from './theme';
import { colourRuns, labelX, outlineAmplitudes, outlinePath } from './timelineShape';

function useWidth(initial = 320) {
  const [w, setW] = useState(initial);
  return [w, (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)] as const;
}

/** Rounded top on a bar anchored to the baseline. */
function barPath(x: number, w: number, top: number, base: number): string {
  const r = Math.min(4, w / 2, (base - top) / 2);
  if (base - top <= 0.5) return '';
  return `M${x},${base} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${base} Z`;
}

export interface TimelineBin {
  index: number;
  snoreS: number;
  /** Mean level above the night's floor; sets the outline's height. */
  levelDb: number;
  intensity: keyof typeof intensityColor | null;
}

/** Stretches marked on the timeline, each in its kind's colour (see momentColor). */
export interface TimelineMarks {
  /** Snoring: a honey mark above the outline at each stretch, which also shows short ones. */
  snoring?: readonly { startS: number; endS: number }[];
  /** Loud sounds not counted as snoring: a mark above the outline. */
  other?: readonly { startS: number; endS: number }[];
  /** Movement: a tick under the outline. */
  movement?: readonly { startS: number; endS: number }[];
  /** Heavy breathing: a line under the outline, as long as the stretch. */
  breathing?: readonly { startS: number; endS: number }[];
  /** Restless stretches: shaded behind. */
  restless?: readonly { startS: number; endS: number }[];
  /** Possibly awake: a band behind. */
  awake?: readonly { startS: number; endS: number }[];
}

/**
 * The night as a loudness outline mirrored around a centre line, in 5-minute bins: its height is
 * how loud each stretch was, and stretches with snoring are filled with their loudest intensity.
 * Everything else that happened is marked on the same chart in its own colour and shape: marks
 * above for snoring and other sounds, ticks below for movement, a line below for heavy breathing,
 * bands behind for possibly awake.
 * Drag along it to scrub through the night (the time shows in a bubble) and let go to pick that
 * moment; the picked or playing second is a line.
 */
export function NightTimeline({
  bins,
  startedAtS,
  onSelect,
  playheadS,
  cursorS,
  highlight,
  marks = {},
  showSnoring = true,
  onStep,
  soundUntilS,
  overlay,
  height = 110,
}: {
  bins: TimelineBin[];
  startedAtS: number;
  /** A tap, or the end of a drag: the 5-minute bin and the second of the night it landed on. */
  onSelect?: (index: number, atS: number) => void;
  /** Where playback is, in seconds from the start. */
  playheadS?: number | null;
  /** The picked second, shown when nothing is playing. */
  cursorS?: number | null;
  /** The picked moment, shaded on the timeline. */
  highlight?: { startS: number; endS: number } | null;
  marks?: TimelineMarks;
  /** Fill the outline where there was snoring (off when snoring is filtered out). */
  showSnoring?: boolean;
  /** Screen reader swipe up or down: the next or previous moment. */
  onStep?: (direction: 1 | -1) => void;
  /** Sleep sounds played until this second: shaded behind the outline. */
  soundUntilS?: number | null;
  /** Optional thin lines drawn under the chart (SpO2, heart rate), each scaled to its own band. */
  overlay?: { label: string; points: { x: number; y: number }[]; color: string }[];
  /** The outline's height; the marks, ticks and hours add to it. */
  height?: number;
}) {
  const [width, onLayout] = useWidth();
  const [scrubS, setScrubS] = useState<number | null>(null);
  /** The touch on the timeline: where it started, and whether it is a scrub or a scroll, once that is clear. */
  const drag = useRef<{ pageX: number; pageY: number; x: number; moved: boolean; mode: 'scrub' | 'scroll' | null } | null>(null);
  const lockScroll = useContext(ScrollLock);
  const clipId = `outline-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // From the top: the time bubble, the marks row, the outline, the ticks row, the hours.
  const bubbleH = onSelect ? 22 : 0;
  const marksH = 14;
  const ticksH = 14;
  const axisH = 16;
  const plotTop = bubbleH + marksH;
  const plotBottom = plotTop + height;
  const chartH = plotBottom + ticksH + axisH;
  const overlayH = overlay?.length ? 36 * overlay.length : 0;
  const centreY = plotTop + height / 2;
  const step = width / Math.max(bins.length, 1);
  const totalS = Math.max(1, bins.length * 300);
  const xAt = (s: number) => (Math.max(0, Math.min(totalS, s)) / totalS) * width;
  const sAt = (x: number) => Math.min(totalS - 1, Math.max(0, Math.round((x / Math.max(1, width)) * totalS)));
  const outline = outlinePath(outlineAmplitudes(bins.map((b) => b.levelDb)), width, centreY, height / 2 - 2);
  const runs = showSnoring ? colourRuns(bins.map((b) => b.intensity)) : [];
  const hourTicks: { x: number; label: string }[] = [];
  for (let i = 0; i < bins.length; i++) {
    const t = new Date((startedAtS + i * 300) * 1000);
    if (t.getMinutes() < 5) hourTicks.push({ x: i * step, label: `${String(t.getHours()).padStart(2, '0')}:00` });
  }
  const clock = (s: number) => new Date((startedAtS + s) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const lineS = scrubS ?? playheadS ?? cursorS ?? null;
  const bandTop = bubbleH;
  const bandH = plotBottom + ticksH - bubbleH;
  const span = (r: { startS: number; endS: number }) => Math.max(3, xAt(r.endS) - xAt(r.startS));
  const cap = (r: { startS: number }, colour: string) => (
    <Path key={`${colour}${r.startS}`} d={hexPath(Math.min(width - 5, Math.max(5, xAt(r.startS))), bubbleH + marksH / 2, 5.5, 1)} fill={colour} />
  );

  const touchX = (e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d) return e.nativeEvent.locationX;
    if (Math.abs(e.nativeEvent.pageX - d.pageX) > 6) d.moved = true;
    return d.x + (e.nativeEvent.pageX - d.pageX);
  };
  const finish = (atS: number) => {
    setScrubS(null);
    drag.current = null;
    lockScroll(false);
    onSelect?.(Math.min(bins.length - 1, Math.floor(atS / 300)), atS);
  };
  const cancel = () => {
    drag.current = null;
    setScrubS(null);
    lockScroll(false);
  };

  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={chartH + overlayH}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={outline} />
          </ClipPath>
        </Defs>
        {soundUntilS ? <Rect x={0} y={plotTop} width={xAt(soundUntilS)} height={height} rx={6} fill={colors.info} opacity={0.08} /> : null}
        {marks.awake?.map((a) => (
          <G key={`a${a.startS}`}>
            <Rect x={xAt(a.startS)} y={bandTop} width={span(a)} height={bandH} rx={4} fill={momentColor.awake} opacity={0.24} />
            <Rect x={xAt(a.startS)} y={bandTop} width={span(a)} height={2} rx={1} fill={momentColor.awake} />
          </G>
        ))}
        {marks.restless?.map((r) => (
          <Rect key={`r${r.startS}`} x={xAt(r.startS)} y={bandTop} width={span(r)} height={bandH} rx={4} fill={momentColor.move} opacity={0.14} />
        ))}
        {highlight ? (
          <Rect x={xAt(highlight.startS)} y={bandTop} width={span(highlight)} height={bandH} rx={2} fill={colors.text} opacity={0.12} />
        ) : null}
        <Line x1={0} x2={width} y1={centreY} y2={centreY} stroke={colors.border} strokeWidth={1} />
        <Path d={outline} fill={colors.textFaint} opacity={0.35} />
        <G clipPath={`url(#${clipId})`}>
          {runs.map((r) => (
            <Rect key={r.start} x={r.start * step} y={plotTop} width={(r.end - r.start) * step} height={height} fill={intensityColor[r.key]} />
          ))}
        </G>
        {marks.other?.map((o) => cap(o, momentColor.other))}
        {marks.snoring?.map((o) => cap(o, momentColor.snore))}
        {marks.breathing?.map((b) => (
          <Rect key={`b${b.startS}`} x={xAt(b.startS)} y={plotBottom + ticksH / 2 - 2} width={span(b)} height={4} rx={2} fill={momentColor.breathing} />
        ))}
        {marks.movement?.map((m) => (
          <Rect key={`m${m.startS}`} x={xAt(m.startS) - 1.5} y={plotBottom + 2} width={3} height={ticksH - 4} rx={1.5} fill={momentColor.move} />
        ))}
        {lineS !== null ? <Line x1={xAt(lineS)} x2={xAt(lineS)} y1={bandTop} y2={plotBottom + ticksH} stroke={colors.text} strokeWidth={2} /> : null}
        {hourTicks
          .filter((_, k) => hourTicks.length <= 8 || k % 2 === 0)
          .map((t) => (
            <SvgText key={t.x} x={labelX(t.x, width, 15)} y={chartH - 4} fill={colors.textFaint} fontSize={10} textAnchor="middle">
              {t.label}
            </SvgText>
          ))}
        {overlay?.map((o, k) => {
          const top = chartH + k * 36 + 6;
          const ys = o.points.map((p) => p.y);
          const lo = Math.min(...ys);
          const hi = Math.max(...ys);
          const sy = (y: number) => top + 24 - ((y - lo) / Math.max(1, hi - lo)) * 24;
          const d = o.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xAt(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
          return <Path key={o.label} d={d} stroke={o.color} strokeWidth={2} fill="none" strokeLinejoin="round" />;
        })}
      </Svg>
      {overlay?.map((o, k) => (
        <Text key={o.label} style={{ position: 'absolute', left: 0, top: chartH + k * 36 - 6, color: colors.textMuted, fontSize: 11 }}>
          {o.label}
        </Text>
      ))}
      {lineS !== null && onSelect ? (
        <View pointerEvents="none" style={[chartStyles.bubble, { left: Math.min(width - 64, Math.max(0, xAt(lineS) - 32)) }]}>
          <Text style={chartStyles.bubbleText}>{clock(lineS)}</Text>
        </View>
      ) : null}
      {onSelect ? (
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Timeline"
          accessibilityHint="Swipe up or down to move between moments. Drag to scrub through the night."
          accessibilityValue={{ text: lineS !== null ? clock(lineS) : 'Nothing picked' }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onStep?.(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          // Once a sideways drag has started, the screen does not take it over to scroll.
          onResponderTerminationRequest={() => drag.current?.mode !== 'scrub'}
          onResponderGrant={(e) => {
            // Hold the screen still until the first movement shows what this touch is for.
            lockScroll(true);
            drag.current = { pageX: e.nativeEvent.pageX, pageY: e.nativeEvent.pageY, x: e.nativeEvent.locationX, moved: false, mode: null };
          }}
          onResponderMove={(e) => {
            const d = drag.current;
            if (!d || d.mode === 'scroll') return;
            if (d.mode === null) {
              const dx = Math.abs(e.nativeEvent.pageX - d.pageX);
              const dy = Math.abs(e.nativeEvent.pageY - d.pageY);
              if (Math.max(dx, dy) < 6) return;
              d.mode = dx >= dy ? 'scrub' : 'scroll';
              if (d.mode === 'scroll') {
                // Up or down: let the screen scroll with this same touch.
                lockScroll(false);
                return;
              }
            }
            setScrubS(sAt(touchX(e)));
          }}
          onResponderRelease={(e) => {
            if (drag.current?.mode === 'scroll') cancel();
            else finish(sAt(touchX(e)));
          }}
          onResponderTerminate={cancel}
          style={{ position: 'absolute', left: 0, top: 0, width, height: chartH }}
        />
      ) : null}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  bubble: { position: 'absolute', top: 0, width: 64, alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 8, paddingVertical: 2 },
  bubbleText: { color: colors.text, fontSize: 12, fontWeight: '700' },
});

/** One series over time on a single 0–100 axis, with an optional moving average. */
/**
 * Nightly values over time with an optional average line. The picked night stands out: a honey
 * dot with a ring, a guide line and its value in a bubble above it. Nights that do not count
 * (short ones) are hollow dots. Dates, when given, run along the bottom.
 */
export function TrendChart({
  values,
  average,
  max = 100,
  height = 200,
  format = (v: number) => String(Math.round(v)),
  onSelect,
  selected,
  labels,
  muted,
}: {
  values: (number | null)[];
  average?: (number | null)[];
  max?: number;
  height?: number;
  format?: (v: number) => string;
  onSelect?: (i: number) => void;
  selected?: number | null;
  /** A short date for each point, shown along the bottom (a few of them when there are many). */
  labels?: string[];
  /** Points drawn hollow: nights left out of the averages. */
  muted?: boolean[];
}) {
  const [width, onLayout] = useWidth();
  const left = 28;
  const right = 14;
  const top = 30; // room for the picked night's bubble
  const bottom = labels ? 24 : 8;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const x = (i: number) => left + (values.length <= 1 ? plotW / 2 : (i / (values.length - 1)) * plotW);
  const y = (v: number) => top + (1 - v / max) * plotH;
  const path = (vs: (number | null)[]) => {
    let d = '';
    let pen = false;
    vs.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  const sel = selected !== null && selected !== undefined && values[selected] !== null && values[selected] !== undefined ? selected : null;
  const selValue = sel !== null ? (values[sel] as number) : null;
  const bubbleW = 44;
  const every = labels ? Math.max(1, Math.ceil(labels.length / 5)) : 1;
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        {[0, 0.5, 1].map((f) => (
          <Line key={f} x1={left} x2={width - right} y1={y(f * max)} y2={y(f * max)} stroke={colors.border} strokeWidth={1} />
        ))}
        {[0, 0.5, 1].map((f) => (
          <SvgText key={`t${f}`} x={0} y={y(f * max) + 4} fill={colors.textFaint} fontSize={10}>
            {format(f * max)}
          </SvgText>
        ))}
        {sel !== null ? <Line x1={x(sel)} x2={x(sel)} y1={top - 4} y2={y(0)} stroke={colors.borderStrong} strokeWidth={1.5} strokeDasharray="4 4" /> : null}
        {average ? <Path d={path(average)} stroke={colors.accent} strokeWidth={2} fill="none" strokeLinejoin="round" /> : null}
        <Path d={path(values)} stroke={colors.info} strokeWidth={2} fill="none" strokeLinejoin="round" opacity={average ? 0.6 : 1} />
        {values.map((v, i) =>
          v === null || i === sel ? null : (
            <Circle
              key={i}
              cx={x(i)}
              cy={y(v)}
              r={4}
              fill={muted?.[i] ? colors.bg : colors.info}
              stroke={muted?.[i] ? colors.info : colors.bg}
              strokeWidth={muted?.[i] ? 1.5 : 2}
            />
          ),
        )}
        {sel !== null && selValue !== null ? (
          <G>
            <Circle cx={x(sel)} cy={y(selValue)} r={11} fill={colors.accent} opacity={0.22} />
            <Circle cx={x(sel)} cy={y(selValue)} r={6.5} fill={muted?.[sel] ? colors.bg : colors.accent} stroke={colors.accent} strokeWidth={2.5} />
            <Rect
              x={Math.min(width - right - bubbleW, Math.max(left - 4, x(sel) - bubbleW / 2))}
              y={Math.max(2, y(selValue) - 36)}
              width={bubbleW}
              height={22}
              rx={11}
              fill={colors.accent}
            />
            <SvgText
              x={Math.min(width - right - bubbleW, Math.max(left - 4, x(sel) - bubbleW / 2)) + bubbleW / 2}
              y={Math.max(2, y(selValue) - 36) + 15}
              fill={colors.accentText}
              fontSize={12}
              fontWeight="700"
              textAnchor="middle"
            >
              {format(selValue)}
            </SvgText>
          </G>
        ) : null}
        {labels
          ? labels.map((label, i) =>
              i % every === 0 || i === labels.length - 1 ? (
                <SvgText
                  key={`l${i}`}
                  x={x(i)}
                  y={height - 6}
                  fill={i === sel ? colors.text : colors.textFaint}
                  fontSize={10}
                  fontWeight={i === sel ? '700' : '400'}
                  textAnchor={i === 0 ? 'start' : i === labels.length - 1 ? 'end' : 'middle'}
                >
                  {label}
                </SvgText>
              ) : null,
            )
          : null}
      </Svg>
      {onSelect ? (
        <View style={{ position: 'absolute', left: left - 10, top: 0, right: right - 10, height, flexDirection: 'row' }}>
          {values.map((v, i) => (
            <Pressable
              key={i}
              style={{ flex: 1 }}
              onPress={() => onSelect(i)}
              accessibilityRole="button"
              accessibilityState={{ selected: i === sel }}
              accessibilityLabel={`${labels?.[i] ?? `Night ${i + 1}`}${v === null ? '' : `, ${format(v)}`}`}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function Sparkline({ values, width = 80, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <View style={{ width, height }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - lo) / Math.max(1, hi - lo)) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <Svg width={width} height={height} accessibilityLabel="Score trend">
      <Path d={d} stroke={colors.info} strokeWidth={2} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Median change with its interquartile band on a shared −40…+40 scale centred on zero.
 * Negative (a lower snore score) is improvement.
 */
export function ChangeBar({ median, p25, p75, muted, width = 120, height = 18, range = 40 }: { median: number; p25: number; p75: number; muted?: boolean; width?: number; height?: number; range?: number }) {
  const x = (v: number) => ((Math.max(-range, Math.min(range, v)) + range) / (2 * range)) * width;
  const color = muted ? colors.textFaint : median < 0 ? colors.good : colors.worse;
  return (
    <Svg width={width} height={height} accessibilityLabel={`Median change ${Math.round(median)} points, middle half ${Math.round(p25)} to ${Math.round(p75)}`}>
      <Line x1={x(0)} x2={x(0)} y1={0} y2={height} stroke={colors.borderStrong} strokeWidth={1} />
      <Rect x={Math.min(x(p25), x(p75))} y={height / 2 - 3} width={Math.max(2, Math.abs(x(p75) - x(p25)))} height={6} rx={3} fill={color} opacity={0.35} />
      <Circle cx={x(median)} cy={height / 2} r={5} fill={color} stroke={colors.surface} strokeWidth={2} />
    </Svg>
  );
}

/** Distribution of per-person results in 5-point buckets. */
export function Histogram({ buckets, mark, height = 120 }: { buckets: { bucket: number; count: number }[]; mark?: number | null; height?: number }) {
  const [width, onLayout] = useWidth();
  const n = buckets.length;
  const gap = 2;
  const bw = (width - gap * (n - 1)) / Math.max(1, n);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const base = height - 16;
  const markIdx = mark === null || mark === undefined ? -1 : buckets.findIndex((b) => mark >= b.bucket && mark < b.bucket + 5);
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Line x1={0} x2={width} y1={base} y2={base} stroke={colors.border} />
        {buckets.map((b, i) => {
          const x = i * (bw + gap);
          const h = (b.count / max) * (base - 6);
          return <Path key={b.bucket} d={barPath(x, bw, base - h, base)} fill={b.bucket < 0 ? colors.good : colors.worse} opacity={i === markIdx ? 1 : 0.55} />;
        })}
        {markIdx >= 0 ? (
          <Line x1={markIdx * (bw + gap) + bw / 2} x2={markIdx * (bw + gap) + bw / 2} y1={0} y2={base} stroke={colors.text} strokeWidth={2} strokeDasharray="3,3" />
        ) : null}
        {[0, Math.floor(n / 2), n - 1].map((i) =>
          buckets[i] ? (
            <SvgText key={i} x={Math.min(width - 24, i * (bw + gap))} y={height - 2} fill={colors.textFaint} fontSize={10}>
              {buckets[i].bucket > 0 ? `+${buckets[i].bucket}` : buckets[i].bucket}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
}
