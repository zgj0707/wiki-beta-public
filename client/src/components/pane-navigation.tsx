import { createContext, useContext, type ReactNode } from 'react';

export type PaneSide = 'left' | 'right';
export type PaneTarget = { kind: 'article'; id: string; focusText?: string };
export type PaneSnapshot = PaneTarget & { label?: string };
type PaneNavigationValue = { side: PaneSide; openInOppositePane: (target: PaneTarget) => void };
const PaneNavigationContext = createContext<PaneNavigationValue | null>(null);
const paneSnapshots: Record<PaneSide, PaneSnapshot | null> = { left: null, right: null };
export function getPaneSnapshots() { return { ...paneSnapshots }; }
export function setPaneSnapshot(side: PaneSide, snapshot: PaneSnapshot | null) {
  paneSnapshots[side] = snapshot;
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('pane-context-change'));
}

export function PaneNavigationProvider({ side, onNavigate, children }: { side: PaneSide; onNavigate?: (target: PaneTarget, from: PaneSide) => void; children: ReactNode }) {
  return <PaneNavigationContext.Provider value={{ side, openInOppositePane: (target) => onNavigate?.(target, side) }}>{children}</PaneNavigationContext.Provider>;
}
export function usePaneNavigation() { return useContext(PaneNavigationContext); }
