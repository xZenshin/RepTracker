import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, ApiError, utcOffsetMinutes } from './client'
import type {
  CalendarDay, Exercise, ExerciseListItem, ExerciseStats, Overview, Paged, RegisterResponse,
  Routine, SaveRoutineExercise, Units, User, Workout, WorkoutSet, WorkoutSummary,
} from './types'

export const keys = {
  me: ['me'] as const,
  exercises: ['exercises'] as const,
  routines: ['routines'] as const,
  routine: (id: string) => ['routines', id] as const,
  activeWorkout: ['workouts', 'active'] as const,
  workouts: ['workouts', 'history'] as const,
  workout: (id: string) => ['workouts', id] as const,
  overview: (weeks: number) => ['stats', 'overview', weeks] as const,
  calendar: ['stats', 'calendar'] as const,
  statExercises: ['stats', 'exercises'] as const,
  statExercise: (id: string, weeks: number) => ['stats', 'exercises', id, weeks] as const,
}

/**
 * Drops the signed-in user's cached data and publishes the signed-out state.
 *
 * The order is load-bearing. queryClient.clear() removes the query objects that mounted observers
 * are attached to, and those observers go on reading the removed entry - so the useMe() in App,
 * which decides whether to render the app at all, would never see the change and the user would
 * stay on a shell full of empty pages until a reload. Writing `me` first and removing only the
 * other keys leaves that observer attached to a live entry, so the login screen appears at once.
 */
export function signOut(qc: QueryClient) {
  qc.setQueryData(keys.me, null)
  qc.removeQueries({ predicate: (query) => query.queryKey[0] !== keys.me[0] })
}

/** Anything derived from logged sets is stale the moment a set changes. */
function invalidateTraining(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: ['workouts'] })
  void qc.invalidateQueries({ queryKey: ['stats'] })
}

// ---- session ----

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => {
      try {
        return await api<User>('/auth/me')
      } catch (error) {
        // Not being signed in is the normal first-visit state, so it resolves to null rather
        // than sitting in an error state that the router would have to special-case.
        if (error instanceof ApiError && error.status === 401) return null
        throw error
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  })
}

export function useRegister() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { displayName?: string; signupCode?: string }) =>
      api<RegisterResponse>('/auth/register', { method: 'POST', body }),
    onSuccess: (data) => qc.setQueryData(keys.me, data.user),
  })
}

export function useLogin() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (code: string) => api<User>('/auth/login', { method: 'POST', body: { code } }),
    onSuccess: (user) => {
      qc.setQueryData(keys.me, user)
      void qc.invalidateQueries()
    },
  })
}

export function useLogout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/logout', { method: 'POST' }),
    // Runs on failure too: if the call 401s the session was already gone, and staying "signed in"
    // against a dead session is the worse outcome either way.
    onSettled: () => signOut(qc),
  })
}

export function useUpdateMe() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { displayName?: string | null; units?: Units; bodyWeightKg?: number | null }) =>
      api<User>('/auth/me', { method: 'PATCH', body }),
    onSuccess: (user) => {
      qc.setQueryData(keys.me, user)
      // Bodyweight feeds volume and 1RM estimates for bodyweight movements, so stats must refetch.
      void qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export function useDeleteAccount() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api<void>('/auth/me', { method: 'DELETE' }),
    onSuccess: () => signOut(qc),
  })
}

// ---- exercises ----

export function useExercises() {
  return useQuery({
    queryKey: keys.exercises,
    queryFn: () => api<Exercise[]>('/exercises'),
    staleTime: 10 * 60_000,
  })
}

export function useCreateExercise() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: {
      name: string; muscleGroup: string; equipment: string; modality: string; pattern: string
    }) => api<Exercise>('/exercises', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.exercises }),
  })
}

// ---- routines ----

export function useRoutines() {
  return useQuery({ queryKey: keys.routines, queryFn: () => api<Routine[]>('/routines') })
}

export function useRoutine(id: string | undefined) {
  return useQuery({
    queryKey: keys.routine(id ?? ''),
    queryFn: () => api<Routine>(`/routines/${id}`),
    enabled: Boolean(id),
  })
}

interface SaveRoutineBody {
  name: string
  notes?: string | null
  exercises: SaveRoutineExercise[]
}

export function useSaveRoutine(id?: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveRoutineBody) =>
      id
        ? api<Routine>(`/routines/${id}`, { method: 'PUT', body })
        : api<Routine>('/routines', { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.routines }),
  })
}

export function useDeleteRoutine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/routines/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.routines }),
  })
}

// ---- workouts ----

export function useActiveWorkout() {
  return useQuery({
    queryKey: keys.activeWorkout,
    queryFn: () => api<Workout | null>('/workouts/active'),
  })
}

export function useWorkout(id: string | undefined) {
  return useQuery({
    queryKey: keys.workout(id ?? ''),
    queryFn: () => api<Workout>(`/workouts/${id}`),
    enabled: Boolean(id),
  })
}

export function useWorkoutHistory() {
  return useQuery({
    queryKey: keys.workouts,
    queryFn: () => api<Paged<WorkoutSummary>>('/workouts?limit=50'),
  })
}

export function useStartWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { routineId?: string; name?: string }) =>
      api<Workout>('/workouts', { method: 'POST', body }),
    onSuccess: (workout) => {
      qc.setQueryData(keys.activeWorkout, workout)
      invalidateTraining(qc)
    },
  })
}

export function useUpdateWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; notes?: string; finish?: boolean }) =>
      api<Workout>(`/workouts/${id}`, { method: 'PATCH', body }),
    onSuccess: (workout) => {
      qc.setQueryData(keys.activeWorkout, workout.finishedAt ? null : workout)
      invalidateTraining(qc)
    },
  })
}

export function useDeleteWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/workouts/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.setQueryData(keys.activeWorkout, null)
      invalidateTraining(qc)
    },
  })
}

export function useAddWorkoutExercise(workoutId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (exerciseId: string) =>
      api<Workout>(`/workouts/${workoutId}/exercises`, { method: 'POST', body: { exerciseId } }),
    onSuccess: (workout) => qc.setQueryData(keys.activeWorkout, workout),
  })
}

export function useRemoveWorkoutExercise(workoutId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (weId: string) =>
      api<void>(`/workouts/${workoutId}/exercises/${weId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.activeWorkout }),
  })
}

export function useUpdateWorkoutExercise(workoutId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ weId, ...body }: { weId: string; restSeconds?: number; notes?: string }) =>
      api<void>(`/workouts/${workoutId}/exercises/${weId}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.activeWorkout }),
  })
}

export interface SetInput {
  weightKg?: number | null
  reps?: number | null
  durationSeconds?: number | null
  distanceM?: number | null
  rpe?: number | null
  isWarmup?: boolean
  isCompleted?: boolean
}

export function useAddSet(workoutId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ weId, ...body }: SetInput & { weId: string }) =>
      api<WorkoutSet>(`/workouts/${workoutId}/exercises/${weId}/sets`, { method: 'POST', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.activeWorkout }),
  })
}

export function useUpdateSet(workoutId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ weId, setId, ...body }: SetInput & { weId: string; setId: string }) =>
      api<WorkoutSet>(`/workouts/${workoutId}/exercises/${weId}/sets/${setId}`, {
        method: 'PATCH',
        body,
      }),
    // Written straight into the cached workout rather than refetching: mid-set, a full round trip
    // plus reload makes the row flicker under your thumb.
    onSuccess: (updated, variables) => {
      qc.setQueryData<Workout | null>(keys.activeWorkout, (current) => {
        if (!current) return current
        return {
          ...current,
          exercises: current.exercises.map((we) =>
            we.id !== variables.weId
              ? we
              : { ...we, sets: we.sets.map((s) => (s.id === updated.id ? updated : s)) },
          ),
        }
      })
    },
  })
}

export function useDeleteSet(workoutId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ weId, setId }: { weId: string; setId: string }) =>
      api<void>(`/workouts/${workoutId}/exercises/${weId}/sets/${setId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.activeWorkout }),
  })
}

// ---- stats ----

export function useOverview(weeks: number) {
  return useQuery({
    queryKey: keys.overview(weeks),
    queryFn: () =>
      api<Overview>(`/stats/overview?weeks=${weeks}&offsetMinutes=${utcOffsetMinutes()}`),
  })
}

export function useCalendar() {
  return useQuery({
    queryKey: keys.calendar,
    queryFn: () => api<CalendarDay[]>(`/stats/calendar?weeks=53&offsetMinutes=${utcOffsetMinutes()}`),
  })
}

export function useStatExercises() {
  return useQuery({
    queryKey: keys.statExercises,
    queryFn: () => api<ExerciseListItem[]>('/stats/exercises'),
  })
}

export function useExerciseStats(id: string | undefined, weeks: number) {
  return useQuery({
    queryKey: keys.statExercise(id ?? '', weeks),
    queryFn: () =>
      api<ExerciseStats>(`/stats/exercises/${id}?weeks=${weeks}&offsetMinutes=${utcOffsetMinutes()}`),
    enabled: Boolean(id),
  })
}
