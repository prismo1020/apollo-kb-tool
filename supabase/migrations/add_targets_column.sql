-- Migration: add targets (multi-file corrections) and oasis_link columns
-- Run this in the Supabase SQL Editor for your apollo-kb-tool project.

-- Multi-file correction targets: stores array of {file, section_heading, current_section,
-- proposed_replacement, confidence, reasoning, status} objects.
ALTER TABLE public.apollo_corrections
  ADD COLUMN IF NOT EXISTS targets jsonb DEFAULT NULL;

-- Oasis SOP link submitted with the correction
ALTER TABLE public.apollo_corrections
  ADD COLUMN IF NOT EXISTS oasis_link text DEFAULT NULL;

-- GIN index for querying targets JSONB efficiently
CREATE INDEX IF NOT EXISTS apollo_corrections_targets_idx
  ON public.apollo_corrections USING gin(targets)
  WHERE targets IS NOT NULL;
