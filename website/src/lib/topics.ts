/** Article topics, in the order the filter chips show them. */
export const topics = ['remedies', 'habits', 'weather', 'monthly'] as const;
export type Topic = (typeof topics)[number];

export const topicLabels: Record<Topic, string> = {
  remedies: 'Remedies',
  habits: 'Habits',
  weather: 'Weather',
  monthly: 'Monthly report',
};
