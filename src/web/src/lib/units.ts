import type { Units } from '../api/types'

const LB_PER_KG = 2.2046226218

/**
 * Load is stored in kilograms everywhere - in the database, in the API, and in every statistic -
 * and converted only at the edges. That keeps history comparable if the display unit is switched.
 */
export function toDisplay(kg: number | null | undefined, units: Units): number | null {
  if (kg === null || kg === undefined) return null
  return units === 'lb' ? kg * LB_PER_KG : kg
}

export function toKg(value: number | null | undefined, units: Units): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return units === 'lb' ? value / LB_PER_KG : value
}

/** Trims the decimal when it is not carrying information: 80 rather than 80.0, but 82.5 intact. */
export function formatWeight(kg: number | null | undefined, units: Units, withUnit = true): string {
  const value = toDisplay(kg, units)
  if (value === null) return '-'
  const rounded = Math.round(value * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return withUnit ? `${text} ${units}` : text
}

/** Big volume numbers are unreadable in full, so they climb into tonnes. */
export function formatVolume(kg: number, units: Units): string {
  const value = toDisplay(kg, units) ?? 0
  if (units === 'lb') {
    return value >= 100_000
      ? `${(value / 1000).toFixed(0)}k lb`
      : `${Math.round(value).toLocaleString()} lb`
  }
  if (value >= 10_000) return `${(value / 1000).toFixed(1)} t`
  return `${Math.round(value).toLocaleString()} kg`
}

export function unitLabel(units: Units) {
  return units
}

/** Plate-friendly steps: 2.5 kg is the smallest pair of plates, 5 lb the imperial equivalent. */
export function weightStep(units: Units) {
  return units === 'lb' ? 5 : 2.5
}
