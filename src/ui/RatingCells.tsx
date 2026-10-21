import Svg, { Path } from 'react-native-svg';

import type { Rating } from '../domain/snoreProfile';
import { hexPath } from './Hive';
import { colors } from './theme';

const FILLED: Record<Rating, number> = { strong: 3, some: 2, none: 1, more_nights: 0 };

/**
 * A snore profile rating as three honeycomb cells: three in honey for a strong effect, two for
 * some, one faint cell for no clear effect yet, and empty outlines while it needs more nights.
 * Decorative: the rating is always written next to it.
 */
export function RatingCells({ rating, size = 13 }: { rating: Rating; size?: number }) {
  const r = size / 2;
  const w = Math.sqrt(3) * r;
  const gap = 2;
  const filled = FILLED[rating];
  const fill = rating === 'none' ? colors.textFaint : colors.accent;
  return (
    <Svg width={3 * w + 2 * gap} height={size} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {[0, 1, 2].map((i) => (
        <Path
          key={i}
          d={hexPath(w / 2 + i * (w + gap), r, r - 0.75, r * 0.2)}
          fill={i < filled ? fill : 'none'}
          stroke={i < filled ? fill : colors.borderStrong}
          strokeWidth={1.5}
        />
      ))}
    </Svg>
  );
}
