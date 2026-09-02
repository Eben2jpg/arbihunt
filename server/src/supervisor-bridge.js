// Tiny indirection so the status route (and any other read-only
// consumer) can reach the supervisor without taking a direct import
// of index.js — which would create a circular import and pull the
// whole HTTP server into every module that wants the supervisor.
//
// Pattern: index.js calls setSupervisor(sup) once during boot. Any
// downstream module that needs the supervisor (status route,
// future diagnostic tools) calls getSupervisor() which returns the
// same instance or null if boot has not finished.

let _supervisor = null;

export function setSupervisor(sup) {
  _supervisor = sup;
}

export function getSupervisor() {
  return _supervisor;
}
