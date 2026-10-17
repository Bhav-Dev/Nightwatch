import { createContext } from 'react';

/**
 * Lets something inside a scrolling screen (the timeline's scrubber) stop the screen scrolling
 * while it is being dragged. On Android the screen's scroll view otherwise takes a touch over as
 * soon as it drifts a few pixels up or down, which cancels the drag mid-way.
 */
export const ScrollLock = createContext<(locked: boolean) => void>(() => undefined);
