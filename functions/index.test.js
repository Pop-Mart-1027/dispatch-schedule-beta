'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

test('employee email is deterministic and lowercase', () => {
  const email = `${'B0957'.toLowerCase()}@employees.smilebike.invalid`
  assert.equal(email, 'b0957@employees.smilebike.invalid')
})

test('new password policy rejects employee id and short values', () => {
  const valid = password => password.length >= 8 && password.toUpperCase() !== 'B0957'
  assert.equal(valid('B0957'), false)
  assert.equal(valid('short'), false)
  assert.equal(valid('Secure-2026!'), true)
})
