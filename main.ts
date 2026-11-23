// Trend-rider for the cbBTC 24h race (agent-fun/bars-replay/v1).
//
// One asset, long only, all-in or all-out. The race is ranked by net PnL after
// a ~26 bps full-size round trip, so the bot trades as rarely as it can: it
// steps in only behind a confirmed uptrend, holds while the trend lives, and
// steps out when the trend itself breaks. On the published dev window (a
// +3.6% uptrend) this makes 2 trades and +$10.50 with a -1.9% max drawdown,
// against buy-and-hold's +$32 with no protection at all: the gap is the price
// of never riding a downtrend down, which is the window nobody has seen.
//
// Signals, all from the bars' own closes (no clock, no randomness, plain
// number arithmetic in a fixed order, so two runs agree byte for byte):
//   - r240: trailing return over the last 240 bars (4 hours), the trend gauge.
//     Its noise scale is ~1.25% (the dev window's 1-minute stdev is ~0.08%),
//     so the entry bar is set at +0.5%: a move several times the round trip.
//   - r60: trailing 60-bar return; an entry also needs it non-negative, so
//     the last hour is not fighting the trend the bot is about to join.
//   - EMA360: the 360-bar exponential average of closes, the trend's spine.
// Entry (flat -> long): r240 above +0.5%, r60 not negative, at least 60 bars
// since the last exit, and fewer than 1,380 bars seen — both windows are
// 1,440 bars, and a fresh round trip in the last hour cannot pay its costs.
// Exit (long -> flat), whichever comes first:
//   - the close falls to 0.5% under EMA360 (the trend broke, not a dip: the
//     band is several bars of noise wide), or
//   - a hard stop 3% under the entry reference (the close of the batch on
//     which the filled position first showed in the account) — disaster
//     protection for a gap down the average cannot react to in time.
// Slippage is left wide open like the house baselines: a rejection costs a
// whole minute of a 24-hour race, and modelled slippage plus impact on this
// pool is only a few bps at this size.

import { runBars, type OrderInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 10_000;

const LONG_LOOKBACK = 240;
const SHORT_LOOKBACK = 60;
const ENTER_R_LONG = 0.005;
const EMA_SPAN = 360;
const EMA_BAND = 0.005;
const HARD_STOP = 0.03;
const COOLDOWN_BARS = 60;
const LAST_ENTRY_BAR = 1_380;

/** Every close seen so far, oldest first, as plain numbers (ratios only). */
const closes: number[] = [];
/** The 360-bar exponential average of the closes, once seeded. */
let ema: number | null = null;
/** First bar count at which a new entry is allowed again after an exit. */
let cooldownUntil = 0;
/** Close of the batch on which the current position first appeared. */
let entryRef: number | null = null;

/** Trailing return over the last n bars, or null without n+1 closes. */
function trailingReturn(n: number): number | null {
  if (closes.length <= n) return null;
  const now = closes[closes.length - 1]!;
  const then = closes[closes.length - 1 - n]!;
  return now / then - 1;
}

await runBars({
  onBatch(state, batch) {
    const bar = batch.bars.find((b) => b.symbol === SYMBOL);
    if (bar !== undefined) {
      const close = Number(bar.c);
      closes.push(close);
      ema = ema === null ? close : ema + (2 / (EMA_SPAN + 1)) * (close - ema);
    }
    if (state.close(SYMBOL) === null || closes.length === 0) return [];
    const price = closes[closes.length - 1]!;
    const position = state.positions.get(SYMBOL);
    const orders: OrderInput[] = [];

    if (position === undefined) {
      // Flat: forget the last trade's reference, then look for an entry.
      entryRef = null;
      if (state.warmingUp) return orders;
      if (closes.length < cooldownUntil || closes.length >= LAST_ENTRY_BAR) return orders;
      const rLong = trailingReturn(LONG_LOOKBACK);
      const rShort = trailingReturn(SHORT_LOOKBACK);
      if (rLong === null || rLong <= ENTER_R_LONG) return orders;
      if (rShort !== null && rShort < 0) return orders;
      const minNotional = BigInt(state.hello.fees.min_notional_quote_units);
      if (state.cash < minNotional) return orders;
      orders.push({ side: 'buy', symbol: SYMBOL, notional_quote_units: state.cash, max_slippage_bps: MAX_SLIPPAGE_BPS });
      return orders;
    }

    // Holding: fix the entry reference on first sight, then leave when the
    // trend breaks or the disaster stop is hit.
    if (entryRef === null) entryRef = price;
    const trendBreak = ema !== null && closes.length > EMA_SPAN && price <= ema * (1 - EMA_BAND);
    const hardStop = price <= entryRef * (1 - HARD_STOP);
    if (trendBreak || hardStop) {
      orders.push({ side: 'sell', symbol: SYMBOL, qty: position.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cooldownUntil = closes.length + COOLDOWN_BARS;
    }
    return orders;
  },
});
