# Sprint 37 Goal

**Sprint**: 37
**Date**: 2026-05-16

## Goal

User data ownership — each logged-in user's hiking/running sessions stored in their backend account. Auth polish: JWT refresh strategy, profile screen, Google OAuth (requires user-supplied Client ID).

## Stories

- STORY-00125: Backend session storage — POST /api/sessions endpoint, user-scoped
- STORY-00126: Frontend session sync — send completed sessions to backend on save
- STORY-00127: User profile endpoint + Profile tab on Settings
- STORY-00128: JWT expiry handling — auto-logout on 401, token refresh UX
- STORY-00122: Google OAuth (deferred from Sprint 36 — requires Google Cloud Console Client ID from user)

## Blocked

- STORY-00122 (Google OAuth) is BLOCKED pending Google Cloud Console Client ID from user.
  All other stories in this Sprint can proceed without it.
