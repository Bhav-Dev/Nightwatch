import { Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { bundledCatalogue } from '../src/domain/catalogue';
import { LogPicker } from '../src/screens/LogPicker';

jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

function render(types: ('remedy' | 'factor')[], selected = new Map<string, string | null>()) {
  const onSet = jest.fn();
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(
      <LogPicker visible title="Remedies tonight" types={types} items={bundledCatalogue} selected={selected} onSet={onSet} onClose={() => undefined} />,
    );
  });
  const texts = () => tree.root.findAllByType(Text).map((t) => [t.props.children].flat().join(''));
  const byLabel = (label: string) => tree.root.find((n: ReactTestInstance) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
  return { tree, onSet, texts, byLabel };
}

describe('log picker', () => {
  it('lists the most common remedies first, then the rest by category', () => {
    const { texts } = render(['remedy']);
    const all = texts();
    expect(all).toContain('Most common');
    expect(all).toContain('Nothing selected');
    expect(all.indexOf('Most common')).toBeLessThan(all.findIndex((t) => t === 'Nasal' || t === 'Position'));
  });

  it('ticks and unticks a plain item', () => {
    const { tree, onSet } = render(['remedy']);
    const first = tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function')[0];
    act(() => first.props.onPress());
    expect(onSet).toHaveBeenCalledWith(expect.objectContaining({ type: 'remedy' }), null, true);
  });

  it('picks an alcohol band, and tapping the chosen band clears it', () => {
    const alcohol = bundledCatalogue.find((i) => i.id === 'alcohol')!;
    const pick = render(['factor']);
    act(() => pick.byLabel('Alcohol, 3-4 units').props.onPress());
    expect(pick.onSet).toHaveBeenCalledWith(alcohol, '3-4', true);

    const clear = render(['factor'], new Map([['alcohol', '3-4']]));
    expect(clear.texts()).toContain('1 selected');
    act(() => clear.byLabel('Alcohol, 3-4 units').props.onPress());
    expect(clear.onSet).toHaveBeenCalledWith(alcohol, null, false);
  });
});
