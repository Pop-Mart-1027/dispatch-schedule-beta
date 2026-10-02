import test from 'node:test';
import assert from 'node:assert/strict';
import { createScheduleEmployeeProvisioner } from './schedule-employee-provision.mjs';

const candidate = { employeeId: 'B9999', name: '測試新進人員' };
const emailFor = id => `${id.toLowerCase()}@employees.smilebike.invalid`;
const markedClaims = (extra = {}) => ({
  employeeId: candidate.employeeId, role: 'employee', active: true,
  mustChangePassword: true, scheduleAutoProvisioned: true,
  scheduleProvisioningRun: 'original-run', ...extra,
});
const account = (extra = {}) => ({
  uid: candidate.employeeId, email: emailFor(candidate.employeeId), disabled: false,
  displayName: candidate.name, password: 'existing-changed-password',
  customClaims: markedClaims(), ...extra,
});
const authError = code => Object.assign(new Error(code), { code });

function fixture({ users = [], createError, markerError, importError, afterMarker } = {}) {
  const saved = new Map(users.map(user => [user.uid, structuredClone(user)]));
  const calls = { create: [], claims: [], imports: [], update: [], delete: [] };
  const auth = {
    async getUser(uid) {
      const user = saved.get(uid);
      if (!user) throw authError('auth/user-not-found');
      return structuredClone(user);
    },
    async getUserByEmail(email) {
      const user = [...saved.values()].find(u => u.email?.toLowerCase() === email.toLowerCase());
      if (!user) throw authError('auth/user-not-found');
      return structuredClone(user);
    },
    async createUser(input) {
      calls.create.push(structuredClone(input));
      if (createError) throw createError;
      if (saved.has(input.uid)) throw authError('auth/uid-already-exists');
      if ([...saved.values()].some(u => u.email === input.email)) throw authError('auth/email-already-exists');
      saved.set(input.uid, structuredClone(input));
      return structuredClone(input);
    },
    async setCustomUserClaims(uid, customClaims) {
      calls.claims.push({ uid, customClaims: structuredClone(customClaims) });
      if (markerError) throw markerError;
      saved.get(uid).customClaims = structuredClone(customClaims);
      afterMarker?.(saved.get(uid));
    },
    async updateUser(...args) { calls.update.push(args); throw Error('Existing accounts must not be updated'); },
    async deleteUser(...args) { calls.delete.push(args); throw Error('Existing accounts must not be deleted'); },
  };
  const importTemporaryPasswordUser = async input => {
    calls.imports.push(structuredClone(input));
    if (importError) throw importError;
    saved.set(input.employeeId, {
      uid: input.employeeId, email: emailFor(input.employeeId), emailVerified: true,
      displayName: input.displayName, disabled: input.disabled,
      customClaims: structuredClone(input.customClaims), password: input.employeeId,
    });
  };
  return {
    saved, calls,
    provision: createScheduleEmployeeProvisioner({ auth, employeeEmail: emailFor, importTemporaryPasswordUser }),
  };
}

function assertConflict(error) {
  assert.equal(error.code, 'auth-account-conflict');
  return true;
}

void test('new account is reserved disabled with a random password before the existing BCRYPT import helper enables it', async () => {
  const { provision, saved, calls } = fixture();
  assert.deepEqual(await provision(candidate, { runId: 'new-run' }), { created: true, reused: false });
  assert.equal(calls.create.length, 1);
  assert.equal(calls.create[0].disabled, true);
  assert.ok(calls.create[0].password.length >= 32);
  assert.notEqual(calls.create[0].password, candidate.employeeId);
  assert.equal(calls.claims[0].customClaims.active, false);
  assert.equal(calls.imports[0].customClaims.scheduleProvisioningRun, 'new-run');
  assert.equal(calls.imports[0].disabled, false);
  assert.equal(saved.get(candidate.employeeId).password, candidate.employeeId);
  assert.equal(saved.get(candidate.employeeId).customClaims.active, true);
  assert.equal(saved.get(candidate.employeeId).customClaims.role, 'employee');
  assert.equal(saved.get(candidate.employeeId).customClaims.mustChangePassword, true);
});

void test('later sync reuses a completed marked account without resetting its password or claims', async () => {
  const original = account();
  const { provision, saved, calls } = fixture({ users: [original] });
  assert.deepEqual(await provision(candidate, { runId: 'next-run' }), { created: false, reused: true });
  assert.deepEqual(saved.get(candidate.employeeId), original);
  assert.equal(calls.create.length + calls.claims.length + calls.imports.length + calls.update.length + calls.delete.length, 0);
});

void test('a disabled unfinished marked reservation can finish in a later run while preserving its original run marker', async () => {
  const { provision, saved, calls } = fixture({ users: [account({ disabled: true, customClaims: markedClaims({ active: false }) })] });
  assert.deepEqual(await provision(candidate, { runId: 'next-run' }), { created: false, reused: true });
  assert.equal(calls.create.length + calls.claims.length, 0);
  assert.equal(calls.imports.length, 1);
  assert.equal(saved.get(candidate.employeeId).customClaims.scheduleProvisioningRun, 'original-run');
  assert.equal(saved.get(candidate.employeeId).disabled, false);
});

void test('an import failure keeps the marked reservation disabled and a later retry completes it once', async () => {
  const first = fixture({ importError: authError('auth/internal-error') });
  await assert.rejects(first.provision(candidate, { runId: 'failed-run' }), { code: 'auth/internal-error' });
  const partial = first.saved.get(candidate.employeeId);
  assert.equal(partial.disabled, true);
  assert.equal(partial.customClaims.active, false);
  const retry = fixture({ users: [partial] });
  assert.deepEqual(await retry.provision(candidate, { runId: 'retry-run' }), { created: false, reused: true });
  await retry.provision(candidate, { runId: 'after-completion' });
  assert.equal(retry.calls.imports.length, 1);
  assert.equal(retry.saved.get(candidate.employeeId).customClaims.scheduleProvisioningRun, 'failed-run');
});

void test('ordinary enabled and disabled accounts without the provisioning marker remain untouched', async () => {
  for (const disabled of [false, true]) {
    const original = account({ disabled, customClaims: { employeeId: candidate.employeeId, role: 'employee', active: !disabled, mustChangePassword: true } });
    const { provision, saved, calls } = fixture({ users: [original] });
    await assert.rejects(provision(candidate, { runId: 'new-run' }), assertConflict);
    assert.deepEqual(saved.get(candidate.employeeId), original);
    assert.equal(calls.create.length + calls.claims.length + calls.imports.length + calls.update.length + calls.delete.length, 0);
  }
});

void test('marked accounts with another employee claim, elevated role, changed password, or incomplete run marker remain untouched', async () => {
  for (const claims of [
    markedClaims({ employeeId: 'B8888' }),
    markedClaims({ role: 'admin' }),
    markedClaims({ role: 'duty' }),
    markedClaims({ mustChangePassword: false }),
    markedClaims({ scheduleProvisioningRun: '' }),
    markedClaims({ scheduleAutoProvisioned: false }),
  ]) {
    const original = account({ customClaims: claims });
    const { provision, saved, calls } = fixture({ users: [original] });
    await assert.rejects(provision(candidate, { runId: 'new-run' }), assertConflict);
    assert.deepEqual(saved.get(candidate.employeeId), original);
    assert.equal(calls.create.length + calls.claims.length + calls.imports.length, 0);
  }
});

void test('inconsistent marked disabled/active states are not re-enabled or imported', async () => {
  for (const [disabled, active] of [[true, true], [false, false]]) {
    const original = account({ disabled, customClaims: markedClaims({ active }) });
    const { provision, saved, calls } = fixture({ users: [original] });
    await assert.rejects(provision(candidate, { runId: 'new-run' }), assertConflict);
    assert.deepEqual(saved.get(candidate.employeeId), original);
    assert.equal(calls.create.length + calls.claims.length + calls.imports.length, 0);
  }
});

void test('a candidate email held by a different UID is a conflict without changing either account', async () => {
  const original = account({ uid: 'B8888', customClaims: { role: 'admin' } });
  const { provision, saved, calls } = fixture({ users: [original] });
  await assert.rejects(provision(candidate, { runId: 'new-run' }), assertConflict);
  assert.deepEqual(saved.get(original.uid), original);
  assert.equal(calls.create.length + calls.claims.length + calls.imports.length, 0);
});

void test('an existing marked UID with a different email is a conflict and keeps its password', async () => {
  const original = account({ email: 'different@example.invalid' });
  const { provision, saved, calls } = fixture({ users: [original] });
  await assert.rejects(provision(candidate, { runId: 'new-run' }), assertConflict);
  assert.deepEqual(saved.get(candidate.employeeId), original);
  assert.equal(calls.create.length + calls.claims.length + calls.imports.length, 0);
});

void test('atomic reservation UID/email collisions stop before marker claims or BCRYPT import', async () => {
  for (const code of ['auth/uid-already-exists', 'auth/email-already-exists']) {
    const { provision, calls } = fixture({ createError: authError(code) });
    await assert.rejects(provision(candidate, { runId: 'new-run' }), assertConflict);
    assert.equal(calls.create.length, 1);
    assert.equal(calls.claims.length + calls.imports.length + calls.update.length + calls.delete.length, 0);
  }
});

void test('marker write failure leaves an inaccessible reservation and never imports or deletes an account', async () => {
  const { provision, saved, calls } = fixture({ markerError: authError('auth/internal-error') });
  await assert.rejects(provision(candidate, { runId: 'new-run' }), { code: 'auth/internal-error' });
  assert.equal(saved.get(candidate.employeeId).disabled, true);
  assert.equal(saved.get(candidate.employeeId).customClaims, undefined);
  assert.equal(calls.imports.length + calls.delete.length, 0);
});

void test('a reservation changed after marking is not overwritten by the import helper', async () => {
  const { provision, saved, calls } = fixture({ afterMarker: user => { user.customClaims.role = 'admin'; user.password = 'password-preserved'; } });
  await assert.rejects(provision(candidate, { runId: 'new-run' }), assertConflict);
  assert.equal(calls.imports.length, 0);
  assert.equal(saved.get(candidate.employeeId).password, 'password-preserved');
});

void test('invalid candidates and missing run identifiers perform no Auth writes', async () => {
  for (const [input, options] of [[{ ...candidate, employeeId: '../bad' }, { runId: 'r' }], [candidate, {}], [{ ...candidate, name: '' }, { runId: 'r' }], [{ ...candidate, name: '測'.repeat(101) }, { runId: 'r' }]]) {
    const { provision, calls } = fixture();
    await assert.rejects(provision(input, options), { code: 'invalid-argument' });
    assert.equal(calls.create.length + calls.claims.length + calls.imports.length, 0);
  }
});

void test('the source domain and Auth hook accept names through the same 100-character limit', async () => {
  for (const length of [81, 100]) {
    const { provision, saved } = fixture();
    const name = '測'.repeat(length);
    assert.deepEqual(await provision({ ...candidate, name }, { runId: 'long-name-run' }), { created: true, reused: false });
    assert.equal(saved.get(candidate.employeeId).displayName, name);
  }
});
