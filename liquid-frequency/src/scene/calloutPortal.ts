import type { RefObject } from 'react';

/**
 * One stable DOM layer for every 3D-anchored HTML call-out.
 * drei's <Html> otherwise resolves its mount target at mount and again at
 * unmount, and the two can differ — which throws on removeChild.
 */
export const calloutPortal = { current: null } as { current: HTMLElement | null };
export const calloutPortalRef = calloutPortal as unknown as RefObject<HTMLElement>;
