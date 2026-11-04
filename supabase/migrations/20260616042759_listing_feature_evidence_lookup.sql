create index if not exists agent_context_evidence_listing_claim_confidence_idx
  on public.agent_context_evidence(listing_id, claim_key, confidence desc, extracted_at desc)
  where listing_id is not null
    and matching_eligible = true
    and sensitivity_level = 'standard';

comment on index public.agent_context_evidence_listing_claim_confidence_idx is
  'Supports sourced apartment-listing feature assessments used by the text agent (for example office/workspace evidence).';
