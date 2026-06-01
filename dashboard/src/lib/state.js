// Shared mutable dashboard state.
//
// ES modules can't reassign an imported binding, so cross-module mutable state
// lives on this single object: write `state.currentPanel = x` (property
// assignment), never `currentPanel = x` (binding reassignment). Read-only
// shared values (API base, auth token) live in lib/api.js instead.
export const state = {
  currentPanel: 'home',
  projectFilter: 'all',
  allProjects: [],
  allPersonas: [],
  allTemplates: [],
  chatWaiting: false,
  statusPollTimer: null,
  projectPollTimer: null,
  currentDetailProject: null,
  idleTasksCache: [],
};
