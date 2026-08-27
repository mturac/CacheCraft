import { compareCodeUnits } from "./compare.js";
import { CacheCraftError } from "./errors.js";
import type { Diagnostic, OrderedPlan, PromptPlan, PromptSection, Stability } from "./types.js";

const STABILITY_RANK: Record<Stability, number> = {
  global: 0,
  deployment: 1,
  session: 2,
  turn: 3,
  request: 4
};

const CACHE_RANK = {
  required: 0,
  preferred: 1,
  never: 2
} as const;

function addEdge(edges: Map<string, Set<string>>, from: string, to: string): void {
  if (from === to) {
    edges.get(from)?.add(to);
    return;
  }
  edges.get(from)?.add(to);
}

function buildGraph(plan: PromptPlan): {
  edges: Map<string, Set<string>>;
  indegree: Map<string, number>;
} {
  const edges = new Map<string, Set<string>>();
  const indegree = new Map<string, number>();
  for (const section of plan.sections) {
    edges.set(section.id, new Set());
    indegree.set(section.id, 0);
  }

  for (const section of plan.sections) {
    for (const dependency of section.after) {
      addEdge(edges, dependency, section.id);
    }
    for (const target of section.before) {
      addEdge(edges, section.id, target);
    }
  }

  const instructions = plan.sections.filter((section) => section.lane === "instructions");
  const conversation = plan.sections.filter((section) => section.lane === "conversation");
  for (const instruction of instructions) {
    for (const message of conversation) {
      addEdge(edges, instruction.id, message.id);
    }
  }

  for (const lane of ["instructions", "conversation"] as const) {
    const laneSections = plan.sections.filter((section) => section.lane === lane);
    for (const [anchorIndex, anchor] of laneSections.entries()) {
      if (anchor.order !== "preserve") {
        continue;
      }
      for (let index = 0; index < anchorIndex; index += 1) {
        const earlier = laneSections[index];
        if (earlier !== undefined) {
          addEdge(edges, earlier.id, anchor.id);
        }
      }
      for (let index = anchorIndex + 1; index < laneSections.length; index += 1) {
        const later = laneSections[index];
        if (later !== undefined) {
          addEdge(edges, anchor.id, later.id);
        }
      }
    }
  }

  for (const targets of edges.values()) {
    for (const target of targets) {
      indegree.set(target, (indegree.get(target) ?? 0) + 1);
    }
  }
  return { edges, indegree };
}

function compareSections(left: PromptSection, right: PromptSection, sourceIndex: Map<string, number>): number {
  const stability = STABILITY_RANK[left.stability] - STABILITY_RANK[right.stability];
  if (stability !== 0) {
    return stability;
  }
  const cache = CACHE_RANK[left.cache.mode] - CACHE_RANK[right.cache.mode];
  if (cache !== 0) {
    return cache;
  }
  const source = (sourceIndex.get(left.id) ?? 0) - (sourceIndex.get(right.id) ?? 0);
  if (source !== 0) {
    return source;
  }
  return compareCodeUnits(left.id, right.id);
}

function volatilityDiagnostics(sections: PromptSection[]): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const instructions = sections.filter((section) => section.lane === "instructions");
  let mostVolatileBefore = -1;
  let mostVolatileSection: PromptSection | undefined;

  for (const section of instructions) {
    const rank = STABILITY_RANK[section.stability];
    if (mostVolatileBefore > rank && mostVolatileSection !== undefined) {
      diagnostics.push({
        code: "CC101_VOLATILE_BEFORE_STABLE",
        severity: "warning",
        message: `Section ${mostVolatileSection.id} (${mostVolatileSection.stability}) is forced before more stable section ${section.id} (${section.stability}).`,
        sectionId: section.id,
        details: {
          precedingSectionId: mostVolatileSection.id,
          precedingStability: mostVolatileSection.stability,
          sectionStability: section.stability
        }
      });
    }
    if (rank > mostVolatileBefore) {
      mostVolatileBefore = rank;
      mostVolatileSection = section;
    }
  }
  return diagnostics;
}

export function orderSections(plan: PromptPlan): OrderedPlan {
  const byId = new Map(plan.sections.map((section) => [section.id, section]));
  const sourceIndex = new Map(plan.sections.map((section, index) => [section.id, index]));
  const { edges, indegree } = buildGraph(plan);
  const available = plan.sections.filter((section) => indegree.get(section.id) === 0);
  const ordered: PromptSection[] = [];

  while (available.length > 0) {
    available.sort((left, right) => compareSections(left, right, sourceIndex));
    const section = available.shift();
    if (section === undefined) {
      break;
    }
    ordered.push(section);

    for (const target of edges.get(section.id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        const targetSection = byId.get(target);
        if (targetSection !== undefined) {
          available.push(targetSection);
        }
      }
    }
  }

  if (ordered.length !== plan.sections.length) {
    const remaining = plan.sections
      .filter((section) => !ordered.some((entry) => entry.id === section.id))
      .map((section) => section.id)
      .sort(compareCodeUnits);
    throw new CacheCraftError(
      "CC_DEPENDENCY_CYCLE",
      `Dependency constraints cannot be satisfied: ${remaining.join(", ")}.`,
      { details: { cycleCandidates: remaining } }
    );
  }

  return {
    plan,
    sections: ordered,
    diagnostics: volatilityDiagnostics(ordered)
  };
}
