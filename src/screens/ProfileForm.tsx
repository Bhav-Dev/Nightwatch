import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import {
  AGE_BANDS,
  bmiBand,
  heightBand,
  POSITIONS,
  type ProfileBands,
  weightBand,
} from '../../shared/profile';
import { Chip } from '../ui/Chip';
import { Small } from '../ui/kit';
import { colors, radius, space } from '../ui/theme';

const POSITION_LABEL: Record<(typeof POSITIONS)[number], string> = { back: 'Back', side: 'Side', front: 'Front', mixed: 'It varies' };

function Choice<T extends string | boolean>({ label, value, options, onChange }: { label: string; value: T | null; options: { value: T; label: string }[]; onChange: (v: T | null) => void }) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.wrap}>
        {options.map((o) => (
          <Chip key={String(o.value)} label={o.label} selected={value === o.value} onPress={() => onChange(value === o.value ? null : o.value)} />
        ))}
      </View>
    </View>
  );
}

/**
 * Profile in bands. Exact height and weight can be typed for convenience; they are turned
 * into bands (and a BMI band) on the phone straight away and never stored or synced.
 */
export function ProfileForm({ value, onChange }: { value: ProfileBands; onChange: (p: ProfileBands) => void }) {
  const [cm, setCm] = useState('');
  const [kg, setKg] = useState('');

  const applyExact = (h: string, w: string) => {
    const hn = Number(h);
    const wn = Number(w);
    const next = { ...value };
    if (hn >= 120 && hn <= 230) next.height_band = heightBand(hn);
    if (wn >= 30 && wn <= 300) next.weight_band = weightBand(wn);
    if (hn >= 120 && hn <= 230 && wn >= 30 && wn <= 300) next.bmi_band = bmiBand(hn, wn);
    onChange(next);
  };

  return (
    <View>
      <Choice label="Age" value={value.age_band} options={AGE_BANDS.map((a) => ({ value: a, label: a }))} onChange={(v) => onChange({ ...value, age_band: v })} />
      <Choice
        label="Sex (optional)"
        value={value.sex}
        options={[
          { value: 'female', label: 'Female' },
          { value: 'male', label: 'Male' },
          { value: 'other', label: 'Other' },
        ]}
        onChange={(v) => onChange({ ...value, sex: v })}
      />
      <View style={styles.group}>
        <Text style={styles.label}>Height and weight</Text>
        <View style={{ flexDirection: 'row', gap: space(3) }}>
          <TextInput
            value={cm}
            onChangeText={(t) => {
              setCm(t);
              applyExact(t, kg);
            }}
            placeholder="Height, cm"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            style={styles.input}
            accessibilityLabel="Height in centimetres"
          />
          <TextInput
            value={kg}
            onChangeText={(t) => {
              setKg(t);
              applyExact(cm, t);
            }}
            placeholder="Weight, kg"
            placeholderTextColor={colors.textFaint}
            keyboardType="number-pad"
            style={styles.input}
            accessibilityLabel="Weight in kilograms"
          />
        </View>
        <Small style={{ marginTop: space(2) }}>
          {value.bmi_band ? `Saved as bands: ${value.height_band ?? '?'} cm, ${value.weight_band ?? '?'} kg, BMI ${value.bmi_band}. ` : ''}
          Only these bands are kept; the exact numbers are not stored.
        </Small>
      </View>
      <Choice
        label="How do you usually sleep?"
        value={value.position}
        options={POSITIONS.map((p) => ({ value: p, label: POSITION_LABEL[p] }))}
        onChange={(v) => onChange({ ...value, position: v })}
      />
      <Choice
        label="Has anyone said you stop breathing at night?"
        value={value.pauses_reported}
        options={[
          { value: 'yes', label: 'Yes' },
          { value: 'no', label: 'No' },
          { value: 'not_sure', label: 'Not sure' },
        ]}
        onChange={(v) => onChange({ ...value, pauses_reported: v })}
      />
      <Choice
        label="Diagnosed with sleep apnoea?"
        value={value.apnoea_dx}
        options={[
          { value: true, label: 'Yes' },
          { value: false, label: 'No' },
        ]}
        onChange={(v) => onChange({ ...value, apnoea_dx: v })}
      />
      <Choice
        label="Do you use CPAP?"
        value={value.cpap}
        options={[
          { value: true, label: 'Yes' },
          { value: false, label: 'No' },
        ]}
        onChange={(v) => onChange({ ...value, cpap: v })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: space(5) },
  label: { color: colors.text, fontSize: 16, fontWeight: '600', marginBottom: space(2) },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    borderRadius: radius.button,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    fontSize: 16,
  },
});
