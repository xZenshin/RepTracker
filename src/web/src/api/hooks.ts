import { keepPreviousData, queryOptions, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { api, ApiError, utcOffsetMinutes } from './client'
import type {
  CalendarDay, Exercise, ExerciseListItem, ExerciseStats, ImportSummary, MergeSummary, Overview, Paged, RegisterResponse,
  Routine, SaveRoutineExercise, Units, User, Workout, WorkoutSummary,
} from './types'
import type { LastTime, SaveWorkoutRequest } from '../lib/liveWorkout'

export const keys = {
  me: ['me'] as const,
  exercises: ['exercises'] as const,
  routines: ['routines'] as const,
  routine: (id: string) => ['routines', id] as const,
  lastTime: ['workouts', 'previous'] as const,
  workouts: ['workouts', 'history'] as const,
  workout: (id: string) => ['workouts', id] as const,
  overview: (weeks: number) => ['stats', 'overview', weeks] as const,
  calendar: (weeks: number) => ['stats', 'calendar', weeks] as const,
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
    mutationFn: (body: { displayName?: string }) =>
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
    mutationFn: (body: {
      displayName?: string | null
      units?: Units
      bodyWeightKg?: number | null
      /** 0 resets to the default for the user's units. */
      weightStepKg?: number
    }) =>
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

/**
 * What merging one exercise into another would do, for the confirmation step. Re-asked every time
 * the pair is chosen rather than cached: it describes the data as it stands now.
 */
export function useMergePreview(fromId: string | undefined, intoId: string | undefined) {
  return useQuery({
    // Not under ['exercises']: the merge refreshes that, and this preview of a pair that no longer
    // exists would be asked again on the way out.
    queryKey: ['merge-preview', fromId, intoId] as const,
    queryFn: () => api<MergeSummary>('/exercises/merge', { method: 'POST', body: { fromId, intoId } }),
    enabled: Boolean(fromId && intoId),
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })
}

/** Moves every set logged against `fromId` to `intoId`, and removes `fromId` from this account. */
export function useMergeExercises() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: { fromId: string; intoId: string }) =>
      api<MergeSummary>('/exercises/merge?commit=true', { method: 'POST', body }),
    onSuccess: () => {
      // History, stats, last time's sets, routines and the picker all name exercises.
      invalidateTraining(qc)
      void qc.invalidateQueries({ queryKey: keys.exercises })
      void qc.invalidateQueries({ queryKey: keys.routines })
    },
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

export function useWorkout(id: string | undefined) {
  return useQuery({
    queryKey: keys.workout(id ?? ''),
    queryFn: () => api<Workout>(`/workouts/${id}`),
    enabled: Boolean(id),
  })
}

/** The most recent finished workouts; older ones are reached through the calendar. */
export function useWorkoutHistory() {
  return useQuery({
    queryKey: keys.workouts,
    queryFn: () => api<Paged<WorkoutSummary>>(`/workouts?limit=${RECENT_WORKOUTS}`),
  })
}

export const RECENT_WORKOUTS = 20

/**
 * Every finished workout in one calendar month, `month` being local midnight on its first day.
 * The previous month stays on screen while the next one loads, so paging never flashes empty.
 */
export function useWorkoutMonth(month: Date) {
  const after = month.toISOString()
  const before = new Date(month.getFullYear(), month.getMonth() + 1, 1).toISOString()

  return useQuery({
    queryKey: ['workouts', 'month', after] as const,
    // 100 is the API's page ceiling, far above the two-a-day that would fill a month.
    queryFn: () =>
      api<Paged<WorkoutSummary>>(
        `/workouts?limit=100&after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}`,
      ),
    placeholderData: keepPreviousData,
  })
}

/**
 * Last time's sets for every exercise trained recently. A workout runs on the phone, so this is
 * fetched once when it starts and everything it lays out - a routine, an added exercise, a swap -
 * prefills from here without another request.
 */
export const lastTimeQuery = queryOptions({
  queryKey: keys.lastTime,
  queryFn: () => api<LastTime>('/workouts/previous'),
  staleTime: 5 * 60_000,
})

export function useLastTime() {
  return useQuery(lastTimeQuery)
}

/**
 * Sends a finished workout, whole. It is safe to retry - the workout carries its own id, and the
 * server hands back the stored one rather than saving it twice - so a dropped connection is retried
 * quietly before it is shown as an error. A refusal (4xx) is final and is not.
 *
 * Tried even when the phone reports no connection. The default would pause it until one returns,
 * leaving "Saving..." on screen with no word of why; failing says so, and Finish can be tapped again.
 */
export function useSaveWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: SaveWorkoutRequest) => api<Workout>('/workouts', { method: 'POST', body }),
    networkMode: 'always',
    retry: (failureCount, error) =>
      failureCount < 2 && !(error instanceof ApiError && error.status < 500),
    onSuccess: () => invalidateTraining(qc),
  })
}

export function useDeleteWorkout() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api<void>(`/workouts/${id}`, { method: 'DELETE' }),
    onSuccess: () => invalidateTraining(qc),
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

export function useCalendar(weeks: number) {
  return useQuery({
    queryKey: keys.calendar(weeks),
    queryFn: () => api<CalendarDay[]>(`/stats/calendar?weeks=${weeks}&offsetMinutes=${utcOffsetMinutes()}`),
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

// ---- import ----

/**
 * Sends a CSV of sets. `commit: false` only reports what would be imported; `commit: true` writes
 * it, all or nothing. Dates without a zone are read in the browser's named time zone.
 */
export function useImportWorkouts() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ csv, commit }: { csv: string; commit: boolean }) => {
      const zone = encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone ?? '')
      return api<ImportSummary>(
        `/import/workouts?commit=${commit}&timeZone=${zone}&offsetMinutes=${utcOffsetMinutes()}`,
        { method: 'POST', raw: { content: csv, type: 'text/csv' } },
      )
    },
    onSuccess: (summary) => {
      if (!summary.committed) return
      invalidateTraining(qc)
      // New custom exercises appear in the picker.
      void qc.invalidateQueries({ queryKey: keys.exercises })
    },
  })
}
