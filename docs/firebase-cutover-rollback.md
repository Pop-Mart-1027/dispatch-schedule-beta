# Firebase cutover E / rollback

Target: meimei-breakfast-order / 1086953376984.
Previous production Git commit: 7f20c7867187836534e8585661105f6215f00c70.
Previous Firebase: breakfast-order-system-83890 / 667405351082.

2026-09-11 preflight: 24,560 SmileBike Firestore documents on each side, with no field/type differences; 750 Auth accounts on each side, no profile/claims or source-password delta requiring synchronization. Login timestamps and Firebase-managed target password rehashes are not overwritten. Source breakfast orders/counters are excluded. Both sides have a fresh encrypted local recovery snapshot recorded outside Git.

The 13 target Functions are ACTIVE; three composite indexes READY; target Rules match the reviewed file. syncCurrentDispatchBlocks is private no-op and has no target Scheduler job. closePreScheduleMonths remains PAUSED and additionally requires CLOSE_PRE_SCHEDULE_ENABLED=true before doing work. No Web Push functions are deployed. No source data or Functions are deleted.

## Production release

The main-branch GitHub Pages workflow builds the committed frontend. Its Firebase config must contain only the target project ID/number. Test artifacts, credentials, backups, and unreleased Web Push changes must not be published.

## Rollback procedure

1. Pause new user writes and record the incident time before rollback. Keep both projects and their data intact.
2. Capture fresh encrypted Auth/Firestore snapshots of both projects. Compare all changes since cutover. Do not overwrite source with target data blindly; reconcile target-only writes and conflicts first, excluding all breakfast data.
3. Revert this cutover commit on main, then push the revert through the same GitHub Pages workflow. Alternatively restore only the reviewed frontend config from the previous production commit for a frontend-only rollback. Do not force-push history or redeploy source backend resources.
4. Wait for Actions success and verify production HTML/assets now point to breakfast-order-system-83890 / 667405351082. Reauthenticate users: Firebase sessions are project-specific.
5. Smoke test admin and employee login, personal schedules, dispatch, admin schedules, pre-scheduling and Dashboard. Keep target data for reconciliation; do not delete either project's resources.

Reverting code alone cannot move post-cutover writes back to the source. If new writes exist, a coordinated data reconciliation is required before resuming normal source operation.
