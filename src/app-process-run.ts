import { createHash } from "node:crypto";
import {
  checkAppProcessGate,
  type AppProcess,
  type AppProcessGateReportedVerification,
  type AppProcessGateResult,
  type AppProcessStory,
} from "./app-process.js";
import type { BlueprintCommand } from "./blueprint.js";

export const APP_PROCESS_DRAFT_SECTIONS = [
  "productDefinition",
  "roadmap",
  "backlog",
  "ux",
  "security",
] as const;

export type AppProcessDraftSectionId = (typeof APP_PROCESS_DRAFT_SECTIONS)[number];

export type AppProcessRunEventType =
  | "run_initialized"
  | "section_accepted"
  | "story_prepared"
  | "continue_blocked"
  | "verification_recorded";

export type AppProcessRunEvent = {
  eventId: string;
  type: AppProcessRunEventType;
  at: string;
  summary: string;
  data?: Record<string, unknown>;
};

export type AppProcessSectionAcceptance = {
  section: AppProcessDraftSectionId;
  acceptedAt: string;
  acceptedBy?: string;
  note?: string;
};

export type AppProcessVerificationRecord = {
  verificationId: string;
  command: string;
  args: string[];
  status: "passed" | "failed" | "skipped";
  recordedAt: string;
  evidencePath?: string;
  summary?: string;
};

export type AppProcessContinuation = {
  continuationId: string;
  action: "prepare_story" | "blocked";
  status: "prepared" | "blocked";
  createdAt: string;
  storyId?: string;
  title?: string;
  ownerLane?: AppProcessStory["ownerLane"];
  phase?: number;
  blockedBy?: string[];
  nextAction: string;
};

export type AppProcessRunState = {
  schemaVersion: "app-process-run.v0";
  appProcessId: string;
  repoRoot: string;
  createdAt: string;
  updatedAt: string;
  acceptedDraftSections: AppProcessSectionAcceptance[];
  verificationRecords: AppProcessVerificationRecord[];
  continuations: AppProcessContinuation[];
  events: AppProcessRunEvent[];
};

export type AppProcessArtifactFreshness = {
  relativePath: string;
  status: "fresh" | "missing" | "stale";
  reason?: string;
  mtimeMs?: number;
};

export type AppProcessNextAction =
  | {
      kind: "accept_section";
      section: AppProcessDraftSectionId;
      reason: string;
    }
  | {
      kind: "continue_story";
      storyId: string;
      ownerLane: AppProcessStory["ownerLane"];
      reason: string;
    }
  | {
      kind: "record_verification";
      command: string;
      args: string[];
      reason: string;
    }
  | {
      kind: "none";
      reason: string;
    };

export type AppProcessRunStatusReport = {
  schemaVersion: "app-process-status.v0";
  appProcessId: string;
  repoRoot: string;
  status: "blocked" | "ready";
  currentPhase: number;
  gate: AppProcessGateResult;
  blockedGates: AppProcessGateResult["findings"];
  acceptedDraftSections: AppProcessDraftSectionId[];
  unacceptedDraftSections: AppProcessDraftSectionId[];
  verification: {
    requiredCommands: BlueprintCommand[];
    records: AppProcessVerificationRecord[];
    missingCommands: string[];
  };
  currentContinuation?: AppProcessContinuation;
  nextAction: AppProcessNextAction;
  artifacts: AppProcessArtifactFreshness[];
};

export type CreateInitialAppProcessRunStateInput = {
  appProcess: AppProcess;
  now?: string;
};

export type AppProcessRunMutationResult = {
  runState: AppProcessRunState;
  event?: AppProcessRunEvent;
};

export function createInitialAppProcessRunState(
  input: CreateInitialAppProcessRunStateInput,
): AppProcessRunState {
  const now = input.now ?? new Date().toISOString();
  const event = createEvent({
    type: "run_initialized",
    at: now,
    summary: `Initialized app-process run state for ${input.appProcess.appProcessId}.`,
    data: { appProcessId: input.appProcess.appProcessId },
  });
  return {
    schemaVersion: "app-process-run.v0",
    appProcessId: input.appProcess.appProcessId,
    repoRoot: input.appProcess.repoRoot,
    createdAt: now,
    updatedAt: now,
    acceptedDraftSections: [],
    verificationRecords: [],
    continuations: [],
    events: [event],
  };
}

export function createAppProcessRunStatus(input: {
  appProcess: AppProcess;
  runState: AppProcessRunState;
  artifacts?: AppProcessArtifactFreshness[];
}): AppProcessRunStatusReport {
  const acceptedDraftSections = orderedAcceptedSections(input.runState);
  const unacceptedDraftSections = APP_PROCESS_DRAFT_SECTIONS.filter((section) => {
    const appProcessSection = input.appProcess[section];
    return appProcessSection.status === "ai_drafted" && !acceptedDraftSections.includes(section);
  });
  const reportedVerification = input.runState.verificationRecords.map(toReportedVerification);
  const gate = checkAppProcessGate({
    appProcess: input.appProcess,
    action: {
      completionClaim: true,
      acceptedDraftSections,
      reportedVerification,
    },
  });
  const missingCommands = input.appProcess.verification.value.requiredCommands
    .filter((required) =>
      !input.runState.verificationRecords.some((record) =>
        verificationMatches(required, record),
      ),
    )
    .map((command) => [command.command, ...command.args].join(" "));
  const currentContinuation = latestPreparedContinuation(input.runState);
  const nextAction = chooseNextAction({
    appProcess: input.appProcess,
    unacceptedDraftSections,
    missingCommands,
    currentContinuation,
  });

  return {
    schemaVersion: "app-process-status.v0",
    appProcessId: input.appProcess.appProcessId,
    repoRoot: input.appProcess.repoRoot,
    status: gate.status === "pass" ? "ready" : "blocked",
    currentPhase: input.appProcess.roadmap.value.currentPhase,
    gate,
    blockedGates: gate.findings.filter((finding) => finding.severity === "block"),
    acceptedDraftSections,
    unacceptedDraftSections,
    verification: {
      requiredCommands: input.appProcess.verification.value.requiredCommands,
      records: input.runState.verificationRecords,
      missingCommands,
    },
    ...(currentContinuation ? { currentContinuation } : {}),
    nextAction,
    artifacts: input.artifacts ?? [],
  };
}

export function acceptAppProcessSection(input: {
  appProcess: AppProcess;
  runState: AppProcessRunState;
  section: AppProcessDraftSectionId;
  acceptedBy?: string;
  note?: string;
  now?: string;
}): AppProcessRunMutationResult {
  assertRunMatchesAppProcess(input.runState, input.appProcess);
  const existing = input.runState.acceptedDraftSections.find(
    (acceptance) => acceptance.section === input.section,
  );
  if (existing) {
    return { runState: input.runState };
  }
  const now = input.now ?? new Date().toISOString();
  const acceptance: AppProcessSectionAcceptance = {
    section: input.section,
    acceptedAt: now,
    ...(input.acceptedBy ? { acceptedBy: input.acceptedBy } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  const event = createEvent({
    type: "section_accepted",
    at: now,
    summary: `Accepted app-process section ${input.section}.`,
    data: { section: input.section, acceptedBy: input.acceptedBy },
  });
  return {
    runState: {
      ...input.runState,
      updatedAt: now,
      acceptedDraftSections: sortAcceptances([
        ...input.runState.acceptedDraftSections,
        acceptance,
      ]),
      events: [...input.runState.events, event],
    },
    event,
  };
}

export function continueAppProcessRun(input: {
  appProcess: AppProcess;
  runState: AppProcessRunState;
  now?: string;
}): AppProcessRunMutationResult & { continuation: AppProcessContinuation } {
  assertRunMatchesAppProcess(input.runState, input.appProcess);
  const now = input.now ?? new Date().toISOString();
  const status = createAppProcessRunStatus({
    appProcess: input.appProcess,
    runState: input.runState,
  });
  if (status.unacceptedDraftSections.length > 0) {
    const continuation = blockedContinuation({
      at: now,
      blockedBy: status.unacceptedDraftSections.map((section) => `unaccepted:${section}`),
      nextAction: `Accept ${status.unacceptedDraftSections[0]} before continuing app-process work.`,
    });
    const event = continuationEvent(continuation);
    return {
      continuation,
      event,
      runState: {
        ...input.runState,
        updatedAt: now,
        continuations: [...input.runState.continuations, continuation],
        events: [...input.runState.events, event],
      },
    };
  }

  const story = nextStory(input.appProcess, input.runState);
  if (!story) {
    const continuation = blockedContinuation({
      at: now,
      blockedBy: ["no-unprepared-story"],
      nextAction: "Record verification or review the backlog; no unprepared story remains.",
    });
    const event = continuationEvent(continuation);
    return {
      continuation,
      event,
      runState: {
        ...input.runState,
        updatedAt: now,
        continuations: [...input.runState.continuations, continuation],
        events: [...input.runState.events, event],
      },
    };
  }

  const continuation: AppProcessContinuation = {
    continuationId: createStableId("continuation", [now, story.storyId]),
    action: "prepare_story",
    status: "prepared",
    createdAt: now,
    storyId: story.storyId,
    title: story.title,
    ownerLane: story.ownerLane,
    phase: story.phase,
    nextAction: `Work ${story.storyId} in the ${story.ownerLane} lane, then record verification evidence.`,
  };
  const event = continuationEvent(continuation);
  return {
    continuation,
    event,
    runState: {
      ...input.runState,
      updatedAt: now,
      continuations: [...input.runState.continuations, continuation],
      events: [...input.runState.events, event],
    },
  };
}

export function recordAppProcessVerification(input: {
  appProcess: AppProcess;
  runState: AppProcessRunState;
  command: string;
  args?: string[];
  status: "passed" | "failed" | "skipped";
  evidencePath?: string;
  summary?: string;
  now?: string;
}): AppProcessRunMutationResult & { verification: AppProcessVerificationRecord } {
  assertRunMatchesAppProcess(input.runState, input.appProcess);
  const now = input.now ?? new Date().toISOString();
  const args = input.args ?? [];
  const verification: AppProcessVerificationRecord = {
    verificationId: createStableId("verification", [now, input.command, ...args, input.status]),
    command: input.command,
    args,
    status: input.status,
    recordedAt: now,
    ...(input.evidencePath ? { evidencePath: input.evidencePath } : {}),
    ...(input.summary ? { summary: input.summary } : {}),
  };
  const event = createEvent({
    type: "verification_recorded",
    at: now,
    summary: `Recorded ${input.status} verification for ${[input.command, ...args].join(" ")}.`,
    data: {
      command: input.command,
      args,
      status: input.status,
      evidencePath: input.evidencePath,
    },
  });
  return {
    verification,
    event,
    runState: {
      ...input.runState,
      updatedAt: now,
      verificationRecords: [...input.runState.verificationRecords, verification],
      events: [...input.runState.events, event],
    },
  };
}

function chooseNextAction(input: {
  appProcess: AppProcess;
  unacceptedDraftSections: AppProcessDraftSectionId[];
  missingCommands: string[];
  currentContinuation?: AppProcessContinuation;
}): AppProcessNextAction {
  const nextUnaccepted = input.unacceptedDraftSections[0];
  if (nextUnaccepted) {
    return {
      kind: "accept_section",
      section: nextUnaccepted,
      reason: `AI-drafted ${nextUnaccepted} must be accepted or refined before implementation/completion claims.`,
    };
  }
  if (!input.currentContinuation) {
    const story = input.appProcess.backlog.value.stories[0];
    return {
      kind: "continue_story",
      storyId: story?.storyId ?? "none",
      ownerLane: story?.ownerLane ?? "product",
      reason: story
        ? `Prepare ${story.storyId} as the next bounded app-process step.`
        : "No backlog story is available to prepare.",
    };
  }
  const firstMissing = input.appProcess.verification.value.requiredCommands.find((command) =>
    input.missingCommands.includes([command.command, ...command.args].join(" ")),
  );
  if (firstMissing) {
    return {
      kind: "record_verification",
      command: firstMissing.command,
      args: firstMissing.args,
      reason: `Record passing verification for ${[firstMissing.command, ...firstMissing.args].join(" ")}.`,
    };
  }
  return {
    kind: "none",
    reason: "All accepted draft sections and required verification are recorded.",
  };
}

function latestPreparedContinuation(runState: AppProcessRunState): AppProcessContinuation | undefined {
  return [...runState.continuations]
    .reverse()
    .find((continuation) => continuation.action === "prepare_story" && continuation.status === "prepared");
}

function nextStory(appProcess: AppProcess, runState: AppProcessRunState): AppProcessStory | undefined {
  const preparedStoryIds = new Set(
    runState.continuations
      .filter((continuation) => continuation.action === "prepare_story" && continuation.storyId)
      .map((continuation) => continuation.storyId),
  );
  return appProcess.backlog.value.stories.find((story) => !preparedStoryIds.has(story.storyId));
}

function blockedContinuation(input: {
  at: string;
  blockedBy: string[];
  nextAction: string;
}): AppProcessContinuation {
  return {
    continuationId: createStableId("continuation", [input.at, ...input.blockedBy]),
    action: "blocked",
    status: "blocked",
    createdAt: input.at,
    blockedBy: input.blockedBy,
    nextAction: input.nextAction,
  };
}

function continuationEvent(continuation: AppProcessContinuation): AppProcessRunEvent {
  if (continuation.status === "blocked") {
    return createEvent({
      type: "continue_blocked",
      at: continuation.createdAt,
      summary: continuation.nextAction,
      data: { continuationId: continuation.continuationId, blockedBy: continuation.blockedBy },
    });
  }
  return createEvent({
    type: "story_prepared",
    at: continuation.createdAt,
    summary: `Prepared ${continuation.storyId} for ${continuation.ownerLane} lane continuation.`,
    data: {
      continuationId: continuation.continuationId,
      storyId: continuation.storyId,
      ownerLane: continuation.ownerLane,
    },
  });
}

function toReportedVerification(record: AppProcessVerificationRecord): AppProcessGateReportedVerification {
  return {
    command: record.command,
    args: record.args,
    status: record.status,
  };
}

function verificationMatches(
  required: BlueprintCommand,
  reported: AppProcessVerificationRecord,
): boolean {
  if (reported.status !== "passed" || required.command !== reported.command) {
    return false;
  }
  const requiredArgs = required.args.join(" ");
  const reportedArgs = reported.args.join(" ");
  return requiredArgs === reportedArgs || requiredArgs.endsWith(` ${reportedArgs}`);
}

function orderedAcceptedSections(runState: AppProcessRunState): AppProcessDraftSectionId[] {
  const accepted = new Set(runState.acceptedDraftSections.map((acceptance) => acceptance.section));
  return APP_PROCESS_DRAFT_SECTIONS.filter((section) => accepted.has(section));
}

function sortAcceptances(acceptances: AppProcessSectionAcceptance[]): AppProcessSectionAcceptance[] {
  return [...acceptances].sort(
    (left, right) =>
      APP_PROCESS_DRAFT_SECTIONS.indexOf(left.section) -
      APP_PROCESS_DRAFT_SECTIONS.indexOf(right.section),
  );
}

function assertRunMatchesAppProcess(runState: AppProcessRunState, appProcess: AppProcess): void {
  if (runState.appProcessId !== appProcess.appProcessId) {
    throw new Error("App-process run state does not match the app-process artifact.");
  }
}

function createEvent(input: {
  type: AppProcessRunEventType;
  at: string;
  summary: string;
  data?: Record<string, unknown>;
}): AppProcessRunEvent {
  return {
    eventId: createStableId("event", [input.type, input.at, input.summary]),
    type: input.type,
    at: input.at,
    summary: input.summary,
    ...(input.data ? { data: input.data } : {}),
  };
}

function createStableId(prefix: string, parts: string[]): string {
  const hash = createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 16);
  return `${prefix}:${hash}`;
}
