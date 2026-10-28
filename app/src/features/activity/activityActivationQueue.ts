export interface ActivityActivationLease {
  generation: number;
  isCurrent: () => boolean;
}

export function createActivityActivationQueue(options: {
  timeoutMs: number;
  onTimeout: (generation: number) => void;
  onError: (error: unknown) => void;
}): {
  enqueue: (task: (lease: ActivityActivationLease) => Promise<void>) => Promise<void>;
  currentGeneration: () => number;
} {
  let chain: Promise<void> = Promise.resolve();
  let generation = 0;
  return {
    enqueue(task) {
      const operationGeneration = ++generation;
      const lease: ActivityActivationLease = {
        generation: operationGeneration,
        isCurrent: () => operationGeneration === generation,
      };
      const prior = chain.catch(() => undefined);
      const actualSettlement = prior.then(() => task(lease)).catch(options.onError);
      let timeout: ReturnType<typeof setTimeout> | null = null;
      const boundedSettlement = Promise.race([
        actualSettlement,
        new Promise<void>(resolve => {
          timeout = setTimeout(() => {
            options.onTimeout(operationGeneration);
            resolve();
          }, options.timeoutMs);
        }),
      ]).finally(() => {
        if (timeout) clearTimeout(timeout);
      });
      // Recovery commands wait for bounded acknowledgement, not an immortal
      // native Promise. Generation fencing prevents late older work from
      // publishing ownership or compensating against the newer command.
      chain = boundedSettlement;
      void actualSettlement;
      return boundedSettlement;
    },
    currentGeneration: () => generation,
  };
}
