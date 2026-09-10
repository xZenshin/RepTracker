/**
 * Mirrors LoginCode.cs on the server. Checking the Luhn digit here means a mistyped code is caught
 * before it becomes a request, so typos never eat into the login rate limit.
 */

export const CODE_LENGTH = 20

export function digitsOnly(input: string): string {
  return input.replace(/\D/g, '').slice(0, CODE_LENGTH)
}

/** Groups of four, the way the code is shown when it is first handed out. */
export function formatCode(input: string): string {
  return digitsOnly(input).replace(/(.{4})/g, '$1 ').trim()
}

export function isWellFormed(code: string): boolean {
  const digits = digitsOnly(code)
  if (digits.length !== CODE_LENGTH) return false
  return checkDigit(digits.slice(0, -1)) === Number(digits[CODE_LENGTH - 1])
}

function checkDigit(payload: string): number {
  let sum = 0
  let double = true

  for (let i = payload.length - 1; i >= 0; i--) {
    let value = Number(payload[i])
    if (double) {
      value *= 2
      if (value > 9) value -= 9
    }
    sum += value
    double = !double
  }

  return (10 - (sum % 10)) % 10
}
