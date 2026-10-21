import type { Modality, PreviousSet, Units, WorkoutSet } from '../api/types'
import { formatDuration } from './time'
import { formatWeight, toDisplay, toKg } from './units'

/*
 * Modality-aware field plumbing, shared by the workout screen and the set editor on the stats page.
 * Each exercise type puts different things in the two values, so labels, stepping, parsing and
 * formatting all key off the modality rather than being hard-coded to weight and reps.
 */

// Each exercise type puts different things in the two values, so labels, stepping, parsing and
// formatting all key off the modality rather than being hard-coded to weight and reps.

export type FieldKey = 'primary' | 'secondary'

export interface FieldSpec {
  key: FieldKey
  label: string
  /** Column heading in the set list, where space is tight. */
  short: string
  /** Entered as m:ss rather than a plain number. */
  clock: boolean
  step: number
  min: number | null
  inputMode: 'text' | 'numeric' | 'decimal'
}

/**
 * The two values for a modality, in display order: reps above weight, as on a gym machine log.
 * `weightStep` is in display units - the user's own setting, from weightStep() in lib/units.
 */
export function fieldsFor(modality: Modality, units: Units, weightStep: number): FieldSpec[] {
  const reps: FieldSpec = { key: 'secondary', label: 'Reps', short: 'Reps', clock: false, step: 1, min: 0, inputMode: 'numeric' }

  if (modality === 'Duration') {
    return [
      { key: 'primary', label: 'Time', short: 'Time', clock: true, step: 15, min: 0, inputMode: 'text' },
      reps,
    ]
  }

  if (modality === 'DistanceDuration') {
    return [
      { key: 'primary', label: 'Distance (m)', short: 'Meters', clock: false, step: 100, min: 0, inputMode: 'decimal' },
      { key: 'secondary', label: 'Time', short: 'Time', clock: true, step: 15, min: 0, inputMode: 'text' },
    ]
  }

  const bodyweight = modality === 'BodyweightReps'
  return [
    reps,
    {
      key: 'primary',
      label: bodyweight ? `Added weight (${units})` : `Weight (${units})`,
      short: bodyweight ? `+${units}` : units,
      clock: false,
      step: weightStep,
      // Negative added load is how an assisted pull-up is logged.
      min: bodyweight ? null : 0,
      inputMode: 'decimal',
    },
  ]
}

export function stepValue(text: string, field: FieldSpec, direction: 1 | -1): string {
  const current = (field.clock ? parseClock(text) : parseNumber(text)) ?? 0
  let next = current + direction * field.step
  if (field.min !== null) next = Math.max(field.min, next)
  next = Math.round(next * 100) / 100
  return field.clock ? formatDuration(next) : String(next)
}

export function hasValues(set: Partial<WorkoutSet>): boolean {
  return set.weightKg != null || set.reps != null || set.durationSeconds != null || set.distanceM != null
}

export function primaryValue(set: Partial<WorkoutSet>, modality: Modality, units: Units): string {
  if (modality === 'Duration') return set.durationSeconds ? formatDuration(set.durationSeconds) : ''
  if (modality === 'DistanceDuration') return set.distanceM != null ? String(set.distanceM) : ''
  const display = toDisplay(set.weightKg, units)
  return display === null ? '' : String(Math.round(display * 100) / 100)
}

export function secondaryValue(set: Partial<WorkoutSet>, modality: Modality): string {
  if (modality === 'Duration') return set.reps != null ? String(set.reps) : ''
  if (modality === 'DistanceDuration') return set.durationSeconds ? formatDuration(set.durationSeconds) : ''
  return set.reps != null ? String(set.reps) : ''
}

/** A set's values as entered, parsed into what the API stores. */
export type ParsedValues = ReturnType<typeof parseInputs>

export function parseInputs(primary: string, secondary: string, modality: Modality, units: Units) {
  if (modality === 'Duration') {
    return { durationSeconds: parseClock(primary), reps: parseInt10(secondary) }
  }
  if (modality === 'DistanceDuration') {
    return { distanceM: parseNumber(primary), durationSeconds: parseClock(secondary) }
  }
  return { weightKg: toKg(parseNumber(primary), units), reps: parseInt10(secondary) }
}

/** Accepts either "90" or "1:30" so a plank and a 20-minute row are both natural to enter. */
export function parseClock(text: string): number | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => Number(p.trim()) || 0)
    return parts.reduce((total, part) => total * 60 + part, 0)
  }

  return parseInt10(trimmed)
}

export function parseNumber(text: string): number | null {
  const value = Number(text.trim().replace(',', '.'))
  return text.trim() === '' || Number.isNaN(value) ? null : value
}

export function parseInt10(text: string): number | null {
  const value = parseInt(text.trim(), 10)
  return Number.isNaN(value) ? null : value
}


/** One set as it is read aloud: "90 kg × 6", "45 s", "500 m in 2:10". */
export function describeSet(set: PreviousSet, modality: Modality, units: Units) {
  if (modality === 'Duration') {
    return `${formatDuration(set.durationSeconds)}${set.reps ? ` × ${set.reps}` : ''}`
  }
  if (modality === 'DistanceDuration') {
    return `${set.distanceM ?? '-'} m in ${formatDuration(set.durationSeconds)}`
  }
  if (modality === 'BodyweightReps') {
    return `${set.reps ?? '-'} reps${set.weightKg ? ` +${formatWeight(set.weightKg, units)}` : ''}`
  }
  return `${formatWeight(set.weightKg, units)} × ${set.reps ?? '-'}`
}
