# Friends + Auth reliability diagnostic evidence

Captured 2026-09-05. Production checks in this pass were read-only. Recipient identifiers are masked and no reset code, token, message body, API key, authorization header, or database credential is recorded here.

## Friends

- `FriendsScreen` keeps Received and Sent requests in screen-local React state. Before this correction, `loadRequests()` ran on mount and after Received mutations, but a successful Add Friend mutation did not notify the parent or refresh those arrays.
- The Add Friend success branch contained a 1,600 ms timer before closing the sheet.
- The authenticated outbound-request model already includes `toEmail`; the Sent row ignored it.
- Cancel Request and the active friend long-press action used `Alert.alert`, bypassing the CairnNZ modal contract.
- The controlled 390×844 fixture now records immediate close, refreshed request identity, authored confirmation, and unchanged Profile height in `assertions.json`.

## Verification code

- The six-cell input expected multi-character `onChangeText` values but set every native input to `maxLength={1}`.
- React Native 0.81.5 iOS applies `maxLength` to replacement text before dispatching the change event, so a six-digit paste reaches JavaScript as one digit.
- The OTP component entered the repository in commit `917d2d6` with both the multi-character handler and the conflicting one-character native limit. The foreground clipboard effect was added later in `20fd60f`.
- Foreground clipboard autofill could not be reproduced on an iOS simulator in this environment. Its view-scoped AppState path remains intact; privacy-safe accepted/ignored/unavailable breadcrumbs were added to distinguish future failures without recording clipboard contents.

## Password reset delivery

- Client path: `app/src/services/authService.ts` → `POST /api/auth/password-reset/request`.
- Backend path: `backend/src/routes/auth.js` → `PasswordReset.issueCode` → `sendPasswordResetCode` → Resend HTTPS API.
- Before this correction, provider failures were ephemeral console output and successful provider message IDs were discarded. No durable correlation record existed. This makes the reported first/second-attempt difference unreconstructable from the available local evidence.
- For the masked target `916***@qq.com`, provider acceptance, rejection, delivery, bounce, and historical request linkage for either attempt remain unknown. Provider acceptance must not be described as mailbox delivery.

## Read-only production access

- Public `https://api.yiiling.cn/health`: reachable; reported service healthy and database healthy at check time.
- SSH to the documented Aliyun host using the machine's existing non-interactive credentials: authentication failed. No password or key material was requested or printed.
- Direct production database access: unavailable from this environment.
- Resend provider-event/log access: unavailable from this environment.
- Actual deployment topology is documented by `docker/deploy.sh`: migration tooling plus Docker Compose rebuild/up and health/smoke checks. No deployment, migration, restart, provider change, or production-data mutation was performed.
