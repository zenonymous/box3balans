# No connections that log in to brokers without an official API

_Nederlands: [0005-geen-inlog-koppelingen.md](../../adr/0005-geen-inlog-koppelingen.md)_

Connections only use a key or token with read permissions, as with Bitvavo, Kraken, Coinbase and Interactive Brokers' Flex Web Service. For a broker without an official API, such as DEGIRO, Box3balans would have to log in with your password: that gives full trading rights, DEGIRO's client agreement forbids scripts and sharing login details (art. 5.6 and 7.2.1), and the unofficial API has broken at least six times since 2022. Such brokers are read in through their exports. The research is in [degiro-koppeling.md](../degiro-koppeling.md).

## Considered

- **Logging in with the password each time, without storing it:** at most as an experiment; it saves two downloads a year against the risks above.
- **An aggregator such as SnapTrade:** read-only, but your password then sits with a third party, which art. 7.2.1 explicitly forbids.
