import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { PITCH_WORDS } from '../domain/pitch';
import { RATING_WORDS, type SnoreProfile } from '../domain/snoreProfile';
import { Card, H2, Small } from '../ui/kit';
import { RatingCells } from '../ui/RatingCells';
import { colors, space } from '../ui/theme';

/** On Trends: the snore profile at a glance, opening the whole profile. */
export function SnoreProfileCard({ profile }: { profile: SnoreProfile }) {
  const { pitch } = profile;
  return (
    <Card onPress={() => router.push('/snore-profile')}>
      <H2 right={<Text style={styles.open}>Open ›</Text>}>Your snore profile</H2>
      <Small>Clues to where your snoring may come from: how it sounds, and what changes it.</Small>
      <View style={styles.rows}>
        <View style={styles.row} accessible accessibilityLabel={`How it sounds: ${pitch.band ? PITCH_WORDS[pitch.band].title : 'needs more nights'}`}>
          <Text style={styles.name}>How it sounds</Text>
          <Text style={[styles.value, !pitch.band && styles.muted]}>{pitch.band ? PITCH_WORDS[pitch.band].title : RATING_WORDS.more_nights}</Text>
        </View>
        {profile.areas.map((a) => (
          <View key={a.area} style={styles.row} accessible accessibilityLabel={`${a.name}: ${RATING_WORDS[a.rating]}`}>
            <Text style={styles.name}>{a.name}</Text>
            <View style={styles.rating}>
              <RatingCells rating={a.rating} />
              <Text style={[styles.value, a.rating === 'more_nights' && styles.muted]}>{RATING_WORDS[a.rating]}</Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  open: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  rows: { marginTop: space(2) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space(3),
    paddingVertical: space(2.5),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  name: { color: colors.text, fontSize: 15, fontWeight: '700' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  value: { color: colors.text, fontSize: 14, fontWeight: '600' },
  muted: { color: colors.textMuted },
});
