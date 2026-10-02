import { randomBytes } from 'node:crypto';

function conflict(reason) {
  const error = new Error('來源員工與既有登入帳號衝突，已停止自動新增');
  error.code = 'auth-account-conflict';
  error.reason = reason;
  return error;
}

function isOwnedReservation(user, employeeId, email) {
  const claims = user?.customClaims;
  return user?.uid === employeeId &&
    String(user.email || '').toLowerCase() === email.toLowerCase() &&
    claims?.employeeId === employeeId &&
    claims.role === 'employee' &&
    claims.mustChangePassword === true &&
    claims.scheduleAutoProvisioned === true &&
    typeof claims.scheduleProvisioningRun === 'string' &&
    claims.scheduleProvisioningRun.length > 0;
}

/**
 * Provision only absent employee accounts. Existing accounts need this hook's
 * marker; a completed account is reused without changing its password/claims.
 * A disabled reservation can recover after an interrupted prior sync run.
 */
export function createScheduleEmployeeProvisioner({ auth, employeeEmail, importTemporaryPasswordUser }) {
  async function optionalUser(method, identifier) {
    try {
      return await auth[method](identifier);
    } catch (error) {
      if (error.code === 'auth/user-not-found') return null;
      throw error;
    }
  }

  async function finishReservation(candidate, user, created) {
    const { employeeId, name, email } = candidate;
    // Re-read before importing: importUsers can overwrite a matching UID.
    // Only this hook's disabled, unfinished reservation may be imported.
    const current = await auth.getUser(employeeId);
    if (!isOwnedReservation(current, employeeId, email) ||
      current.disabled !== true || current.customClaims.active !== false ||
      current.customClaims.scheduleProvisioningRun !== user.customClaims.scheduleProvisioningRun) {
      throw conflict('reservation-changed');
    }
    const emailUser = await optionalUser('getUserByEmail', email);
    if (emailUser && emailUser.uid !== employeeId) throw conflict('email-owned-by-another-user');
    const customClaims = {
      employeeId,
      role: 'employee',
      active: true,
      mustChangePassword: true,
      scheduleAutoProvisioned: true,
      scheduleProvisioningRun: current.customClaims.scheduleProvisioningRun,
    };
    await importTemporaryPasswordUser({ employeeId, displayName: name, disabled: false, customClaims });
    const completed = await auth.getUser(employeeId);
    if (!isOwnedReservation(completed, employeeId, email) ||
      completed.disabled !== false || completed.customClaims.active !== true ||
      completed.customClaims.scheduleProvisioningRun !== customClaims.scheduleProvisioningRun) {
      throw conflict('reservation-completion-unconfirmed');
    }
    return { created, reused: !created };
  }

  return async function provisionEmployee(candidate, { runId } = {}) {
    const employeeId = String(candidate?.employeeId || '').trim().toUpperCase();
    const name = String(candidate?.name || '').trim();
    if (!/^[A-Z0-9]{3,20}$/.test(employeeId) || !name || name.length > 100 ||
      typeof runId !== 'string' || !runId.trim() || runId.length > 200) {
      const error = new Error('自動新增員工的員編、姓名或同步識別碼格式不正確');
      error.code = 'invalid-argument';
      throw error;
    }
    const email = employeeEmail(employeeId);
    const [uidUser, emailUser] = await Promise.all([
      optionalUser('getUser', employeeId),
      optionalUser('getUserByEmail', email),
    ]);
    if (emailUser && emailUser.uid !== employeeId) throw conflict('email-owned-by-another-user');
    const existing = uidUser || emailUser;
    if (existing) {
      if (!isOwnedReservation(existing, employeeId, email)) throw conflict('unrecognized-existing-user');
      if (existing.disabled === false && existing.customClaims.active === true) {
        return { created: false, reused: true };
      }
      if (existing.disabled === true && existing.customClaims.active === false) {
        return finishReservation({ employeeId, name, email }, existing, false);
      }
      throw conflict('inconsistent-provisioning-state');
    }

    // createUser enforces UID/email uniqueness atomically. The random password
    // and disabled flag keep this account inaccessible before import completes.
    try {
      await auth.createUser({
        uid: employeeId,
        email,
        emailVerified: true,
        displayName: name,
        disabled: true,
        password: `${randomBytes(32).toString('base64url')}Aa1!`,
      });
    } catch (error) {
      if (['auth/uid-already-exists', 'auth/email-already-exists'].includes(error.code)) {
        throw conflict(error.code === 'auth/uid-already-exists' ? 'uid-created-concurrently' : 'email-created-concurrently');
      }
      throw error;
    }
    const customClaims = {
      employeeId,
      role: 'employee',
      active: false,
      mustChangePassword: true,
      scheduleAutoProvisioned: true,
      scheduleProvisioningRun: runId,
    };
    await auth.setCustomUserClaims(employeeId, customClaims);
    return finishReservation({ employeeId, name, email }, { customClaims }, true);
  };
}
