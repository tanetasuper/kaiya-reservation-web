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
  getCustomerProfile: (lineUserId) =>
    get('getCustomerProfile', { lineUserId }),
  getMyReservations: (lineUserId) =>
    get('myReservations', { lineUserId }),

  // Customer writes
  createReservation: (data) => post('createReservation', { data }),
  changeReservation: (data) => post('changeReservation', { data }),
  cancelReservation: (data) => post('cancelReservation', { data }),

  // Admin - reservations
  adminAuth: (password) => post('adminAuth', { password }),
  adminGetReservations: (password, filter) =>
    post('adminGetReservations', { password, filter }),
  adminAddReservation: (password, data) =>
    post('adminAddReservation', { password, data }),
  adminUpdateReservation: (password, data) =>
    post('adminUpdateReservation', { password, data }),
  adminDeleteReservation: (password, id) =>
    post('adminDeleteReservation', { password, id }),

  // Admin - blocked dates
  adminGetBlockedDates: (password) =>
    post('adminGetBlockedDates', { password }),
  adminSetBlockedDate: (password, date, reason) =>
    post('adminSetBlockedDate', { password, date, reason }),
  adminRemoveBlockedDate: (password, date) =>
    post('adminRemoveBlockedDate', { password, date }),

  // Admin - seat blocks
  adminGetSeatBlocks: (password) =>
    post('adminGetSeatBlocks', { password }),
  adminSetSeatBlock: (password, date, blockedSeats, reason) =>
    post('adminSetSeatBlock', { password, date, blockedSeats, reason }),
  adminRemoveSeatBlock: (password, date) =>
    post('adminRemoveSeatBlock', { password, date }),

  // Admin - notifications
  adminGetNotifications: (password) =>
    post('adminGetNotifications', { password }),
  adminMarkNotificationRead: (password, id) =>
    post('adminMarkNotificationRead', { password, id }),

  // Settings
  getSettings: () =>
    get('getSettings'),
  saveSettings: (password, settings) =>
    post('saveSettings', { password, settings }),
}
