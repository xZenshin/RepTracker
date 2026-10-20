import type { Exercise } from '../api/types'

/**
 * Exercises that could stand in for another when its machine or bench is taken.
 *
 * Muscle group alone is too coarse: a lat pulldown and a deadlift are both "back", but only one is a
 * sensible swap. So each exercise is also sorted into a movement family by words in its name - a
 * vertical pull, a row, a hinge, a press - and the same family counts for most, a neighbouring family
 * (rows for a pulldown, flyes for a press) for some, and the same muscle group and push/pull pattern
 * after that. The user's own exercises edge ahead of the catalogue's, since they are what they train.
 */

type Family =
  | 'vertical-pull' | 'horizontal-pull' | 'rear-delt' | 'hinge' | 'horizontal-press' | 'vertical-press'
  | 'fly' | 'raise' | 'curl' | 'triceps' | 'squat' | 'leg-curl' | 'leg-extension' | 'calf' | 'shrug'
  | 'core' | 'forearm'

// First match wins, so the specific comes before the general: a leg curl before a curl, an upright
// row before a row, a close-grip bench before a bench. Words match where they begin.
const FAMILIES: [Family, string[]][] = [
  ['leg-curl', ['leg curl', 'hamstring', 'nordic']],
  ['forearm', ['forearm', 'wrist']],
  ['rear-delt', ['rear delt', 'face pull', 'reverse fly', 'reverse pec']],
  ['raise', ['lateral raise', 'side raise', 'front raise', 'upright row']],
  ['triceps', ['tricep', 'pushdown', 'push down', 'skull', 'jm press', 'kickback', 'close grip']],
  ['vertical-pull', ['pulldown', 'pull down', 'pull up', 'pullup', 'chin up', 'chinup', 'pullover']],
  ['horizontal-pull', ['row']],
  ['shrug', ['shrug']],
  ['hinge', ['deadlift', 'rdl', 'romanian', 'good morning', 'back extension', 'hyperextension', 'hip thrust', 'glute bridge', 'swing']],
  ['vertical-press', ['overhead press', 'shoulder press', 'military', 'arnold', 'push press']],
  ['fly', ['fly', 'flye', 'pec deck', 'crossover']],
  ['horizontal-press', ['bench', 'chest press', 'push up', 'pushup', 'dip', 'floor press']],
  ['curl', ['curl']],
  ['leg-extension', ['leg extension']],
  ['squat', ['squat', 'leg press', 'lunge', 'step up', 'hack']],
  ['calf', ['calf', 'calves']],
  ['core', ['crunch', 'leg raise', 'knee raise', 'plank', 'wood chop', 'woodchop', 'ab ', 'abs', 'rollout', 'twist', 'sit up', 'dead bug']],
]

// Families close enough to stand in for each other at a push.
const NEIGHBOURS: [Family, Family][] = [
  ['vertical-pull', 'horizontal-pull'],
  ['horizontal-press', 'fly'],
  ['horizontal-press', 'vertical-press'],
  ['vertical-press', 'raise'],
  ['squat', 'leg-extension'],
  ['hinge', 'leg-curl'],
  ['rear-delt', 'horizontal-pull'],
]

export function familyOf(name: string): Family | null {
  const words = ` ${name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `
  return FAMILIES.find(([, keys]) => keys.some((key) => words.includes(` ${key}`)))?.[0] ?? null
}

function neighbours(a: Family | null, b: Family | null) {
  return a !== null && b !== null && NEIGHBOURS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}

/** Up to `limit` substitutes for `target`, best first. Only exercises sharing its family or muscle group. */
export function similarExercises(target: Exercise, all: Exercise[], limit = 8): Exercise[] {
  const family = familyOf(target.name)

  return all
    .filter((exercise) => exercise.id !== target.id && !exercise.isArchived)
    .map((exercise) => {
      const theirs = familyOf(exercise.name)
      const sameFamily = family !== null && theirs === family
      const sameMuscle = exercise.muscleGroup === target.muscleGroup && target.muscleGroup !== 'Other'
      const score =
        (sameFamily ? 6 : 0) +
        (neighbours(family, theirs) ? 2 : 0) +
        (sameMuscle ? 3 : 0) +
        (exercise.pattern === target.pattern && target.pattern !== 'other' ? 1 : 0) +
        (exercise.isCustom ? 0.5 : 0)
      return { exercise, score, eligible: sameFamily || sameMuscle }
    })
    .filter((candidate) => candidate.eligible)
    .sort((a, b) => b.score - a.score || a.exercise.name.localeCompare(b.exercise.name))
    .slice(0, limit)
    .map((candidate) => candidate.exercise)
}
