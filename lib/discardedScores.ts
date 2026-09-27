const listeners = new Set<(id: string) => void>();

export function markScoreDeleted(id: string): void {
  for (const listener of listeners) {
    listener(id);
  }
}

export function subscribeScoreDeleted(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
