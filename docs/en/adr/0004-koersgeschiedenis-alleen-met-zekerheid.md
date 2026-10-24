# Price history from a source only when it's certain to be the same coin

_Nederlands: [0004-koersgeschiedenis-alleen-met-zekerheid.md](../../adr/0004-koersgeschiedenis-alleen-met-zekerheid.md)_

The same ticker symbol sometimes belongs to a different coin on different exchanges or in different years. A wrong price on 31 December makes box 3 wrong without anyone noticing; a missing price stands out. A second source (Yahoo or Binance) is therefore only used when your own transactions confirm it's the same coin, and a swapped coin only follows a successor with a known, fixed swap ratio. If that can't be established, the price stays empty and the coin is listed under _Needs attention_, instead of a guess.
