# AGENT INSTRUCTIONS — CAREBRIDGE

Follow this exact 5-step sequence on **every** prompt before writing or editing code:

## Step 1: Read Architecture, Database & Blueprint
- Read `ARCHITECTURE_AND_DB.md` and `PROJECT_BLUEPRINT.md` completely.
- Verify module boundaries, personas (`CO_CAREGIVER`, `isBackupAdmin`, `CONTRIBUTOR`, `OBSERVER`, `canViewFinancials`), Firestore paths/fields, and guardrails:
  - **No medical advice or diagnosis** (coordination & factual record organization only).
  - **Synthetic/sample data only** (no real patient records).
  - **Human confirmation required** before saving AI-extracted prescription photo fields to the database.
  - **No custom backend server** unless explicitly added later (React Native + Firebase client SDKs).

## Step 2: Read Previous Work & Changes
- Read `WORK_LOG.md` completely (if empty or header-only, treat this as Prompt #1).
- Review what was already built, what changed in earlier prompts, and any schema, rule, or state assumptions so you do not break or duplicate existing work.

## Step 3: Build Only What Was Requested
- Implement the current task cleanly in React Native (TypeScript) + Firebase using the CareBridge palette (`#F8FAFC` canvas, `#FFFFFF` card, `#0F766E` teal, `#4338CA` indigo, `#047857` emerald, `#D97706` amber, `#EA580C` coral) and tabular numerals (`fontVariant: ['tabular-nums']`).
- Keep Firestore writes atomic (`writeBatch`) where a mutation also updates `activityLogs` or `medicalBills`.

## Step 4: Update `WORK_LOG.md` (Mandatory Before Finishing)
Append a new section to `WORK_LOG.md` listing **every file created, modified, or deleted** in this prompt and the **exact reason** for each file change:

---
### [Prompt #N] — [YYYY-MM-DD HH:MM]
- **Prompt Summary:** <What the user asked in this prompt>
- **Context Checked:** <Confirmed `ARCHITECTURE_AND_DB.md`, `PROJECT_BLUEPRINT.md`, and prior `WORK_LOG.md` entries>
- **Files Changed & Reasons:**
  1. `<file/path>` (`CREATED` | `MODIFIED` | `DELETED`)
     - **Changes:** <What was added/updated>
     - **Reason:** <Why this file needed to be changed>
- **DB / State / Logic Notes:** <Any collections, rules, or flows updated>
- **Pending Next:** <Next logical build step>
---

## Step 5: Summarize Clearly in Chat
Confirm briefly that `ARCHITECTURE_AND_DB.md` and `WORK_LOG.md` were checked, state how many files were changed, and confirm `WORK_LOG.md` was updated.