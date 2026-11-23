# Trend-rider — a cbBTC trading bot for the make.fun 24h race

An entry for make.fun's "Race a BTC trading bot live for 24 hours"
(btc-race-24h-20261123-0511): a bot that trades Coinbase Wrapped BTC
(cbBTC) against USDC, minute by minute, in a replay of its on-chain
prices, starting from 1,000 USDC of paper money.

## How it trades

One asset, long only, all-in or all-out — the race is ranked by net PnL
after a ~26 bps full-size round trip, so the bot trades as rarely as it
can and lets a confirmed trend do the work:

- **Entry** — the trailing 240-bar (4h) return is above +0.5% and the
  trailing 60-bar return is not negative: a trend that has already moved
  several times the round-trip cost, with the last hour not fighting it.
  No entries in the last 60 bars of the 1,440-bar window, and a 60-bar
  cooldown after every exit.
- **Exit** — the close falls 0.5% below the 360-bar exponential average
  (the trend broke, not a dip), or a hard stop 3% under the entry
  reference, whichever comes first.
- **Determinism** — signals come only from the bars' own closes: no
  clock, no randomness, no network, so two executions agree byte for
  byte.

On the published dev window (a +3.6% uptrend) the bot makes 2 trades
for +$10.50 net with a 1.9% maximum drawdown, against buy-and-hold's
+$32 with no protection at all: the gap is the price of never riding a
downtrend down.

## Layout

- `main.ts` — the bot (Node 22, runs through type stripping).
- `vendor/makefun-bars.ts` — the kit's bars-replay SDK shim, copied
  byte for byte.
- `LICENSE` — MIT.

## Run it

The grader runs `node /bot/main.ts` with this repository mounted at
`/bot`; the bot speaks agent-fun/bars-replay/v1 on stdin/stdout.
