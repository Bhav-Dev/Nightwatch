import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { setStatusBarStyle } from 'expo-status-bar';
import { createContext, type ReactNode, useCallback, useContext } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NightSky } from './NightSky';
import { colors, fonts, onSky, radius, space, type SkyVariant } from './theme';

/** The sky the current screen is drawn on, so cards and header text can suit it. */
const SkyContext = createContext<SkyVariant>('night');
export const useSky = () => useContext(SkyContext);

export function Screen({
  title,
  eyebrow,
  left,
  right,
  children,
  scroll = true,
  footer,
  sky = 'night',
  subtitle,
}: {
  title?: string;
  eyebrow?: string;
  /** A line under the title (the morning's weather). */
  subtitle?: string | null;
  /** Before the title (a back arrow, on screens opened from another). */
  left?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  scroll?: boolean;
  footer?: ReactNode;
  /** The sky behind the screen: night (default), deep (recording) or dawn (this morning). */
  sky?: SkyVariant;
}) {
  const tones = onSky[sky];
  // A bright sky (the sunrise) wants dark status bar icons while this screen is showing.
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(tones.statusBar);
      return () => setStatusBarStyle('light');
    }, [tones.statusBar]),
  );
  const header =
    title || eyebrow || right || left ? (
      <View style={styles.header}>
        {left}
        <View style={{ flex: 1 }}>
          {eyebrow ? <Text style={[styles.eyebrow, { color: tones.eyebrow }]}>{eyebrow}</Text> : null}
          {title ? <Text style={[styles.title, { color: tones.title }]}>{title}</Text> : null}
          {subtitle ? <Text style={[styles.subtitle, { color: tones.title }]}>{subtitle}</Text> : null}
        </View>
        {right}
      </View>
    ) : null;
  return (
    <SkyContext.Provider value={sky}>
      <View style={styles.screen}>
        <NightSky variant={sky} />
        <SafeAreaView style={styles.safe} edges={['top']}>
          {scroll ? (
            <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
              {header}
              {children}
            </ScrollView>
          ) : (
            <View style={[styles.content, { flex: 1 }]}>
              {header}
              {children}
            </View>
          )}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </SafeAreaView>
      </View>
    </SkyContext.Provider>
  );
}

export function GearLink() {
  const sky = useSky();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/settings')} hitSlop={12} style={styles.iconButton}>
      <Ionicons name="settings-outline" size={22} color={onSky[sky].icon} />
    </Pressable>
  );
}

/** Back to the previous screen, drawn on the sky so the sky can run to the top of the screen. */
export function BackLink() {
  const sky = useSky();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} hitSlop={12} style={styles.backButton}>
      <Ionicons name="chevron-back" size={26} color={onSky[sky].icon} />
    </Pressable>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const surface = { backgroundColor: onSky[useSky()].card };
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" onPress={onPress} style={[styles.card, surface, style]}>
        {children}
      </Pressable>
    );
  }
  return <View style={[styles.card, surface, style]}>{children}</View>;
}

export function H2({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.h2Row}>
      <Text style={styles.h2}>{children}</Text>
      {right}
    </View>
  );
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  return <Text style={[styles.body, muted && { color: colors.textMuted }, style]}>{children}</Text>;
}

export function Small({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.small, style]}>{children}</Text>;
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
  busy,
  style,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger' | 'link';
  disabled?: boolean;
  busy?: boolean;
  style?: ViewStyle;
}) {
  const base = kind === 'primary' ? styles.primary : kind === 'link' ? styles.link : styles.secondary;
  const textStyle =
    kind === 'primary' ? styles.primaryLabel : kind === 'danger' ? styles.dangerLabel : kind === 'link' ? styles.linkLabel : styles.secondaryLabel;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      disabled={disabled || busy}
      onPress={onPress}
      style={[base, (disabled || busy) && { opacity: 0.5 }, style]}
    >
      {busy ? <ActivityIndicator color={kind === 'primary' ? colors.accentText : colors.text} /> : <Text style={textStyle}>{label}</Text>}
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; locked?: boolean }[]; onChange: (v: T) => void }) {
  return (
    <View style={styles.segmented} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="tab"
          accessibilityState={{ selected: o.value === value }}
          onPress={() => onChange(o.value)}
          style={[styles.segment, o.value === value && styles.segmentOn]}
        >
          <Text style={[styles.segmentLabel, o.value === value && styles.segmentLabelOn]}>
            {o.label}
            {o.locked ? ' 🔒' : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Row({ label, value, onPress, right }: { label: string; value?: string; onPress?: () => void; right?: ReactNode }) {
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} onPress={onPress} disabled={!onPress} style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {right}
      {onPress && !right ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
    </Pressable>
  );
}

export function ToggleRow({ label, value, onChange, hint, disabled }: { label: string; value: boolean; onChange: (v: boolean) => void; hint?: string; disabled?: boolean }) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        {hint ? <Text style={styles.small}>{hint}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.accent, false: colors.borderStrong }}
        thumbColor={colors.text}
        accessibilityLabel={label}
      />
    </View>
  );
}

/** Shown in place of a paid feature: never a blank space, always a way to the paywall. */
export function Locked({ label, trigger }: { label: string; trigger: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}. Part of the paid plan.`}
      onPress={() => router.push({ pathname: '/paywall', params: { trigger } })}
      style={styles.locked}
    >
      <Ionicons name="lock-closed-outline" size={16} color={colors.accent} />
      <Text style={styles.lockedLabel}>{label}</Text>
    </Pressable>
  );
}

export function Loading() {
  return (
    <View style={{ padding: space(8), alignItems: 'center' }}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Card style={{ borderColor: colors.danger }}>
      <Body>{message}</Body>
      {onRetry ? <Button kind="link" label="Try again" onPress={onRetry} /> : null}
    </Card>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },
  content: { padding: space(5), paddingBottom: space(10) },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space(5) },
  eyebrow: { color: colors.accent, fontSize: 13, fontFamily: fonts.headingSemi, letterSpacing: 1.4, textTransform: 'uppercase' },
  title: { color: colors.text, fontSize: 28, fontFamily: fonts.heading, marginTop: space(1) },
  subtitle: { fontSize: 16, fontFamily: fonts.headingSemi, opacity: 0.8, marginTop: space(1) },
  footer: { padding: space(5), paddingTop: space(2) },
  iconButton: { padding: space(1) },
  backButton: { alignSelf: 'flex-start', marginLeft: -space(2), marginRight: space(1), paddingVertical: space(1), paddingRight: space(1) },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(5),
    marginBottom: space(4),
  },
  h2Row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(3) },
  h2: { color: colors.text, fontSize: 18, fontFamily: fonts.headingSemi },
  body: { color: colors.text, fontSize: 15, lineHeight: 22 },
  small: { color: colors.textFaint, fontSize: 13, lineHeight: 18 },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: space(4),
    alignItems: 'center',
    paddingHorizontal: space(6),
    boxShadow: '0px 6px 24px rgba(246, 200, 95, 0.28)',
  },
  primaryLabel: { color: colors.accentText, fontSize: 17, fontFamily: fonts.heading },
  secondary: {
    borderRadius: radius.button,
    paddingVertical: space(3.5),
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: space(5),
  },
  secondaryLabel: { color: colors.text, fontSize: 16, fontFamily: fonts.headingSemi },
  dangerLabel: { color: colors.danger, fontSize: 16, fontFamily: fonts.headingSemi },
  link: { paddingVertical: space(2) },
  linkLabel: { color: colors.accent, fontSize: 15, fontWeight: '600' },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.chip, padding: 3, marginBottom: space(4) },
  segment: { flex: 1, paddingVertical: space(2), borderRadius: radius.chip, alignItems: 'center' },
  segmentOn: { backgroundColor: colors.surfaceRaised },
  segmentLabel: { color: colors.textMuted, fontWeight: '600' },
  segmentLabelOn: { color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space(3.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: space(3),
  },
  rowLabel: { color: colors.text, fontSize: 16, flex: 1 },
  rowValue: { color: colors.textMuted, fontSize: 15 },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(2),
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.button,
    padding: space(4),
    marginVertical: space(2),
  },
  lockedLabel: { color: colors.textMuted, fontSize: 15, flex: 1 },
});
