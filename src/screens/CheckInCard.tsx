import { Pressable, StyleSheet, Text, View } from 'react-native';

import { PARTNER_OPTIONS, RESTED_OPTIONS } from '../domain/checkIn';
import { Card, H2, Small } from '../ui/kit';
import { colors, radius, space } from '../ui/theme';

/**
 * The morning check-in: how rested the person feels, and how their partner slept (not asked on
 * nights they slept alone). Tapping the chosen answer again clears it. Read-only once the
 * night's log can no longer be edited.
 */
export function CheckInCard({
  rested,
  partner,
  askPartner,
  editable,
  onRested,
  onPartner,
}: {
  rested: number | null;
  partner: number | null;
  askPartner: boolean;
  editable: boolean;
  onRested: (value: number | null) => void;
  onPartner: (value: number | null) => void;
}) {
  if (!editable && rested === null && partner === null) return null;
  const row = (options: readonly { value: number; label: string }[], chosen: number | null, onPick: (v: number | null) => void, question: string) => (
    <View style={styles.row} accessibilityRole="radiogroup" accessibilityLabel={question}>
      {options.map((o) => {
        const on = chosen === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onPick(on ? null : o.value)}
            disabled={!editable}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: !editable }}
            style={[styles.option, on && styles.optionOn]}
          >
            <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1} adjustsFontSizeToFit>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <Card>
      <H2>{editable ? 'How do you feel this morning?' : 'How you felt'}</H2>
      {row(RESTED_OPTIONS, rested, onRested, 'How rested do you feel')}
      {askPartner ? (
        <>
          <Small style={{ marginTop: space(4) }}>How did your partner sleep?</Small>
          {row(PARTNER_OPTIONS, partner, onPartner, 'How did your partner sleep')}
        </>
      ) : null}
      {editable ? <Small style={{ marginTop: space(3) }}>Your remedies and patterns are compared on this too, so you can see what helps you feel better.</Small> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space(1.5), marginTop: space(2) },
  option: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space(2.5),
    paddingHorizontal: space(1),
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  optionOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.text, fontSize: 13, fontWeight: '700' },
  labelOn: { color: colors.accentText },
});
