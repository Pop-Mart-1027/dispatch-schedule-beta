import fs from 'node:fs/promises'
import bcrypt from 'bcryptjs'

const schedule = JSON.parse(await fs.readFile(new URL('../public/september-schedules.json', import.meta.url), 'utf8'))
const people = JSON.parse(await fs.readFile(new URL('../people.json', import.meta.url), 'utf8'))
const rows = [...schedule.morning, ...schedule.night]
const metadata = new Map(people.map(person => [person.id, person]))
const byId = new Map()
const conflicts = []

for (const row of rows) {
  if (!/^[A-Z0-9]{3,20}$/.test(row.employeeId)) continue
  const previous = byId.get(row.employeeId)
  if (previous && previous.name !== row.name) {
    conflicts.push({ employeeId: row.employeeId, names: [previous.name, row.name] })
    continue
  }
  byId.set(row.employeeId, row)
}

if (conflicts.length) throw new Error(`尚有員編衝突：${JSON.stringify(conflicts)}`)

const explicitAdmins = new Set(['93900', '93339', '95011', 'B0957'])
const employees = [...byId.values()].sort((left, right) => left.employeeId.localeCompare(right.employeeId, 'en', { numeric: true })).map(row => {
  const person = metadata.get(row.employeeId)
  return {
    employeeId: row.employeeId,
    name: row.name,
    title: person?.title || row.title || '調度專員',
    hireDate: person?.hire || '2020-01-01',
    role: explicitAdmins.has(row.employeeId) ? 'admin' : person?.role === 'duty' ? 'duty' : 'employee',
  }
})

const users = []
for (const employee of employees) {
  const hash = await bcrypt.hash(employee.employeeId, 10)
  users.push({
    localId: employee.employeeId,
    email: `${employee.employeeId.toLowerCase()}@employees.smilebike.invalid`,
    emailVerified: true,
    displayName: employee.name,
    passwordHash: Buffer.from(hash).toString('base64'),
    customAttributes: JSON.stringify({ employeeId: employee.employeeId, role: employee.role, active: true, mustChangePassword: true }),
  })
}

await fs.mkdir(new URL('../outputs/', import.meta.url), { recursive: true })
await fs.writeFile(new URL('../outputs/firebase-auth-import.json', import.meta.url), `${JSON.stringify({ users })}\n`, { mode: 0o600 })
await fs.writeFile(new URL('../outputs/employees-seed.json', import.meta.url), `${JSON.stringify({ employees }, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({ prepared: users.length, admins: employees.filter(employee => employee.role === 'admin').map(employee => employee.employeeId), conflicts }))
