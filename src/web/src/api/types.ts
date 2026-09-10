/** Mirrors the DTOs in RepTracker.Api/Endpoints/Dtos.cs and Stats/StatsDtos.cs. */

export type Modality = 'WeightReps' | 'BodyweightReps' | 'Duration' | 'DistanceDuration'
export type Units = 'kg' | 'lb'

export interface User {
  id: string
  displayName?: string | null
  units: Units
  bodyWeightKg?: number | null
  createdAt: string
}

export interface RegisterResponse {
  loginCode: string
  formatted: string
  user: User
}

export interface Exercise {
  id: string
  name: string
  muscleGroup: string
  equipment: string
  modality: Modality
  pattern: string
  isCustom: boolean
  isArchived: boolean
}

export interface RoutineExercise {
  id: string
  exerciseId: string
  exerciseName: string
  muscleGroup: string
  modality: Modality
  position: number
  targetSets: number
  targetRepsMin?: number | null
  targetRepsMax?: number | null
  targetWeightKg?: number | null
  restSeconds: number
  notes?: string | null
}

export interface Routine {
  id: string
  name: string
  notes?: string | null
  isArchived: boolean
  updatedAt: string
  exercises: RoutineExercise[]
}

export interface SaveRoutineExercise {
  exerciseId: string
  targetSets: number
  targetRepsMin?: number | null
  targetRepsMax?: number | null
  targetWeightKg?: number | null
  restSeconds: number
  notes?: string | null
}

export interface WorkoutSet {
  id: string
  position: number
  weightKg?: number | null
  reps?: number | null
  durationSeconds?: number | null
  distanceM?: number | null
  rpe?: number | null
  isWarmup: boolean
  isCompleted: boolean
  completedAt?: string | null
}

export interface PreviousSet {
  weightKg?: number | null
  reps?: number | null
  durationSeconds?: number | null
  distanceM?: number | null
  isWarmup: boolean
}

export interface PreviousPerformance {
  performedAt: string
  sets: PreviousSet[]
}

export interface WorkoutExercise {
  id: string
  exerciseId: string
  exerciseName: string
  muscleGroup: string
  equipment: string
  modality: Modality
  position: number
  restSeconds: number
  notes?: string | null
  sets: WorkoutSet[]
  previous?: PreviousPerformance | null
}

export interface WorkoutTotals {
  volumeKg: number
  sets: number
  reps: number
  durationSeconds?: number | null
}

export interface Workout {
  id: string
  name: string
  notes?: string | null
  startedAt: string
  finishedAt?: string | null
  routineId?: string | null
  routineName?: string | null
  totals: WorkoutTotals
  exercises: WorkoutExercise[]
}

export interface WorkoutSummary {
  id: string
  name: string
  startedAt: string
  finishedAt?: string | null
  routineName?: string | null
  volumeKg: number
  sets: number
  exercises: number
  durationSeconds?: number | null
  muscleGroups: string[]
}

export interface Paged<T> {
  items: T[]
  nextCursor?: string | null
}

// ---- stats ----

export interface PeriodTotals {
  workouts: number
  volumeKg: number
  sets: number
  reps: number
  durationSeconds: number
  avgWorkoutsPerWeek: number
}

export interface Consistency {
  currentWeekStreak: number
  longestWeekStreak: number
  workoutsThisWeek: number
  activeWeeks: number
  totalWorkouts: number
}

export interface WeekPoint {
  weekStart: string
  workouts: number
  volumeKg: number
  sets: number
  durationSeconds: number
  volumeRolling4W: number
}

export type MuscleVerdict = 'untrained' | 'low' | 'on target' | 'high'

export interface MuscleGroupLoad {
  muscleGroup: string
  sets: number
  volumeKg: number
  setsPerWeek: number
  verdict: MuscleVerdict
}

export interface Balance {
  pushSets: number
  pullSets: number
  legSets: number
  coreSets: number
  cardioSets: number
  pushPullRatio?: number | null
  upperLowerRatio?: number | null
}

export interface PersonalRecord {
  exerciseId: string
  exerciseName: string
  achievedAt: string
  estimatedOneRepMax: number
  weightKg: number
  reps: number
  previousBest?: number | null
}

export interface Stalling {
  exerciseId: string
  exerciseName: string
  bestOneRepMax: number
  bestAchievedAt: string
  weeksSinceBest: number
  sessionsSinceBest: number
}

export interface Neglected {
  exerciseId: string
  exerciseName: string
  lastPerformedAt: string
  daysSince: number
  source: string
}

export interface Overview {
  totals: PeriodTotals
  consistency: Consistency
  weekly: WeekPoint[]
  muscleGroups: MuscleGroupLoad[]
  balance: Balance
  recentRecords: PersonalRecord[]
  stalling: Stalling[]
  neglected: Neglected[]
}

export interface CalendarDay {
  date: string
  workouts: number
  volumeKg: number
  sets: number
}

export interface ExerciseListItem {
  id: string
  name: string
  muscleGroup: string
  modality: Modality
  sessions: number
  lastPerformedAt?: string | null
  bestOneRepMax?: number | null
  bestWeightKg?: number | null
}

export interface ExerciseSessionPoint {
  workoutId: string
  date: string
  estimatedOneRepMax?: number | null
  topSetWeightKg?: number | null
  topSetReps?: number | null
  volumeKg: number
  sets: number
  reps: number
  isRecord: boolean
}

export interface RepRecord {
  weightKg: number
  reps: number
  achievedAt: string
}

export interface ExerciseRecords {
  bestOneRepMax?: number | null
  bestOneRepMaxAt?: string | null
  bestWeightKg?: number | null
  bestWeightReps?: number | null
  bestWeightAt?: string | null
  bestSessionVolumeKg?: number | null
  bestSessionVolumeAt?: string | null
  bestRepsByWeight: RepRecord[]
}

export interface Trend {
  changePercent?: number | null
  recentAvg?: number | null
  earlierAvg?: number | null
  direction: 'improving' | 'holding' | 'declining' | 'insufficient data'
}

export interface ExerciseStats {
  exerciseId: string
  exerciseName: string
  muscleGroup: string
  modality: Modality
  sessions: ExerciseSessionPoint[]
  records: ExerciseRecords
  trend: Trend
}
