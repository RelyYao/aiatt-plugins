// SPDX-License-Identifier: Apache-2.0
/// <reference types="@aiatt/plugin-sdk" />
// __NAME__ (room-plugin@1, an activity: it runs as long as the room exists and never "finishes").
// Everyone seated may act at any time (no turns); the room's host may also reset the wall (hostActions).
// Not allowed here: process, timers, Date, Math.random, eval, network, files. Time is ctx.now.
const EMOJIS = ['clap', 'fire', 'heart'];

module.exports = definePlugin({
  setup({ seats, now }) {
    return { seats: seats.map(seat => seat.id), counts: { clap: 0, fire: 0, heart: 0 }, byWho: {}, since: now };
  },
  // Every seat can cheer whenever it likes; deadlineAt: null means the decision never times out.
  decisions(state) { return state.seats.map(seat => ({ actor: seat, actions: ['cheer'], deadlineAt: null })); },
  apply(state, action, { actor, host, now }) {
    if (action.type === 'reset') {
      if (!host) return { error: 'HOST_ONLY', status: 403, message: 'Only the room host can reset the wall' };
      return { state: { ...state, counts: { clap: 0, fire: 0, heart: 0 }, byWho: {}, since: now }, events: [{ type: 'reset' }] };
    }
    if (!EMOJIS.includes(action.emoji)) return { error: 'BAD_EMOJI', status: 400 };
    const counts = { ...state.counts, [action.emoji]: state.counts[action.emoji] + 1 };
    return { state: { ...state, counts, byWho: { ...state.byWho, [actor]: (state.byWho[actor] || 0) + 1 } }, events: [{ type: 'cheered', actor, emoji: action.emoji }] };
  },
  view(state, viewer) { return { counts: state.counts, yours: viewer ? state.byWho[viewer] || 0 : null, since: state.since }; },
  result() { return { done: false }; },
});
