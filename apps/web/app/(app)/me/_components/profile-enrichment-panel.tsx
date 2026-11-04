"use client";

import { useMemo, useReducer } from "react";
import { AlertCircle, Check, ChevronDown, Pencil, Trash2, X } from "lucide-react";
import type { ProfileEnrichmentSnapshot, ProfileFactSummary } from "@/lib/shared/types";
import { ImportMemoriesModal } from "@/app/(app)/me/_components/import-memories-modal";
import {
  canSaveProfileFactEdit,
  createProfileImportSourceState,
} from "@/app/(app)/me/_components/profile-enrichment-panel-state";
import { formatCurrency } from "@/lib/shared/currency";
import { textMentionsValue } from "@/lib/shared/text-mentions";

type ApiResponse = {
  snapshot?: ProfileEnrichmentSnapshot;
  error?: string;
};

type PanelState = {
  busy: string | null;
  draftValue: string;
  editingId: string | null;
  error: string | null;
  pasteOpen: boolean;
  provider: string;
  rollbackSnapshot: ProfileEnrichmentSnapshot | null;
  snapshot: ProfileEnrichmentSnapshot;
};

type PanelAction =
  | { type: "cancel-edit" }
  | { type: "fail-action"; error: string }
  | { type: "finish-action"; error?: string | null; snapshot?: ProfileEnrichmentSnapshot }
  | { type: "set-draft-value"; value: string }
  | { type: "set-paste-open"; value: boolean }
  | {
      type: "start-action";
      actionId: string;
      optimisticSnapshot?: ProfileEnrichmentSnapshot;
    }
  | { type: "start-edit"; fact: ProfileFactSummary }
  | { type: "toggle-paste" };

type FactDimensionGroup = {
  dimension: string;
  facts: ProfileFactSummary[];
};

type ImportPendingGroup = {
  importId: string;
  safeCount: number;
  totalCount: number;
};

type FactsView = {
  approveAllLabel: string;
  approveAllTarget: ImportPendingGroup | null;
  approvedGroups: FactDimensionGroup[];
  pendingFacts: ProfileFactSummary[];
};



const shortMonthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function ProfileEnrichmentPanel({
  initialImportOpen = false,
  initialProvider,
  initialSnapshot,
}: {
  initialImportOpen?: boolean;
  initialProvider?: string;
  initialSnapshot: ProfileEnrichmentSnapshot;
}) {
  const [state, dispatch] = useReducer(
    panelReducer,
    { initialImportOpen, initialProvider, snapshot: initialSnapshot },
    createInitialState,
  );
  const factsView = useMemo(() => buildFactsView(state.snapshot.facts), [state.snapshot.facts]);

  async function runAction(
    actionId: string,
    action: () => Promise<ApiResponse>,
    optimisticSnapshot?: ProfileEnrichmentSnapshot,
  ) {
    dispatch({ type: "start-action", actionId, optimisticSnapshot });

    try {
      const response = await action();
      if (response.error && !response.snapshot) {
        throw new Error(response.error);
      }
      dispatch({
        type: "finish-action",
        error: response.error ?? null,
        snapshot: response.snapshot,
      });
      return !response.error;
    } catch (nextError) {
      dispatch({
        type: "fail-action",
        error: nextError instanceof Error ? nextError.message : "Action failed.",
      });
      return false;
    }
  }

  function saveEdit(fact: ProfileFactSummary) {
    const nextValue = state.draftValue.trim();

    if (nextValue === fact.value.trim()) {
      dispatch({ type: "cancel-edit" });
      return;
    }

    return runAction(`save-${fact.id}`, () =>
      patchFact(fact.id, { value: nextValue, reviewState: "edited" }),
    ).then((saved) => {
      if (saved) {
        dispatch({ type: "cancel-edit" });
      }
    });
  }

  return (
    <section className="space-y-8">
      <ErrorBanner error={state.error} />
      <PendingFactsSection
        busy={state.busy}
        factsView={factsView}
        runAction={runAction}
        snapshot={state.snapshot}
      />
      <ApprovedFactsSection
        busy={state.busy}
        draftValue={state.draftValue}
        editingId={state.editingId}
        groups={factsView.approvedGroups}
        onCancelEdit={() => dispatch({ type: "cancel-edit" })}
        onDraftValueChange={(value) => dispatch({ type: "set-draft-value", value })}
        onSaveEdit={saveEdit}
        onStartEdit={(fact) => dispatch({ type: "start-edit", fact })}
        runAction={runAction}
        snapshot={state.snapshot}
      />
      <div className="border-t border-[var(--pp-hairline)] pt-4">
        <button
          aria-expanded={state.pasteOpen}
          className="kin-focus pp-mono inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.16em] text-[var(--pp-ink-60)] hover:text-[var(--pp-ink)]"
          onClick={() => dispatch({ type: "toggle-paste" })}
          type="button"
        >
          <ChevronDown
            aria-hidden
            className={`transition-transform ${state.pasteOpen ? "" : "-rotate-90"}`}
            size={12}
          />
          Paste a memory dump
        </button>
        {/* The shared paste-to-import dialog — the panel used to carry its own
            near-identical copy, which drifted (and claimed the same testids). */}
        <ImportMemoriesModal
          key={state.pasteOpen ? "paste-open" : "paste-closed"}
          initialProvider={state.provider}
          open={state.pasteOpen}
          onClose={() => dispatch({ type: "set-paste-open", value: false })}
          onImported={(snapshot) =>
            dispatch({ type: "finish-action", error: null, snapshot })
          }
        />
      </div>
    </section>
  );
}

function ErrorBanner({ error }: { error: string | null }) {
  if (!error) {
    return null;
  }

  return (
    <div className="flex gap-2 rounded-xl border border-[rgba(155,77,32,0.2)] bg-[rgba(155,77,32,0.06)] px-4 py-3 text-[13px] leading-5 text-[#8a4b20]">
      <AlertCircle aria-hidden className="mt-0.5 shrink-0" size={15} />
      {error}
    </div>
  );
}

function PendingFactsSection({
  busy,
  factsView,
  runAction,
  snapshot,
}: {
  busy: string | null;
  factsView: FactsView;
  runAction: (
    actionId: string,
    action: () => Promise<ApiResponse>,
    optimisticSnapshot?: ProfileEnrichmentSnapshot,
  ) => Promise<boolean>;
  snapshot: ProfileEnrichmentSnapshot;
}) {
  if (factsView.pendingFacts.length === 0) {
    return null;
  }

  const approveAllTarget = factsView.approveAllTarget;

  return (
    <FactGroup
      label={`Pending review · ${factsView.pendingFacts.length}`}
      action={
        approveAllTarget ? (
          <QuietButton
            disabled={busy !== null}
            loading={busy === "approve-all"}
            onClick={() =>
              runAction(
                "approve-all",
                () =>
                  postJson(`/api/profile-enrichment/imports/${approveAllTarget.importId}/review`, {
                    action: "approve_all",
                  }),
                optimisticApproveImportSnapshot(snapshot, approveAllTarget.importId),
              )
            }
          >
            {factsView.approveAllLabel}
          </QuietButton>
        ) : null
      }
    >
      <ul className="m-0 list-none space-y-3 p-0">
        {factsView.pendingFacts.map((fact) => (
          <li key={fact.id} className="grid grid-cols-[1fr_auto] items-start gap-4">
            <div className="min-w-0">
              <p className="m-0 text-[13.5px] leading-[1.55] text-[var(--pp-ink)]">
                {formatFactValue(fact)}
              </p>
              <FactMeta fact={fact} />
            </div>
            <div className="flex shrink-0 gap-1">
              <IconButton
                label="Approve"
                disabled={busy !== null || fact.sensitivityLevel !== "standard"}
                loading={busy === `approve-${fact.id}`}
                onClick={() =>
                  runAction(
                    `approve-${fact.id}`,
                    () => patchFact(fact.id, { reviewState: "approved" }),
                    optimisticFactReviewSnapshot(snapshot, fact.id, "approved"),
                  )
                }
              >
                <Check size={14} strokeWidth={2} />
              </IconButton>
              <IconButton
                label="Reject"
                disabled={busy !== null}
                loading={busy === `reject-${fact.id}`}
                onClick={() =>
                  runAction(
                    `reject-${fact.id}`,
                    () => patchFact(fact.id, { reviewState: "rejected" }),
                    optimisticFactReviewSnapshot(snapshot, fact.id, "rejected"),
                  )
                }
              >
                <X size={14} strokeWidth={2} />
              </IconButton>
            </div>
          </li>
        ))}
      </ul>
    </FactGroup>
  );
}

function ApprovedFactsSection({
  busy,
  draftValue,
  editingId,
  groups,
  onCancelEdit,
  onDraftValueChange,
  onSaveEdit,
  onStartEdit,
  runAction,
  snapshot,
}: {
  busy: string | null;
  draftValue: string;
  editingId: string | null;
  groups: FactDimensionGroup[];
  onCancelEdit: () => void;
  onDraftValueChange: (value: string) => void;
  onSaveEdit: (fact: ProfileFactSummary) => void;
  onStartEdit: (fact: ProfileFactSummary) => void;
  runAction: (
    actionId: string,
    action: () => Promise<ApiResponse>,
    optimisticSnapshot?: ProfileEnrichmentSnapshot,
  ) => Promise<boolean>;
  snapshot: ProfileEnrichmentSnapshot;
}) {
  if (groups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-7">
      {groups.map((group) => (
        <FactGroup key={group.dimension} label={group.dimension.replaceAll("_", " ")}>
          <ul className="m-0 list-none divide-y divide-[var(--pp-hairline-soft)] p-0">
            {group.facts.map((fact) => (
              <ApprovedFactRow
                key={fact.id}
                busy={busy}
                draftValue={draftValue}
                fact={fact}
                isEditing={editingId === fact.id}
                onCancelEdit={onCancelEdit}
                onDraftValueChange={onDraftValueChange}
                onSaveEdit={onSaveEdit}
                onStartEdit={onStartEdit}
                runAction={runAction}
                snapshot={snapshot}
              />
            ))}
          </ul>
        </FactGroup>
      ))}
    </div>
  );
}

function ApprovedFactRow({
  busy,
  draftValue,
  fact,
  isEditing,
  onCancelEdit,
  onDraftValueChange,
  onSaveEdit,
  onStartEdit,
  runAction,
  snapshot,
}: {
  busy: string | null;
  draftValue: string;
  fact: ProfileFactSummary;
  isEditing: boolean;
  onCancelEdit: () => void;
  onDraftValueChange: (value: string) => void;
  onSaveEdit: (fact: ProfileFactSummary) => void;
  onStartEdit: (fact: ProfileFactSummary) => void;
  runAction: (
    actionId: string,
    action: () => Promise<ApiResponse>,
    optimisticSnapshot?: ProfileEnrichmentSnapshot,
  ) => Promise<boolean>;
  snapshot: ProfileEnrichmentSnapshot;
}) {
  return (
    <li className="group relative grid grid-cols-[1fr_auto] items-start gap-3 py-2.5">
      {isEditing ? (
        <div>
          <textarea
            aria-label={`Edit ${fact.factKey.replaceAll("_", " ")} fact`}
            className="kin-focus min-h-[64px] w-full resize-y rounded-lg border border-[var(--pp-hairline-strong)] bg-[var(--pp-canvas)] px-3 py-2 text-[13.5px] leading-[1.5] text-[var(--pp-ink)]"
            value={draftValue}
            onChange={(e) => onDraftValueChange(e.target.value)}
          />
          <p className="pp-mono mt-1 text-[10.5px] uppercase tracking-[0.1em] text-[var(--pp-ink-40)]">
            {fact.factKey.replaceAll("_", " ")}
          </p>
        </div>
      ) : (
        <div>
          <p className="m-0 text-[13.5px] leading-[1.55] text-[var(--pp-ink-80)]">
            {formatFactValue(fact)}
          </p>
          <p className="pp-mono mt-0.5 text-[10.5px] uppercase tracking-[0.1em] text-[var(--pp-ink-40)]">
            {fact.factKey.replaceAll("_", " ")}
          </p>
        </div>
      )}
      <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
        {isEditing ? (
          <>
            <IconButton
              label="Save"
              disabled={busy !== null || !canSaveProfileFactEdit(draftValue)}
              loading={busy === `save-${fact.id}`}
              onClick={() => onSaveEdit(fact)}
            >
              <Check size={14} strokeWidth={2} />
            </IconButton>
            <IconButton label="Cancel" disabled={busy !== null} onClick={onCancelEdit}>
              <X size={14} strokeWidth={2} />
            </IconButton>
          </>
        ) : (
          <>
            <IconButton label="Edit" disabled={busy !== null} onClick={() => onStartEdit(fact)}>
              <Pencil size={13} strokeWidth={1.8} />
            </IconButton>
            <IconButton
              label="Delete"
              disabled={busy !== null}
              loading={busy === `delete-${fact.id}`}
              onClick={() =>
                runAction(`delete-${fact.id}`, () =>
                  fetchJson(`/api/profile-enrichment/facts/${fact.id}`, {
                    method: "DELETE",
                  }),
                  optimisticFactReviewSnapshot(snapshot, fact.id, "deleted"),
                )
              }
            >
              <Trash2 size={13} strokeWidth={1.8} />
            </IconButton>
          </>
        )}
      </div>
    </li>
  );
}

function FactMeta({ fact }: { fact: ProfileFactSummary }) {
  return (
    <p className="pp-mono mt-1 text-[10.5px] uppercase tracking-[0.1em] text-[var(--pp-ink-40)]">
      {fact.factKey.replaceAll("_", " ")}
      <span className="mx-1.5 text-[var(--pp-ink-30)]">·</span>
      {Math.round(fact.confidence * 100)}% confidence
      {fact.sensitivityLevel !== "standard" ? (
        <>
          <span className="mx-1.5 text-[var(--pp-ink-30)]">·</span>
          <span className="text-[#8a5a28]">{fact.sensitivityLevel}</span>
        </>
      ) : null}
    </p>
  );
}

function formatFactValue(fact: ProfileFactSummary): string {
  const parsed = parseJsonLikeValue(fact.value);
  if (parsed !== null) {
    return formatParsedFactValue(parsed, fact.factKey);
  }

  if (fact.factKey.includes("budget")) {
    return formatCurrencyValue(fact.value) ?? fact.value;
  }

  return fact.value;
}

function parseJsonLikeValue(value: string): unknown | null {
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function formatParsedFactValue(value: unknown, factKey: string): string {
  if (Array.isArray(value)) {
    return formatListValue(value);
  }

  if (!value || typeof value !== "object") {
    return formatScalarValue(value);
  }

  const record = value as Record<string, unknown>;

  if (factKey === "household_size") {
    return formatNumberRange(record, "people");
  }

  if (factKey === "preferred_age_range") {
    const range = formatNumberRange(record, "years old");
    return readBooleanValue(record.strict) ? `${range}, strict` : range;
  }

  if (factKey === "move_in_window") {
    return formatDateRange(readStringValue(record.start), readStringValue(record.end));
  }

  if (factKey === "budget") {
    return formatMoneyRange(record);
  }

  if (factKey === "verified_work_or_school") {
    return formatVerifiedWorkOrSchool(record);
  }

  return Object.entries(record)
    .flatMap(([key, entry]) => {
      const formatted = formatParsedFactValue(entry, key);
      return formatted ? [`${humanizeFactKey(key)}: ${formatted}`] : [];
    })
    .join(", ");
}

function formatListValue(values: unknown[]): string {
  return values
    .flatMap((value) => {
      const formatted = formatParsedFactValue(value, "");
      return formatted ? [formatted] : [];
    })
    .join(", ");
}

function formatPreferredRecord(record: Record<string, unknown>, keys: string[]): string {
  const ordered = keys.flatMap((key) => {
    const formatted = formatParsedFactValue(record[key], key);
    return formatted ? [formatted] : [];
  });

  if (ordered.length > 0) {
    return ordered.join(", ");
  }

  return Object.values(record)
    .flatMap((value) => {
      const formatted = formatParsedFactValue(value, "");
      return formatted ? [formatted] : [];
    })
    .join(", ");
}

function formatNumberRange(record: Record<string, unknown>, suffix: string): string {
  const min = readNumberValue(record.min);
  const max = readNumberValue(record.max);

  if (min !== null && max !== null) {
    return min === max ? `${min} ${suffix}` : `${min}-${max} ${suffix}`;
  }

  if (min !== null) {
    return `${min}+ ${suffix}`;
  }

  if (max !== null) {
    return `Up to ${max} ${suffix}`;
  }

  return formatPreferredRecord(record, ["min", "max"]);
}

function formatMoneyRange(record: Record<string, unknown>): string {
  const min = readNumberValue(record.min);
  const max = readNumberValue(record.max);

  if (min !== null && max !== null) {
    return min === max
      ? formatCurrency(min)
      : `${formatCurrency(min)}-${formatCurrency(max)}`;
  }

  if (min !== null) {
    return `${formatCurrency(min)}+`;
  }

  if (max !== null) {
    return `Up to ${formatCurrency(max)}`;
  }

  return formatPreferredRecord(record, ["min", "max"]);
}

function formatVerifiedWorkOrSchool(record: Record<string, unknown>): string {
  const role = formatParsedFactValue(record.role, "role");
  const company = formatParsedFactValue(record.company, "company");
  const school = formatParsedFactValue(record.school, "school");
  const major = formatParsedFactValue(record.major, "major");
  const degree = formatParsedFactValue(record.degree, "degree");
  const year = formatParsedFactValue(record.year, "year");
  const parts = [
    role,
    company && !textMentionsValue(role, company) ? company : "",
    school,
    major,
    degree,
    year,
  ].filter(Boolean);

  return parts.length > 0
    ? parts.join(", ")
    : formatPreferredRecord(record, ["role", "company", "school", "major", "degree", "year"]);
}

function formatDateRange(start: string | null, end: string | null): string {
  const formattedStart = start ? formatIsoDate(start) : null;
  const formattedEnd = end ? formatIsoDate(end) : null;

  if (formattedStart && formattedEnd) {
    return `${formattedStart} to ${formattedEnd}`;
  }

  if (formattedStart) {
    return `After ${formattedStart}`;
  }

  if (formattedEnd) {
    return `By ${formattedEnd}`;
  }

  return "";
}

function formatIsoDate(value: string): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return value;
  }

  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  const dayNumber = Number(day);
  const monthName = shortMonthNames[monthIndex] ?? month;

  return `${monthName} ${dayNumber}, ${year}`;
}

function formatScalarValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }

  return "";
}

function formatCurrencyValue(value: string): string | null {
  const normalized = value.replace(/[$,]/g, "").trim();
  const amount = Number(normalized);

  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  return formatCurrency(amount);
}

function humanizeFactKey(value: string): string {
  return value.replaceAll("_", " ");
}

function readStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value.replace(/[$,]/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function readBooleanValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  return typeof value === "string" && /^(true|yes|strict)$/i.test(value.trim());
}

function FactGroup({
  action,
  children,
  label,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <section>
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--pp-hairline)] pb-2.5">
        <h3 className="pp-mono m-0 text-[10.5px] font-medium uppercase tracking-[0.16em] text-[var(--pp-ink-60)]">
          {label}
        </h3>
        {action}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

function IconButton({
  children,
  disabled = false,
  label,
  loading = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  label: string;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className="kin-focus inline-grid size-7 place-items-center rounded-md text-[var(--pp-ink-60)] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[var(--pp-ink)] disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled || loading}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function QuietButton({
  children,
  disabled = false,
  loading = false,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="kin-focus inline-flex items-center rounded-md px-2.5 py-1 text-[12px] font-medium text-[var(--pp-ink-60)] transition hover:bg-[rgba(28,51,38,0.06)] hover:text-[var(--pp-ink)] disabled:cursor-not-allowed disabled:opacity-50"
      disabled={disabled || loading}
      onClick={onClick}
      type="button"
    >
      {loading ? "Working" : children}
    </button>
  );
}

function createInitialState({
  initialImportOpen,
  initialProvider,
  snapshot,
}: {
  initialImportOpen: boolean;
  initialProvider?: string;
  snapshot: ProfileEnrichmentSnapshot;
}): PanelState {
  const importSource = createProfileImportSourceState(initialProvider);
  return {
    busy: null,
    draftValue: "",
    editingId: null,
    error: null,
    pasteOpen: initialImportOpen,
    provider: importSource.provider,
    rollbackSnapshot: null,
    snapshot,
  };
}

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case "cancel-edit":
      return { ...state, draftValue: "", editingId: null };
    case "fail-action":
      return {
        ...state,
        busy: null,
        error: action.error,
        rollbackSnapshot: null,
        snapshot: state.rollbackSnapshot ?? state.snapshot,
      };
    case "finish-action":
      return {
        ...state,
        busy: null,
        error: action.error ?? null,
        rollbackSnapshot: null,
        snapshot: action.snapshot ?? state.snapshot,
      };
    case "set-draft-value":
      return { ...state, draftValue: action.value };
    case "set-paste-open":
      return { ...state, pasteOpen: action.value };
    case "start-action":
      return {
        ...state,
        busy: action.actionId,
        error: null,
        rollbackSnapshot: action.optimisticSnapshot ? state.snapshot : null,
        snapshot: action.optimisticSnapshot ?? state.snapshot,
      };
    case "start-edit":
      return { ...state, draftValue: action.fact.value, editingId: action.fact.id };
    case "toggle-paste":
      return { ...state, pasteOpen: !state.pasteOpen };
  }
}

function optimisticFactReviewSnapshot(
  snapshot: ProfileEnrichmentSnapshot,
  factId: string,
  reviewState: string,
): ProfileEnrichmentSnapshot {
  const facts = snapshot.facts.flatMap((fact) => {
    if (fact.id !== factId) {
      return [fact];
    }

    if (reviewState === "deleted" || reviewState === "revoked") {
      return [];
    }

    return [
      {
        ...fact,
        matchingEligible:
          (reviewState === "approved" || reviewState === "edited") &&
          fact.sensitivityLevel === "standard",
        reviewState,
      },
    ];
  });

  return withRecomputedImportCounts({ ...snapshot, facts });
}

function optimisticApproveImportSnapshot(
  snapshot: ProfileEnrichmentSnapshot,
  importId: string,
): ProfileEnrichmentSnapshot {
  const facts = snapshot.facts.map((fact) => {
    if (fact.importId !== importId) {
      return fact;
    }

    if (fact.sensitivityLevel === "standard") {
      return {
        ...fact,
        matchingEligible: true,
        reviewState: "approved",
      };
    }

    return {
      ...fact,
      matchingEligible: false,
      reviewState: "rejected",
    };
  });
  const imports = snapshot.imports.map((item) =>
    item.id === importId ? { ...item, status: "approved" } : item,
  );

  return withRecomputedImportCounts({ ...snapshot, facts, imports });
}

function withRecomputedImportCounts(
  snapshot: ProfileEnrichmentSnapshot,
): ProfileEnrichmentSnapshot {
  const countsByImport = new Map<
    string,
    { approved: number; pending: number; sensitive: number; total: number }
  >();

  for (const fact of snapshot.facts) {
    if (fact.reviewState === "deleted" || fact.reviewState === "revoked") {
      continue;
    }

    const counts = countsByImport.get(fact.importId) ?? {
      approved: 0,
      pending: 0,
      sensitive: 0,
      total: 0,
    };
    counts.total += 1;
    if (fact.reviewState === "pending") {
      counts.pending += 1;
    }
    if (fact.reviewState === "approved" || fact.reviewState === "edited") {
      counts.approved += 1;
    }
    if (fact.sensitivityLevel !== "standard") {
      counts.sensitive += 1;
    }
    countsByImport.set(fact.importId, counts);
  }

  return {
    ...snapshot,
    imports: snapshot.imports.map((item) => {
      const counts = countsByImport.get(item.id);
      return {
        ...item,
        approvedFactCount: counts?.approved ?? 0,
        factCount: counts?.total ?? 0,
        pendingFactCount: counts?.pending ?? 0,
        sensitiveFactCount: counts?.sensitive ?? 0,
      };
    }),
  };
}

function buildFactsView(facts: ProfileFactSummary[]): FactsView {
  const approvedByDimension = new Map<string, ProfileFactSummary[]>();
  const pendingByImport = new Map<string, ProfileFactSummary[]>();
  const pendingFacts: ProfileFactSummary[] = [];

  for (const fact of facts) {
    if (fact.reviewState === "pending") {
      pendingFacts.push(fact);
      pendingByImport.set(fact.importId, [...(pendingByImport.get(fact.importId) ?? []), fact]);
      continue;
    }

    if (fact.reviewState === "approved" || fact.reviewState === "edited") {
      approvedByDimension.set(fact.dimension, [...(approvedByDimension.get(fact.dimension) ?? []), fact]);
    }
  }

  const safeGroups: ImportPendingGroup[] = [];
  for (const [importId, importFacts] of pendingByImport) {
    let safeCount = 0;
    for (const fact of importFacts) {
      if (fact.sensitivityLevel === "standard") {
        safeCount += 1;
      }
    }

    if (safeCount > 0) {
      safeGroups.push({ importId, safeCount, totalCount: importFacts.length });
    }
  }

  const approveAllTarget = safeGroups[0] ?? null;
  const approveAllLabel =
    safeGroups.length > 1
      ? `Approve ${approveAllTarget?.safeCount ?? 0} safe from one import`
      : "Approve all safe";

  return {
    approveAllLabel,
    approveAllTarget,
    approvedGroups: [...approvedByDimension].map(([dimension, groupFacts]) => ({
      dimension,
      facts: groupFacts,
    })),
    pendingFacts,
  };
}

async function postJson(url: string, body: unknown): Promise<ApiResponse> {
  return fetchJson(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function patchFact(factId: string, body: unknown): Promise<ApiResponse> {
  return fetchJson(`/api/profile-enrichment/facts/${factId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function fetchJson(url: string, init: RequestInit): Promise<ApiResponse> {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as ApiResponse;

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with ${response.status}.`);
  }

  return data;
}
