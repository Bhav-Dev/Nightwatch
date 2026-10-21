import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, ScrollView } from 'react-native';

import type { ContributionSummary } from '../../../shared/api';
import { track } from '../../analytics';
import { getSetting, setSetting } from '../../data/settingsRepo';
import { CONTRIBUTION_BODY, CONTRIBUTION_TITLE, WHAT_LEAVES, WHAT_LEAVES_NOTE, WHAT_NEVER_LEAVES } from '../../screens/contributionCopy';
import { useApp } from '../../state/AppContext';
import { Body, Card, H2, Small, ToggleRow } from '../../ui/kit';
import { space } from '../../ui/theme';

/** The contribution toggle, the "what we share" page and what the user has contributed. */
export default function Sharing() {
  const db = useSQLiteContext();
  const { api } = useApp();
  const [on, setOn] = useState(false);
  const [summary, setSummary] = useState<ContributionSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setOn((await getSetting(db, 'contribution_opted_in')) === '1');
    if (api.configured) {
      const s = await api.contributionSummary().catch(() => null);
      if (s) {
        setSummary(s);
        setOn(s.opted_in);
      }
    }
  }, [api, db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const toggle = async (v: boolean) => {
    setBusy(true);
    try {
      if (api.configured) await api.setContribution(v);
      await setSetting(db, 'contribution_opted_in', v ? '1' : '0');
      track({ name: 'contribution_toggled', on: v });
      await load();
    } catch (e) {
      Alert.alert('Could not change this', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space(5) }}>
      <Card>
        <H2>{CONTRIBUTION_TITLE}</H2>
        <Body>{CONTRIBUTION_BODY}</Body>
        <ToggleRow label="Add my nights to the shared results" value={on} onChange={toggle} disabled={busy} />
        {summary?.opted_in ? (
          <Small style={{ marginTop: space(2) }}>
            You’ve contributed {summary.nights} nights and {summary.remedies_logged} remedy logs{summary.since ? ` since ${summary.since.slice(0, 10)}` : ''}. Turning this off removes them from the next nightly update.
          </Small>
        ) : null}
      </Card>
      <Card>
        <H2>What leaves your phone</H2>
        {WHAT_LEAVES.map((l) => (
          <Body key={l}>• {l}</Body>
        ))}
        <Small style={{ marginTop: space(2) }}>{WHAT_LEAVES_NOTE}</Small>
      </Card>
      <Card>
        <H2>What never does</H2>
        {WHAT_NEVER_LEAVES.map((l) => (
          <Body key={l}>• {l}</Body>
        ))}
      </Card>
      <Small>
        Shared nights are stored against a random contributor number that is never shown with your account, and results are only shown for groups of at least 10 people. We never sell or license this data.
      </Small>
    </ScrollView>
  );
}
