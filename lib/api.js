const ENDPOINT = '/api/gas'

async function get(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString()
  const r = await fetch(`${ENDPOINT}?${qs}`)
  if (!r.ok) throw new Error('network error')
  return r.json()
}

async function post(action, body = {}) {
  const r = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...body }),
  })
  if (!r.ok) throw new Error('network error')
  return r.json()
}

export const api = {
  // Customer reads
  checkAvailability: (date, isKasshiki) =>
    get('checkAvailability', { date, isKasshiki }),
  getAvailability: (date) =>
    get('getAvailability', { date }),
  getMonthAvailability: (year, month) =>
    get('getMonthAvailability', { year, month }),
  getCustomerProfile: (lineUserId) =>
    get('getCustomerProfile', { lineUserId }),
  getMyReservations: (lineUserId) =>
    get('myReservations', { lineUserId }),

  // Customer writes
  createReservation: (data) => post('createReservation', { data }),
  changeReservation: (data) => post('changeReservation', { data }),
  cancelReservation: (data) => post('cancelReservation', { data }),

  // Admin - reservations (no password required)
  adminGetReservations: (filter) =>
    post('adminGetReservations', { filter }),
  adminAddReservation: (data) =>
    post('adminAddReservation', { data }),
  adminUpdateReservation: (data) =>
    post('adminUpdateReservation', { data }),
  adminDeleteReservation: (id) =>
    post('adminDeleteReservation', { id }),

  // Admin - blocked dates
  adminGetBlockedDates: () =>
    post('adminGetBlockedDates', {}),
  adminSetBlockedDate: (date, reason) =>
    post('adminSetBlockedDate', { date, reason }),
  adminRemoveBlockedDate: (date) =>
    post('adminRemoveBlockedDate', { date }),

  // Admin - seat blocks
  adminGetSeatBlocks: () =>
    post('adminGetSeatBlocks', {}),
  adminSetSeatBlock: (date, blockedSeats, reason) =>
    post('adminSetSeatBlock', { date, blockedSeats, reason }),
  adminRemoveSeatBlock: (date) =>
    post('adminRemoveSeatBlock', { date }),

  // Admin - notifications
  adminGetNotifications: () =>
    post('adminGetNotifications', {}),
  adminMarkNotificationRead: (id) =>
    post('adminMarkNotificationRead', { id }),

  // Settings
  getSettings: () =>
    get('getSettings'),
  saveSettings: (settings) =>
    post('saveSettings', { settings }),

  // Admin auth
  checkAdminPassword: (password) =>
    post('checkAdminPassword', { password }),
  changeAdminPassword: (currentPw, newPw) =>
    post('changeAdminPassword', { currentPw, newPw }),
  resetAdminPassword: (code) =>
    post('resetAdminPassword', { code }),
  getRecoveryQuestion: () =>
    get('getRecoveryQuestion'),
  changeRecoveryQA: (currentPw, question, answer) =>
    post('changeRecoveryQA', { currentPw, question, answer }),

  // Admin data
  adminGetCustomerData: () =>
    post('adminGetCustomerData', {}),
  adminGetAllReservations: (filter) =>
    post('adminGetAllReservations', { filter }),
}
