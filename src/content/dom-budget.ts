export interface RoundCost {
  nodeCount: number;
}

export interface DomBudgetConfig {
  minRounds: number;
  targetRounds: number;
  maxRounds: number;
  domBudget: number;
}

export interface DomBudgetDecision {
  keepFromIndex: number;
  keptRounds: number;
  activeNodes: number;
}

export function chooseDomWindow(rounds: RoundCost[], config: DomBudgetConfig): DomBudgetDecision {
  if (rounds.length === 0) return { keepFromIndex: 0, keptRounds: 0, activeNodes: 0 };

  const minRounds = Math.min(rounds.length, Math.max(1, config.minRounds));
  const targetRounds = Math.min(rounds.length, Math.max(minRounds, config.targetRounds));
  const maxRounds = Math.min(rounds.length, Math.max(targetRounds, config.maxRounds));
  const budget = Math.max(1, config.domBudget);

  let keptRounds = 0;
  let activeNodes = 0;

  for (let index = rounds.length - 1; index >= 0 && keptRounds < maxRounds; index -= 1) {
    const round = rounds[index];
    if (!round) continue;
    const nextCost = Math.max(1, round.nodeCount);
    const mustKeep = keptRounds < minRounds;
    const belowTarget = keptRounds < targetRounds;
    const fitsBudget = activeNodes + nextCost <= budget;

    if (!mustKeep && !belowTarget && !fitsBudget) break;
    if (!mustKeep && belowTarget && !fitsBudget) break;

    activeNodes += nextCost;
    keptRounds += 1;
  }

  return {
    keepFromIndex: Math.max(0, rounds.length - keptRounds),
    keptRounds,
    activeNodes
  };
}
