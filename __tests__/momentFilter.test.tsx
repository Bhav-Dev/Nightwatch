import { act, create, type ReactTestInstance } from 'react-test-renderer';

import { SHOWN_KINDS, type ShownKind } from '../src/domain/moments';
import { MomentFilter } from '../src/ui/MomentFilter';

function render(show: ShownKind[], kinds: readonly ShownKind[] = SHOWN_KINDS) {
  const onChange = jest.fn();
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(<MomentFilter kinds={kinds} show={new Set(show)} counts={{ snore: 3, move: 8, awake: 0, other: 3 }} onChange={onChange} />);
  });
  const chip = (label: string) =>
    tree.root.find((n: ReactTestInstance) => typeof n.props.onPress === 'function' && typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith(label));
  return { tree, onChange, chip };
}

describe('moment chips', () => {
  it('turns one kind off and leaves the rest', () => {
    const { chip, onChange } = render([...SHOWN_KINDS]);
    expect(chip('Movement, 8').props.accessibilityState).toEqual({ checked: true });
    act(() => chip('Movement').props.onPress());
    expect([...onChange.mock.calls[0][0]].sort()).toEqual(['awake', 'other', 'snore']);
  });

  it('will not turn off the last kind shown', () => {
    const { chip, onChange } = render(['snore']);
    act(() => chip('Snoring').props.onPress());
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows everything again from All', () => {
    const { chip, onChange } = render(['awake']);
    act(() => chip('Show all').props.onPress());
    expect([...onChange.mock.calls[0][0]]).toEqual([...SHOWN_KINDS]);
  });

  it('offers only the kinds a night was checked for', () => {
    const { tree } = render(['snore', 'other'], ['snore', 'other']);
    const labels = tree.root.findAll((n: ReactTestInstance) => n.props.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function').map((n) => n.props.accessibilityLabel);
    expect(labels).toEqual(['Snoring, 3', 'Other, 3']);
  });
});
