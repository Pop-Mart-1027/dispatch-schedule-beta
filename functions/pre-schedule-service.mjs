import { createHash, randomUUID } from 'node:crypto';
import {
  monthDays,
  assessDays,
  PRE_CHOICES,
  preScheduleGroup,
  effectiveMonthStatus,
  mayEmployeeEdit,
  mayReview,
  publicationSummary,
  toFormalRecords,
} from './pre-schedule-domain.mjs';

const codeCaches = new WeakMap();

export function partitionPublicationItems(items) {
  const chunks = [];
  let chunk = [],
    bytes = 32;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item), 'utf8') + 2;
    if (size > 499968)
      throw Error('單筆正式班表過大，請先檢查來源內容，尚未寫入正式班表');
    if (chunk.length && (chunk.length === 100 || bytes + size > 500000)) {
      chunks.push(chunk);
      chunk = [];
      bytes = 32;
    }
    chunk.push(item);
    bytes += size;
  }
  if (chunk.length) chunks.push(chunk);
  return chunks;
}

export function createPreScheduleService({
  db,
  FieldValue,
  Timestamp,
  HttpsError,
  now = () => Date.now(),
}) {
  const fail = (code, message) => {
    throw new HttpsError(code, message);
  };
  const stamp = () => FieldValue.serverTimestamp();
  const ms = (value) =>
    value?.toMillis?.() ?? (typeof value === 'number' ? value : null);
  const publicMonth = (data) => ({
    ...data,
    openAt: ms(data.openAt),
    closeAt: ms(data.closeAt),
    publishedAt: ms(data.publishedAt),
    createdAt: ms(data.createdAt),
    updatedAt: ms(data.updatedAt),
  });
  const serializeEntry = (data) =>
    data
      ? {
          ...data,
          submittedAt: ms(data.submittedAt),
          updatedAt: ms(data.updatedAt),
          modifiedAt: ms(data.modifiedAt),
        }
      : null;
  const monthRef = (key) => db.collection('preScheduleMonths').doc(key);
  async function formalCodeCatalog(key, fresh = false) {
    let cache = codeCaches.get(db);
    if (!cache) {
      cache = new Map();
      codeCaches.set(db, cache);
    }
    const cached = cache.get(key);
    if (!fresh && cached && Date.now() - cached.at < 60000) return cached.value;
    // Read the latest preceding formal month, never a JSON fallback or user-supplied catalog.
    const latest = await db
      .collection('scheduleRecords')
      .where('date', '<', `${key}-01`)
      .orderBy('date', 'desc')
      .limit(1)
      .get();
    const sourceMonth = latest.empty
      ? key
      : latest.docs[0].data().date.slice(0, 7);
    const sources = [...new Set([sourceMonth, key])];
    const rows = (
      await Promise.all(
        sources.map((month) =>
          db
            .collection('scheduleRecords')
            .where('date', '>=', `${month}-01`)
            .where('date', '<=', `${month}-31`)
            .select('scheduleCode', 'shiftType')
            .get(),
        ),
      )
    ).flatMap((snap) => snap.docs);
    const codes = { day: new Set(), night: new Set() };
    for (const row of rows) {
      const data = row.data(),
        group = preScheduleGroup({}, data.shiftType);
      if (!group || typeof data.scheduleCode !== 'string') continue;
      for (const code of [data.scheduleCode, ...data.scheduleCode.split('／')])
        if (
          code &&
          code === code.trim() &&
          code.length <= 80 &&
          !PRE_CHOICES.includes(code)
        )
          codes[group].add(code);
    }
    const value = {
      day: [...codes.day].sort(),
      night: [...codes.night].sort(),
      sourceMonth,
    };
    cache.set(key, { at: Date.now(), value });
    return value;
  }
  async function actor(request) {
    const id = request.auth?.token?.employeeId;
    if (!id || request.auth.uid !== id) fail('unauthenticated', '請重新登入');
    const snap = await db.collection('employees').doc(id).get(),
      data = snap.data();
    if (
      !data?.active ||
      data.mustChangePassword !== false ||
      request.auth.token.mustChangePassword !== false
    )
      fail('permission-denied', '帳號未啟用或需要修改密碼');
    const role = data.role === 'monitor' ? 'duty' : data.role;
    const claim =
      request.auth.token.role === 'monitor' ? 'duty' : request.auth.token.role;
    if (role !== claim || !['employee', 'duty', 'admin'].includes(role))
      fail('permission-denied', '權限不一致');
    return { id, role, data };
  }
  const requireDuty = (a) => {
    if (!['duty', 'admin'].includes(a.role))
      fail('permission-denied', '需要值班監控權限');
  };
  const requireAdmin = (a) => {
    if (a.role !== 'admin')
      fail('permission-denied', '只有管理員可以發布或設定月份');
  };
  async function context(key) {
    const ref = monthRef(key);
    // Settings remain the period source; no dates are hardcoded in a component.
    return db.runTransaction(async (tx) => {
      const [snap, settings] = await Promise.all([
        tx.get(ref),
        tx.get(db.collection('scheduleSettings').doc(key)),
      ]);
      if (!snap.exists)
        return {
          month: null,
          settings: settings.exists
            ? {
                ...settings.data(),
                startAt: ms(settings.data().startAt),
                endAt: ms(settings.data().endAt),
              }
            : null,
        };
      const data = snap.data(),
        config = settings.data();
      if (!data.publishJob && data.status !== 'published' && config) {
        const next = {
          ...data,
          openAt: config.startAt || null,
          closeAt: config.endAt || null,
          status: config.status === 'closed' ? 'locked' : 'open',
        };
        next.status = effectiveMonthStatus(publicMonth(next), now());
        if (
          data.status !== next.status ||
          ms(data.openAt) !== ms(next.openAt) ||
          ms(data.closeAt) !== ms(next.closeAt)
        ) {
          tx.update(ref, {
            status: next.status,
            openAt: next.openAt,
            closeAt: next.closeAt,
            updatedAt: stamp(),
          });
        }
        return { month: publicMonth(next), settings: null };
      }
      return { month: publicMonth(data), settings: null };
    });
  }
  async function roster(key) {
    return (
      (await monthRef(key).collection('internal').doc('roster').get()).data()
        ?.people || []
    );
  }
  async function buildRoster() {
    const [employees, latest] = await Promise.all([
      db.collection('employees').where('active', '==', true).get(),
      db.collection('scheduleRecords').orderBy('date', 'desc').limit(1).get(),
    ]);
    const formal = latest.empty
      ? []
      : (
          await db
            .collection('scheduleRecords')
            .where('date', '==', latest.docs[0].data().date)
            .get()
        ).docs;
    const shifts = new Map(
      formal.map((d) => [d.data().employeeId, d.data().shiftType]),
    );
    const people = employees.docs.map((d) => ({
      employeeId: d.id,
      name: d.data().name,
      title: d.data().title || '',
      group: preScheduleGroup(d.data(), shifts.get(d.id)),
    }));
    if (!people.length || people.some((p) => !p.group))
      fail(
        'failed-precondition',
        '部分員工缺少可確認班別，請先確認既有正式員工／班表資料',
      );
    return people.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
  }
  async function summary(key) {
    const [people, entries, formal, snap, catalog] = await Promise.all([
      roster(key),
      monthRef(key).collection('entries').get(),
      db
        .collection('scheduleRecords')
        .where('date', '>=', `${key}-01`)
        .where('date', '<=', `${key}-31`)
        .get(),
      monthRef(key).get(),
      formalCodeCatalog(key, true),
    ]);
    const values = entries.docs.map((d) => d.data());
    const currentEmployees = people.length
      ? await db.getAll(
          ...people.map((p) => db.collection('employees').doc(p.employeeId)),
        )
      : [];
    const identityConflicts = currentEmployees.filter(
      (d, i) =>
        !d.data()?.active ||
        d.data()?.name !== people[i].name ||
        (d.data()?.title || '') !== people[i].title,
    ).length;
    const version = (d) => [
      d.id,
      d.updateTime.seconds,
      d.updateTime.nanoseconds,
    ];
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          people,
          catalog,
          entries: entries.docs.map(version).sort(),
          formal: formal.docs.map(version).sort(),
          employees: currentEmployees.map((d) =>
            d.exists ? version(d) : [d.id, null],
          ),
        }),
      )
      .digest('hex');
    const counts = publicationSummary(
      key,
      people,
      values,
      formal.size,
      catalog,
    );
    return {
      ...counts,
      abnormal: Math.min(counts.expected, counts.abnormal + identityConflicts),
      blocking: counts.blocking + identityConflicts,
      identityConflicts,
      fingerprint,
      people,
      values,
      formal,
      catalog,
      month: snap.data(),
    };
  }
  const cleanSummary = (s) => {
    const { people, values, formal, month, catalog, ...rest } = s;
    return rest;
  };
  async function handle(request) {
    const a = await actor(request),
      input = request.data || {},
      key = String(input.monthKey || '');
    try {
      monthDays(key);
    } catch {
      fail('invalid-argument', '月份格式不正確');
    }
    const ref = monthRef(key);
    if (input.action === 'configure') {
      requireAdmin(a);
      if (
        !['open', 'locked'].includes(input.status) ||
        !Number.isFinite(input.openAt) ||
        !Number.isFinite(input.closeAt) ||
        input.openAt >= input.closeAt
      )
        fail('invalid-argument', '請設定正確開放與截止時間');
      const people = await buildRoster();
      await db.runTransaction(async (tx) => {
        const [snap, existingRoster] = await Promise.all([
          tx.get(ref),
          tx.get(ref.collection('internal').doc('roster')),
        ]);
        if (snap.data()?.publishJob || snap.data()?.status === 'published')
          fail('failed-precondition', '發布中或已發布月份不可重新開放');
        tx.set(
          ref,
          {
            monthKey: key,
            status: input.status,
            openAt: Timestamp.fromMillis(input.openAt),
            closeAt: Timestamp.fromMillis(input.closeAt),
            createdAt: snap.data()?.createdAt || stamp(),
            updatedAt: stamp(),
            publishedAt: null,
            publishedBy: '',
            publishJob: null,
          },
          { merge: true },
        );
        if (!existingRoster.exists)
          tx.set(ref.collection('internal').doc('roster'), { people });
        tx.set(
          db.collection('scheduleSettings').doc(key),
          {
            targetMonth: key,
            startAt: Timestamp.fromMillis(input.openAt),
            endAt: Timestamp.fromMillis(input.closeAt),
            status: input.status === 'locked' ? 'closed' : 'open',
            updatedBy: a.id,
            updatedAt: stamp(),
          },
          { merge: true },
        );
      });
      return context(key);
    }
    const ctx = await context(key);
    if (input.action === 'context') {
      const entry = await ref.collection('entries').doc(a.id).get();
      return { ...ctx, ownerId: a.id, entry: serializeEntry(entry.data()) };
    }
    if (!ctx.month)
      fail(
        'failed-precondition',
        '此月份尚未開放，請管理員從既有期限設定建立月份',
      );
    if (input.action === 'group') {
      requireDuty(a);
      if (!['day', 'night'].includes(input.group))
        fail('invalid-argument', '只能選早班組或夜班組');
      const [people, entries, catalog] = await Promise.all([
        roster(key),
        ref.collection('entries').where('group', '==', input.group).get(),
        formalCodeCatalog(key),
      ]);
      return {
        ...ctx,
        roster: people.filter((p) => p.group === input.group),
        entries: entries.docs.map((d) => serializeEntry(d.data())),
        formalCodes: catalog[input.group],
        formalCodeSourceMonth: catalog.sourceMonth,
      };
    }
    if (input.action === 'save' || input.action === 'review') {
      const review = input.action === 'review';
      if (review) requireDuty(a);
      if (!review && input.ownerId && input.ownerId !== a.id)
        fail('permission-denied', '登入帳號已變更，請重新載入自己的預排');
      const target = review ? String(input.employeeId || '') : a.id;
      const person = (await roster(key)).find((p) => p.employeeId === target);
      if (!person) fail('failed-precondition', '不在此月份應預排員工名單');
      const catalog = review ? await formalCodeCatalog(key) : null;
      const checks = review
        ? {
            valid:
              Array.isArray(input.arrangedDays) &&
              input.arrangedDays.length === monthDays(key) &&
              input.arrangedDays.every(
                (code) =>
                  code === null ||
                  code === '' ||
                  PRE_CHOICES.includes(code) ||
                  catalog[person.group].includes(code),
              ),
          }
        : assessDays(key, input.days);
      if (!review && input.arrangedDays !== undefined)
        fail('permission-denied', '正式班碼只能由監控整理');
      if (
        !checks.valid ||
        typeof input.note !== 'string' ||
        input.note.length > 2000
      )
        fail('invalid-argument', '預排天數、班別或備註不正確');
      if (!review && input.submit && !checks.canSubmit)
        fail('failed-precondition', '預排未完整或不符合既有預排檢查');
      const entryRef = ref.collection('entries').doc(target);
      await db.runTransaction(async (tx) => {
        const [m, old, settings] = await Promise.all([
          tx.get(ref),
          tx.get(entryRef),
          tx.get(db.collection('scheduleSettings').doc(key)),
        ]);
        const month = publicMonth(m.data());
        if (settings.data()?.status === 'closed') month.status = 'locked';
        month.openAt = ms(settings.data()?.startAt ?? m.data().openAt);
        month.closeAt = ms(settings.data()?.endAt ?? m.data().closeAt);
        if (review ? !mayReview(month, now()) : !mayEmployeeEdit(month, now()))
          fail(
            'permission-denied',
            review
              ? '截止後才可整理，發布中不可修改'
              : '預排未開放或已截止，目前唯讀',
          );
        if ((old.data()?.revision || 0) !== input.revision)
          fail('aborted', '資料已被另一視窗更新，請重新載入後再修改');
        const value = {
          employeeId: target,
          employeeName: person.name,
          jobTitle: person.title,
          group: person.group,
          days: review
            ? old.data()?.days || Array(monthDays(key)).fill('')
            : input.days,
          arrangedDays: review
            ? input.arrangedDays
            : (
                old.data()?.arrangedDays || Array(monthDays(key)).fill(null)
              ).map((code, index) =>
                old.data()?.days?.[index] === input.days[index] ? code : null,
              ),
          note: input.note,
          submitted: old.data()?.submitted || (!review && !!input.submit),
          submittedAt:
            old.data()?.submittedAt ||
            (!review && input.submit ? stamp() : null),
          updatedAt: stamp(),
          revision: input.revision + 1,
        };
        tx.set(
          entryRef,
          {
            ...value,
            ...(review ? { modifiedBy: a.id, modifiedAt: stamp() } : {}),
          },
          { merge: true },
        );
        if (review)
          tx.set(ref.collection('auditLogs').doc(), {
            employeeId: target,
            modifiedBy: a.id,
            modifiedAt: stamp(),
            before: old.data() || null,
            after: { ...value, modifiedBy: a.id, modifiedAt: stamp() },
          });
      });
      return { entry: serializeEntry((await entryRef.get()).data()) };
    }
    if (input.action === 'summary') {
      requireAdmin(a);
      return cleanSummary(await summary(key));
    }
    if (input.action === 'cancelPreparation') {
      requireAdmin(a);
      await db.runTransaction(async (tx) => {
        const m = await tx.get(ref),
          id = m.data().publishJob;
        if (!id) return;
        const j = await tx.get(ref.collection('internal').doc(id));
        if (j.data()?.next > 0)
          fail(
            'failed-precondition',
            '已有正式班表寫入，只能繼續完成或由管理員處理衝突，不可取消紀錄',
          );
        tx.update(ref, { publishJob: null, updatedAt: stamp() });
      });
      return { cancelled: true };
    }
    if (input.action === 'publish') {
      requireAdmin(a);
      if (!input.confirmed) fail('failed-precondition', '請先確認發布摘要');
      const jobId = randomUUID();
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref),
          data = publicMonth(snap.data());
        if (data.publishJob || data.status === 'published')
          fail('failed-precondition', '已有發布作業，請查看進度或繼續發布');
        if (!mayReview(data, now()) && data.status !== 'locked')
          fail('failed-precondition', '請先截止或鎖定月份');
        tx.update(ref, {
          publishJob: jobId,
          publishProgress: 0,
          updatedAt: stamp(),
        });
      });
      try {
        const s = await summary(key);
        if (s.fingerprint !== input.fingerprint)
          fail('aborted', '預排或正式班表已有變更，請重新確認摘要');
        if (s.unarrangedWorkDays)
          fail(
            'failed-precondition',
            `尚有 ${s.unarrangedWorkDays} 個出勤班次未完成班別／區域安排`,
          );
        if (s.blocking || !s.expected)
          fail('failed-precondition', '尚有未完整或資料識別異常，不能猜值發布');
        if ((s.abnormal || s.unsubmitted) && !input.acknowledgeWarnings)
          fail('failed-precondition', '請確認異常與未送出警告');
        if (s.existingCount && input.overwriteMonth !== key)
          fail('failed-precondition', '此月份已有正式班表，請再次確認覆蓋月份');
        const existing = new Map();
        for (const d of s.formal.docs) {
          const v = d.data(),
            k = `${v.employeeId}_${v.date}`;
          if (existing.has(k))
            fail('failed-precondition', '正式班表有重複員編日期，請先釐清');
          existing.set(k, d);
        }
        const records = toFormalRecords(
          key,
          s.people,
          s.values,
          a.id,
          s.catalog,
        );
        const chunks = partitionPublicationItems(
          records.map((record) => {
            const old = existing.get(record.id);
            return {
              record: { ...record, id: old?.id || record.id },
              before: old?.data() || null,
              expected: old?.updateTime || null,
            };
          }),
        );
        const jobRef = ref.collection('internal').doc(jobId);
        // Keep both each manifest document and each transaction bounded, even for
        // 750 employees with long notes. No formal records are written in preparation.
        await db.runTransaction(async (tx) => {
          const current = await tx.get(ref);
          if (current.data()?.publishJob !== jobId)
            fail('aborted', '發布準備已取消，請重新確認月份');
          tx.set(jobRef, {
            ready: false,
            workflowVersion: 2,
            total: chunks.length,
            next: 0,
            records: records.length,
            createdBy: a.id,
            createdAt: stamp(),
          });
        });
        for (let start = 0; start < chunks.length; start += 10) {
          await db.runTransaction(async (tx) => {
            const current = await tx.get(ref);
            if (current.data()?.publishJob !== jobId)
              fail('aborted', '發布準備已取消，請重新確認月份');
            chunks.slice(start, start + 10).forEach((items, index) =>
              tx.set(jobRef.collection('chunks').doc(String(start + index)), {
                items,
              }),
            );
          });
        }
        await db.runTransaction(async (tx) => {
          const current = await tx.get(ref);
          if (current.data()?.publishJob !== jobId)
            fail('aborted', '發布準備已取消，請重新確認月份');
          tx.update(jobRef, { ready: true });
        });
        return {
          jobId,
          total: chunks.length,
          next: 0,
          records: records.length,
        };
      } catch (error) {
        await db.runTransaction(async (tx) => {
          const current = await tx.get(ref);
          if (current.data()?.publishJob === jobId)
            tx.update(ref, { publishJob: null, updatedAt: stamp() });
        });
        throw error;
      }
    }
    if (input.action === 'continue') {
      requireAdmin(a);
      const jobId = ctx.month.publishJob;
      if (!jobId || input.jobId !== jobId)
        fail('failed-precondition', '發布作業不一致');
      const jobRef = ref.collection('internal').doc(jobId);
      return db.runTransaction(async (tx) => {
        const [m, j] = await Promise.all([tx.get(ref), tx.get(jobRef)]);
        const job = j.data();
        if (job?.workflowVersion !== 2)
          fail(
            'failed-precondition',
            '舊版發布計畫不可直接發布，請重新整理並確認摘要',
          );
        if (m.data().publishJob !== jobId || !job?.ready)
          fail('failed-precondition', '發布計畫尚未完成，請聯絡管理員');
        if (input.next !== job.next) return { jobId, ...job };
        const chunk = await tx.get(
          jobRef.collection('chunks').doc(String(job.next)),
        );
        const items = chunk.data().items;
        if (items.some((item) => item.record.scheduleCode === '上班'))
          fail(
            'failed-precondition',
            '發布計畫仍有出勤班次未完成班別／區域安排',
          );
        const refs = items.map((x) =>
          db.collection('scheduleRecords').doc(x.record.id),
        );
        const old = await tx.getAll(...refs);
        old.forEach((d, i) => {
          if (
            d.exists !== !!items[i].expected ||
            (d.exists && !d.updateTime.isEqual(items[i].expected))
          )
            fail('aborted', '正式班表已被其他人修改，發布已暫停；不可靜默覆蓋');
        });
        items.forEach((item, i) => {
          tx.set(refs[i], {
            ...item.before,
            ...item.record,
            createdAt: item.before?.createdAt || stamp(),
            updatedAt: stamp(),
            modifiedAt: stamp(),
          });
          tx.set(
            db
              .collection('scheduleAuditLogs')
              .doc(`${jobId}_${item.record.id}`),
            {
              employeeId: item.record.employeeId,
              date: item.record.date,
              modifiedBy: a.id,
              modifiedAt: stamp(),
              before: item.before,
              after: item.record,
              source: `preScheduleMonths/${key}`,
              publishJob: jobId,
            },
          );
        });
        const next = job.next + 1,
          done = next === job.total;
        tx.update(jobRef, { next, updatedAt: stamp() });
        tx.update(ref, {
          publishProgress: next,
          updatedAt: stamp(),
          ...(done
            ? {
                status: 'published',
                publishedAt: stamp(),
                publishedBy: a.id,
                publishJob: null,
              }
            : {}),
        });
        return { jobId, next, total: job.total, records: job.records, done };
      });
    }
    if (input.action === 'progress') {
      requireAdmin(a);
      return ctx.month.publishJob
        ? {
            jobId: ctx.month.publishJob,
            ...(
              await ref.collection('internal').doc(ctx.month.publishJob).get()
            ).data(),
          }
        : null;
    }
    fail('invalid-argument', '不支援的預排操作');
  }
  async function closeExpired() {
    const months = await db
      .collection('preScheduleMonths')
      .where('status', 'in', ['open', 'locked'])
      .get();
    for (const m of months.docs) await context(m.id);
  }
  return { handle, closeExpired };
}
