import { Stack } from 'expo-router';

import { colors } from '../../ui/theme';

export default function OnboardingLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, gestureEnabled: false }} />;
}
