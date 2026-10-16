import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert } from 'react-native';

import { buildReportData } from '../report/buildReport';
import { REPORT_HEADER, reportHtml } from '../report/reportHtml';
import { Body, Button, Card, H2, Screen, Segmented, Small } from '../ui/kit';
import { space } from '../ui/theme';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Doctor's report: generated on the phone as a PDF and shared from here. */
export default function Report() {
  const db = useSQLiteContext();
  const [days, setDays] = useState<'14' | '30'>('30');
  const [busy, setBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - (Number(days) - 1) * 86_400_000);
      const data = await buildReportData(db, iso(from), iso(to));
      if (data.nights.length === 0) {
        Alert.alert('No nights in this period', 'Record a few nights first.');
        return;
      }
      const { uri } = await Print.printToFileAsync({ html: reportHtml(data) });
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share your report', UTI: 'com.adobe.pdf' });
    } catch (e) {
      Alert.alert('Could not create the report', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen sky="plain" footer={<Button label="Create PDF" onPress={generate} busy={busy} />}>
      <Card>
        <H2>What it includes</H2>
        <Body muted>Nights recorded, your score over time, snoring episodes by loudness, oxygen dips from your watch if connected, and how the factors and remedies you logged compare.</Body>
      </Card>
      <Segmented
        value={days}
        onChange={setDays}
        options={[
          { value: '14', label: 'Last 14 nights' },
          { value: '30', label: 'Last 30 nights' },
        ]}
      />
      <Small style={{ marginTop: space(2) }}>{REPORT_HEADER}</Small>
    </Screen>
  );
}
