# PR #31 failure corpus — truth table, test triage, architectural gap

> Provenance: distilled 2026-07-26 from frozen branch `claude/intake-gate-listings`
> (PR #31, head `d0586367`, 73 commits, +9,522/−1,217 over `origin/main`). PR #31 was
> closed after an automated review loop expanded a focused fix into phrase-specific
> regex enumeration; the branch is preserved read-only as this document's source.
> Immediate stopgap fix: PR #33. This document is the design input for the rebuilt
> structured-interpretation / state-machine onboarding gate.

All file:line anchors below refer to the **branch** version of each file
(`git show origin/claude/intake-gate-listings:<path>`).

---

## 1. Truth table — intended onboarding-gate behavior

### Semantic axes

**Conversation states**

| State | Meaning |
|---|---|
| `S-FOUND` | Active interview, a *foundation* step open (neighborhoods, budget, move_in, roommates, age_comfort) |
| `S-ENRICH` | Active interview, foundation done, enrichment step open (cleanliness, sleep, etc.) |
| `S-FINAL` | The turn on which coverage clears the last step (completion turn) |
| `S-DONE` | Interview durably completed / inactive |
| `H-UNK` | Household size unknown (`0..0` sentinel) — orthogonal data-state axis |

**Utterance classes** (semantic, not phrasal)

| Class | Meaning | Canonical examples from tests |
|---|---|---|
| `U-ANS` | Intake answer, incl. declarative preference statements | "$3000 max", "i'm looking for a two bedroom in the mission" |
| `U-LIST` | Explicit listing request (imperative/interrogative directive about inventory), incl. recommendation language | "show me places under 2k", "recommend me an apartment in nob hill", "any 2brs under 3k" |
| `U-REFINE` | Listing refinement immediately after grounded listing work | "what about the marina?", "anything under 3k", "any cheaper ones?" |
| `U-MATCH` | Explicit roommate-match request, incl. positive request inside a negated clause | "who are my best matches?", "I don't want to miss any roommate matches — show me the latest" |
| `U-NEG` | Negated/contrarian match or listing request with no positive clause | "no more roommate matches", "I'd rather not see roommate matches" |
| `U-TANGENT-H` | Housing-adjacent tangent question (place info, neighborhood comparison, process question) | "tell me more about Hayes Valley", "tell me more about renters insurance" |
| `U-TANGENT-X` | Non-housing tangent / non-housing POI search | "find me a coffee shop near the mission", "search for a gym around soma" |
| `U-DETAIL` | Named roommate detail follow-up (name must be grounded in prior context if lowercase) | "tell me more about jack" after Jack was surfaced |
| `U-SKIP` | Intake control reply (SKIP) | — |

### Table 1 — Tool permissions by state × utterance

| State | Utterance | `search_listings` | `get_matches` | `update_prefs` | Grounding |
|---|---|---|---|---|---|
| S-FOUND / S-ENRICH | U-ANS | **closed** (deterministic refusal-answer if model tries) | **closed** | **yes** — and the answer must persist (bounded retry if model forgets) | loop.test.ts:3571, 3885, 3332; PR bullet 1; evals/scenarios.ts "intake → no premature search" |
| S-FOUND / S-ENRICH | U-LIST | **runs immediately**, grounded cards attached; if model returns prose only, search is *forced* | closed unless also U-MATCH | yes | loop.test.ts:3917, 3943; intake-gate.test.ts:144, 312; PR bullet 2 |
| S-FOUND / S-ENRICH | U-REFINE (resolves to known SF neighborhood or compact price constraint) | **runs** — carries across the appended intake question and split outbound bubbles | closed | yes | loop.test.ts:3993; intake-gate.test.ts:182, 197; message-intent.test.ts:330, 394; PR bullets "What about the Marina?", "anything under 3k" |
| S-FOUND / S-ENRICH | U-MATCH (incl. don't-miss positive) | closed | **runs** | yes | loop.test.ts:3632, 3735; message-intent.test.ts:108 |
| S-FOUND / S-ENRICH | U-NEG | closed | **closed** — negation never opens a lookup, and never triggers media recovery | yes (the negation may itself be a preference) | loop.test.ts:3685; message-intent.test.ts:163–183 block; commits 71cd9d0d, 610fa926 |
| S-FOUND / S-ENRICH | U-TANGENT-H | closed (answer the question, no cards) | closed | **no forced intake retry** — tangents are not answers | loop.test.ts:3465; PR bullet on retry preconditions |
| S-FOUND / S-ENRICH | U-TANGENT-X | closed — non-housing POI targets rejected even in "nounless location command" form ("look near my dentist") | closed | no | message-intent.test.ts:182 negative block; PR bullet "Nounless location commands reject non-housing POI targets" |
| S-FOUND / S-ENRICH | U-DETAIL | closed | runs only with grounded name context; scored-neighborhood prose is *not* roommate context | — | message-intent.test.ts:11–105; loop.test.ts:2552 |
| S-FINAL | any non-explicit | **closed for the rest of the turn** — unsolicited fetches stay gated even as coverage completes | closed | yes | loop.test.ts:3834; intake-gate.test.ts:840 |
| S-DONE | U-ANS/U-LIST/U-MATCH | open | open | yes — and `update_prefs` may now narrate score motion | loop.test.ts:3784, 4224; update-prefs.test.ts:61 |
| any, H-UNK | U-LIST (served) | runs, but **whole-unit pricing only**; no fabricated splits/fit; generated suggestions hidden | — | — | listing-reactions.test.ts:210; match-status.test.ts:41–77; PR household bullets |

### Table 2 — Reply-shape invariants (any state where interview is active)

| Invariant | Grounding |
|---|---|
| Closing prompt = exactly **one** question = the **canonical persisted next question** (model-authored closers replaced; helper copy deduplicated even when paraphrased/echoed) | intake-gate.test.ts:323, 623, 793; loop.test.ts:2029, 2072 |
| After a successful `update_prefs`, reload durable coverage, persist the new next step, and end deterministically with **that exact question** | loop.test.ts:4058, 4119; intake-gate.test.ts:265; PR bullet 3 |
| Clearing the final step durably completes the `matching_interviews` row; the completion reply contains **no new question and no pitch** | intake-gate.test.ts:213, 660; profile-intake-flow.test.ts:76; PR bullet 4 |
| Named/scored roommate claims require a **same-turn successful `get_matches`**, and only the names/scores actually returned may appear; empty/different payloads cannot legitimize claims. Neighborhood percentages and listing scores are exempt from this guard | loop.test.ts:482, 4161; intake-gate.test.ts:366, 413–504; PR bullets 5–6 |
| Ungrounded inventory claims ("no listings matched…") dropped when no search was requested | intake-gate.test.ts:338, 393 |
| Grounded result prose, addresses, listing blocks, and outbound bubble boundaries are preserved through sanitization | intake-gate.test.ts:355, 402, 668, 678 |
| Model clarification question may replace the canonical question **only** when an explicitly requested task returned a failed result needing clarification | intake-gate.test.ts:688, 696, 740; PR bullet 13 |
| Bounded intake-persistence retry fires only when (prev outbound visibly asked the canonical question) ∧ (inbound is an answer, incl. auxiliary-led answers like "would rather go solo") — never for declarative housing tangents | loop.test.ts:3332, 3381, 3465; PR bullets 8–9 |
| Confirmed solo household ⇒ skip roommate-age question | fact-utils.test.ts:27; commit c40fd0e2 |
| SKIP routes through the deterministic profile stepper; final-step SKIP durably completes | run-queue.test.ts (added test); profile-intake-flow.test.ts:76 |

### Contradictions / oscillations worth surfacing

1. **"Not an ask" vs "ask we can't serve" are conflated.** "look in nob hill" / "show me what's in nob hill" ⇒ listing ask; the *identical speech act* aimed at Oakland ("look in oakland", "show me what's in oakland", "what can i find in oakland?") ⇒ classified *not a request* (message-intent.test.ts:182 negative block). Likewise continuation "The Mission" ⇒ true but "Oakland" ⇒ false as answers to "which neighborhood should I search instead?" (message-intent.test.ts:342 block). The user asked in both cases; a served-market check is hiding inside intent classification. A rebuilt classifier should say *intent=search, market=unserved* and reply accordingly.
2. **Negation took five commits to converge** (a001255a → 35d29bae → 71cd9d0d → 610fa926 → 7f1587a4). Final rule is clause-scoped: a negated clause about *listings/amenities* plus a positive clause about *matches* opens matches ("I don't want a place with stairs. Can you show me roommate matches?"), and "don't want to **miss** matches" is positive. Pure regex kept flipping these.
3. **Declarative vs directive boundary is speech-act, not phrasing.** "i'm looking for a two bedroom in the mission" = answer; "any 2brs under 3k" = search; "show me a two bed in the Mission" = search. The branch encodes this as punctuation/aux-verb heuristics (PR bullets 10–12, 14) — the real feature is assertion vs. directive.
4. **The refinement rule is encoded twice** — in `message-intent.ts` (isListingSearchContinuation) and again in `intake-gate.ts` (carry-across-appended-question tests at intake-gate.test.ts:166–197) — a drift hazard.
5. **The migration needed repairing twice on its own branch**: `20260726011243_restore_matching_profile_update_order.sql` and `20260726120001_restore_mixed_household_profile_update_order.sql`, plus a 378-line `restore_confirmed_seeded_group_memberships.sql` fixing collateral damage the branch's own earlier migration did to group memberships (commits 268edb91, ae1f30f8).
6. Two commits share the identical message "close final grounding gaps" (7d5f2e66, f46805af) — the review loop was cycling, not converging.

---

## 2. Test triage

**(a) = genuine product invariant, port to rebuild. (b) = regex-patch immortalization, do NOT port as-is. (c) = infrastructure/misc.**

### `apps/web/lib/text-agent/loop.test.ts` (4,251 lines, 64 tests, ~3,553 lines added)
- **(a) `describe("onboarding intake gate")` — lines 3287–4251, 19 tests.** The crown jewels. Behavioral, end-to-end through the loop with mocked tools: gate closed mid-interview (3571, 3885), explicit override (3632, 3917), forced search on prose-only (3943), negated request stays gated (3685), gate lifts on coverage (3784), final-turn gating (3834), post-write persistence + closing question ownership (4058, 4119), invented-name regeneration (4161), score-motion suppression (4195/4224), refinement across bubbles (3993), retry preconditions (3332/3381/3465). Port all 19 as the acceptance suite for a rebuilt gate.
- **(a) Reality-guard group — lines 433–482, 1230–1356, 4161**: save-claim/send-claim/match-claim grounding. Pre-dates the PR in part; the additions (same-turn `get_matches`, payload-name matching) are real invariants.
- **(a/b mixed) Card attachment/recovery — lines 1448–2973 (~25 tests)**: the *policies* (cards only for named results, no cards on offer-only closers, pronoun resolution needs unambiguous context, no card because a street number matched a dollar figure) are invariants; several tests pin exact card-recovery phrasings — port the policy assertions, drop phrasing-conditioned ones.
- **(c) Lines 173–385**: OpenRouter parsing, key handling, idempotency, outage bubble. Infrastructure; keep where they are.
- **(c) Lines 3039–3245**: thread-memory persistence plumbing.

### `apps/web/lib/text-agent/intake-gate.test.ts` (849 lines, 1 describe, ~45 tests)
- **(a) Gate resolution & durable completion — lines 90–305, 830–840 (~10 tests)**: hint-priority step recompute, foundation-vs-hint separation, plain answer ≠ ask, explicit ask recognition at gate level, refinement carry (166–197), durable interview completion + stale-summary cleanup (213, 241), coverage reconciliation after write (265), gated-listings deterministic result naming the next question (830), non-requested fetch closed on completion turn (840). Port.
- **(a) Grounding filters as *policies* — lines 305–504 (~10 tests)**: directive forbids listings/score narration while foundation open, permits when asked; drops ungrounded inventory/no-match/roommate claims; preserves grounded blocks. Port the assertions, not the sentence-surgery mechanism.
- **(b) Prose-surgery pinning — lines 593–828 (~15 tests)**: newline-as-sentence-boundary, lowercase punctuation-free lines, period-terminated question dedup, spelled-out-contraction normalization, paraphrase dedup, wh-word prose vs connective prefixes, query-string URL preservation. These immortalize a string-rewriting implementation. The underlying invariant ("one canonical closing question, no duplicated helper copy") is already covered by (a); a rebuilt system that *generates* the closing line instead of patching model prose makes all of these moot.

### `apps/web/lib/text-agent/message-intent.test.ts` (401 lines, ~190 phrase cases)
- **(b) Nearly the entire file.** ~80 positive + ~55 negative listing-ask phrases (lines 182–330), ~30 people-language negatives, negation lists. Each case pins one surface form; collectively they *would constrain a better classifier to regex-shaped decision boundaries* (e.g. "look in oakland" must be `false` — a semantic classifier would correctly call it a search request).
- **(a) Extract as a ~25-row semantic fixture set instead**: one representative per class boundary — declarative-preference≠search, negation clause scoping, don't-miss positive, roommate-friendly-apartments→listings-not-matches (line 138 block), scored-neighborhood-isn't-roommate-context (line 49), lowercase-name-needs-context (line 22), non-housing POI rejection, SF-landmark acceptance. The block comment at message-intent.test.ts:178–181 ("both error directions are real bugs") is the correct spec statement — keep that, re-derive the cases.

### `apps/web/lib/text-agent/tool-belt/update-prefs.test.ts` (87 lines, 2 tests)
- **(a) Both**: score-motion narrated only when intake done; fact saved but motion suppressed while active (lines 61, 74). Port.

### `apps/web/evals/scenarios.ts` (+60 lines, 1 scenario)
- **(a)** "intake → no premature search" (line ~85) — pins the original live failure (studios + "Jack moved up to 60%" after two answers) with an excellent regression comment. The single most valuable artifact on the branch; port verbatim.

### Reply-guards
No dedicated `reply-guards.test.ts`; guards (`reply-guards.ts:26–524`) are tested through loop.test.ts (433–482, 1208–1356, 2010–2103) and intake-gate.test.ts. Triage follows those files: guard *predicates* (a), question-trimming string surgery (b).

### Supporting files
- **(a)** fact-utils.test.ts:26–79 (solo skips age question); profile-intake-flow.test.ts:76 (skip-completes-durably); pending-profile-question.test.ts (bind/persist-once/no-double-persist); run-queue.test.ts added test (SKIP → deterministic stepper).
- **(a, but belongs to the household cluster PR)** match-status.test.ts (all 71 lines — clean pure-function contract for invalidated-fit visibility), matches-pagination, saved-listing-pricing, match-surface/search sentinel tests, apartment-listing-matches added tests (7), listing-reactions household tests (2), listing-recommendations household tests (3).
- **(a/b)** household-flexibility.test.ts — the three-way label set {solo, open, unknown} and "unknown ≠ solo" is product truth; the 24-phrase list is another regex pin.
- **(c)** thread-data.test.ts, store.test.ts, index.test.ts additions — plumbing.

---

## 3. Architectural gap statement

**Why regex enumeration could not converge.** The gate's escape hatch asks a semantic question — *is this utterance a directive to fetch inventory, an assertion of a preference, a negation, or a tangent?* — whose answer depends on speech act, clause-level negation scope, anaphora ("tell me more about **jack**" is a match ask only if Jack was surfaced), and world knowledge (Marina-the-neighborhood vs Marina-the-roommate; UCSF vs "my dentist"; Nob Hill in-market vs Oakland out-of-market). Regexes see none of these; each false positive/negative got its own pattern, each pattern created adjacent misfires, and the review loop produced 73 commits of monotonically growing surface area (message-intent.ts alone: 492 lines; ~190 phrase tests pinning it in place). Five commits on negation alone, the same commit message twice, and a served-market check smuggled into "intent" classification are the convergence-failure signatures. The second failure is that reply correctness was enforced by *post-hoc prose surgery* (reply-guards.ts sentence rewriting, ~15 tests pinning newline and contraction handling) instead of by *generating* the closing question deterministically.

**What the tests actually imply.** An explicit onboarding state machine plus a structured interpretation layer:

- **States**: `INTERVIEW_ACTIVE(step, foundationStep, canonicalQuestion)` → `FINAL_STEP_TURN` → `COMPLETED`; orthogonal data state `household ∈ {unknown, solo, shared(range)}`.
- **Inputs**: a classified intent per inbound — `{intake_answer, listing_request(area, constraints, market∈{served, unserved}), listing_refinement, match_request, negated_request, roommate_detail(name, grounded?), housing_tangent, other_tangent, skip}` — produced by a real classifier (LLM or trained model) evaluated against a *semantic-class* fixture set, not phrase pins.
- **Outputs per (state, intent)**: (1) tool permission set for `search_listings` / `get_matches` / `update_prefs` (exactly Table 1); (2) the canonical next question, persisted and appended deterministically — never recovered from model prose; (3) grounding requirements for claims (roommate names/scores ⇐ same-turn lookup payload; inventory claims ⇐ actual search).
- **Invariant**: the gate's decision and the closing question come from persisted durable state (coverage + `matching_interviews`), so the model can neither advance nor stall onboarding by phrasing alone.

The 19 loop.test gate tests + the eval scenario are the acceptance suite for this machine; the 190 phrase tests are the thing it replaces.

---

## 4. Out-of-scope clusters to split into separate PRs

### Cluster A — household-size sentinel migration (data model)
Unknown household must be `0..0`, not the legacy `2..4`/`0..4` defaults that fabricated "3 roommates", split pricing, and `0%` fit.
- `supabase/migrations/20260726011242_matching_profiles_household_size_no_default.sql` (+431) and its five follow-ups (`…011243_restore_matching_profile_update_order`, `…091500_sync_reopened_household_intake_summaries`, `…104500_enqueue_recovered_household_match_refresh`, `…120000_restore_confirmed_seeded_group_memberships` (+378), `…120001_restore_mixed_household_profile_update_order`)
- `apps/web/lib/matching/`: `apartment-listing-matches.ts/.test.ts`, `match-status.ts/.test.ts` (new), `matches-pagination.test.ts` (new), `matches.ts`
- `apps/web/lib/apartments/`: `match-surface.ts/.test.ts`, `roommate-splits.ts`, `search.ts/.test.ts`, `types.ts`
- `apps/web/lib/plan/`: `plan.ts`, `saved-listing-pricing.ts/.test.ts` (new)
- `apps/web/lib/profiles/`: `household-flexibility.ts/.test.ts` (new), `enrichment-store.ts`, `store.ts`
- Household bits of `lib/text-agent/listing-reactions.*` and `listing-recommendations.*`

**Independently justified: yes** — a real data-integrity bug (invented roommates/splits, `0%` fit on user-actioned rows) that exists with or without the gate. Migration status: **only `20260726011242` ran in production** (preflight found zero affected rows; PR #33 already records it in the repo ledger). The five follow-up data-repair migrations were **never applied** — they repair collateral damage `011242` would have caused on a non-empty cohort, and prod's cohort was empty, so each must be independently re-justified (most are likely unnecessary) rather than carried forward by default.

### Cluster B — apartments UI for unknown household (presentation)
- `apps/web/app/(app)/apartments/_components/`: `apartments-map-view.tsx`, `property-detail-modal.tsx` (+119), `property-detail-modal-state.ts/.test.ts` (new), `property-detail-format.ts/.test.ts`, `property-list-card.tsx`, `property-popup-card.tsx/.test.tsx` (new), `roommates-control.tsx` ("Set household" label), `filter-defaults.ts/.test.ts`, `apartment-listing-filters.ts`, `use-apartment-listing-details.ts`
- `apps/web/app/(app)/me/_components/`: `matches-pane.tsx`, `dashboard-panes.render.test.tsx`
- `apps/web/app/globals.css` (+1)

**Independently justified: yes** — household-unknown ≠ confirmed-no-split, fit withheld (never `0%`), whole-unit pricing everywhere, and no stale-positive reintroduction on async refresh are coherent UI semantics; but it depends on Cluster A's sentinel/`match-status` helpers, so it lands after A, not in parallel.

### Remainder (the actual PR #31 successor)
`apps/web/lib/text-agent/**` + `apps/web/evals/**` — the gate, intent layer, and reply guards. This is the part to *rebuild* per section 3 rather than merge, carrying forward the section-2(a) test groups as its spec.
