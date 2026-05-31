import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ethers } from 'ethers';
import { Activity, ArrowUpRight, CheckCircle2, ChevronRight, Clock, Coins, ExternalLink, Loader2, ShieldCheck, Sparkles, TrendingUp, Wallet, XCircle } from 'lucide-react';
import './styles.css';
import logo from './logo.jpg';

declare global {
  interface Window {
    ethereum?: any;
  }
}

const ENV = {
  contractAddress: import.meta.env.VITE_QAST_CONTRACT_ADDRESS || '0x669fa07b8518d27b5F0286b78868505300eE6224',
  chainId: Number(import.meta.env.VITE_QIE_CHAIN_ID || '1990'),
  chainName: import.meta.env.VITE_QIE_CHAIN_NAME || 'QIEMainnet',
  rpcUrl: import.meta.env.VITE_QIE_RPC_URL || 'https://rpc1mainnet.qie.digital/',
  explorerUrl: (import.meta.env.VITE_QIE_EXPLORER_URL || 'https://mainnet.qie.digital').replace(/\/$/, ''),
  symbol: import.meta.env.VITE_QIE_NATIVE_SYMBOL || 'QIEV3',
  faucetUrl: import.meta.env.VITE_FAUCET_URL || 'https://q-faucet-ymmi.vercel.app/',
  adminAddress: (import.meta.env.VITE_ADMIN_ADDRESS || '0xb7f85bf000d0a37fc881bf5f1d80469f749fad98').toLowerCase(),
  treasuryAddress: import.meta.env.VITE_TREASURY_ADDRESS || '0x00e348677ae2b11a48fbe1bf452133c51ba833c3',
};

const QAST_ABI = [
  'function owner() view returns (address)',
  'function treasury() view returns (address)',
  'function marketCount() view returns (uint256)',
  'function markets(uint256 marketId) view returns (string question,string category,uint256 endTime,bool resolved,bool outcome,uint256 totalYesAmount,uint256 totalNoAmount)',
  'function getUserBet(uint256 marketId,address user) view returns (uint256 yesBet,uint256 noBet)',
  'function claimed(uint256 marketId,address user) view returns (bool)',
  'function createMarket(string question,string category,uint256 endTime) returns (uint256)',
  'function betYes(uint256 marketId) payable',
  'function betNo(uint256 marketId) payable',
  'function resolveMarket(uint256 marketId,bool outcome)',
  'function claimWinnings(uint256 marketId)',
  'event MarketCreated(uint256 indexed marketId,string question,string category,uint256 endTime)',
  'event BetPlaced(uint256 indexed marketId,address indexed user,bool side,uint256 amount)',
  'event MarketResolved(uint256 indexed marketId,bool outcome)',
  'event WinningsClaimed(uint256 indexed marketId,address indexed user,uint256 amount)',
];

type Market = {
  id: number;
  question: string;
  category: string;
  endTime: number;
  resolved: boolean;
  outcome: boolean;
  totalYesAmount: bigint;
  totalNoAmount: bigint;
  userYes?: bigint;
  userNo?: bigint;
  claimed?: boolean;
};

type TxState = 'idle' | 'confirming' | 'submitted' | 'confirmed' | 'failed';

const categories = ['QIE Ecosystem', 'Crypto', 'Sports', 'Business', 'Politics', 'Entertainment'];

function formatQie(value?: bigint) {
  if (!value) return '0';
  const formatted = ethers.formatEther(value);
  const n = Number(formatted);
  if (!Number.isFinite(n)) return formatted;
  if (n === 0) return '0';
  if (n < 0.0001) return '<0.0001';
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function pct(part: bigint, total: bigint) {
  if (total === 0n) return 50;
  return Math.round(Number((part * 10000n) / total) / 100);
}

function short(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeLeft(endTime: number) {
  const diff = endTime * 1000 - Date.now();
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

function StatusBanner({ state, txHash, error }: { state: TxState; txHash?: string; error?: string }) {
  if (state === 'idle') return null;
  const map = {
    confirming: { icon: <Loader2 className="spin" />, text: 'Waiting for wallet confirmation…' },
    submitted: { icon: <Loader2 className="spin" />, text: 'Transaction submitted. Waiting for confirmation…' },
    confirmed: { icon: <CheckCircle2 />, text: 'Transaction confirmed.' },
    failed: { icon: <XCircle />, text: error || 'Transaction failed.' },
  } as const;
  const item = map[state];
  return (
    <div className={`tx tx-${state}`}>
      {item.icon}
      <span>{item.text}</span>
      {txHash && (
        <a href={`${ENV.explorerUrl}/tx/${txHash}`} target="_blank" rel="noreferrer">
          View on explorer <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

function App() {
  const [account, setAccount] = useState('');
  const [chainId, setChainId] = useState<number | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [owner, setOwner] = useState('');
  const [txState, setTxState] = useState<TxState>('idle');
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  const [betAmount, setBetAmount] = useState('0.001');
  const [createForm, setCreateForm] = useState({ question: '', category: 'QIE Ecosystem', minutes: '60' });

  const provider = useMemo(() => new ethers.JsonRpcProvider(ENV.rpcUrl), []);
  const readContract = useMemo(() => new ethers.Contract(ENV.contractAddress, QAST_ABI, provider), [provider]);
  const isRightNetwork = chainId === ENV.chainId;
  const isAdmin = !!account && (account.toLowerCase() === owner.toLowerCase() || account.toLowerCase() === ENV.adminAddress);
  const selectedMarket = selectedId === null ? null : markets.find((m) => m.id === selectedId) || null;
  const totalVolume = useMemo(() => markets.reduce((acc, m) => acc + m.totalYesAmount + m.totalNoAmount, 0n), [markets]);
  const liveMarkets = useMemo(() => markets.filter((m) => !m.resolved && m.endTime * 1000 > Date.now()).length, [markets]);

  const getBrowserContract = async () => {
    if (!window.ethereum) throw new Error('MetaMask or an injected wallet is required.');
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    const signer = await browserProvider.getSigner();
    return new ethers.Contract(ENV.contractAddress, QAST_ABI, signer);
  };

  const refreshAccount = useCallback(async () => {
    if (!window.ethereum) return;
    const accounts = await window.ethereum.request({ method: 'eth_accounts' });
    setAccount(accounts?.[0] || '');
    const currentChain = await window.ethereum.request({ method: 'eth_chainId' });
    setChainId(Number(currentChain));
  }, []);

  const connectWallet = async () => {
    setError('');
    if (!window.ethereum) {
      setError('Install MetaMask or another EVM wallet first.');
      return;
    }
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    setAccount(accounts?.[0] || '');
    await refreshAccount();
  };

  const switchNetwork = async () => {
    if (!window.ethereum) return;
    const hexChainId = `0x${ENV.chainId.toString(16)}`;
    try {
      await window.ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: hexChainId }] });
    } catch (switchError: any) {
      if (switchError?.code === 4902) {
        await window.ethereum.request({
          method: 'wallet_addEthereumChain',
          params: [
            {
              chainId: hexChainId,
              chainName: ENV.chainName,
              nativeCurrency: { name: ENV.symbol, symbol: ENV.symbol, decimals: 18 },
              rpcUrls: [ENV.rpcUrl],
              blockExplorerUrls: [ENV.explorerUrl],
            },
          ],
        });
      } else {
        throw switchError;
      }
    }
    await refreshAccount();
  };

  const loadMarkets = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let contractOwner = ENV.adminAddress;
      try {
        contractOwner = await readContract.owner();
      } catch {
        contractOwner = ENV.adminAddress;
      }
      setOwner(contractOwner);

      const countRaw = await readContract.marketCount();
      const count = Number(countRaw);
      const rows: Market[] = [];

      for (let i = 1; i <= count; i++) {
        try {
          const m = await readContract.markets(i);
          const item: Market = {
            id: i,
            question: m.question ?? m[0],
            category: m.category ?? m[1],
            endTime: Number(m.endTime ?? m[2]),
            resolved: Boolean(m.resolved ?? m[3]),
            outcome: Boolean(m.outcome ?? m[4]),
            totalYesAmount: BigInt(m.totalYesAmount ?? m[5] ?? 0),
            totalNoAmount: BigInt(m.totalNoAmount ?? m[6] ?? 0),
          };
          if (account) {
            const [bets, didClaim] = await Promise.all([
              readContract.getUserBet(i, account),
              readContract.claimed(i, account),
            ]);
            item.userYes = BigInt(bets.yesBet ?? bets[0] ?? 0);
            item.userNo = BigInt(bets.noBet ?? bets[1] ?? 0);
            item.claimed = Boolean(didClaim);
          }
          rows.push(item);
        } catch (marketError) {
          console.error(`[Qast] Failed loading market ${i}`, marketError);
        }
      }

      const sorted = rows.sort((a, b) => b.id - a.id);
      setMarkets(sorted);
      if (sorted.length > 0 && (selectedId === null || !sorted.some((m) => m.id === selectedId))) {
        setSelectedId(sorted[0].id);
      }
      if (selectedId !== null && !sorted.some((m) => m.id === selectedId)) setSelectedId(null);
    } catch (e: any) {
      setError(e?.shortMessage || e?.message || 'Could not load on-chain markets.');
    } finally {
      setLoading(false);
    }
  }, [readContract, account, selectedId]);

  useEffect(() => {
    refreshAccount();
    if (window.ethereum) {
      window.ethereum.on?.('accountsChanged', refreshAccount);
      window.ethereum.on?.('chainChanged', refreshAccount);
    }
    return () => {
      window.ethereum?.removeListener?.('accountsChanged', refreshAccount);
      window.ethereum?.removeListener?.('chainChanged', refreshAccount);
    };
  }, [refreshAccount]);

  useEffect(() => {
    loadMarkets();
  }, [loadMarkets]);

  const runTx = async (fn: () => Promise<any>) => {
    setTxState('confirming');
    setTxHash('');
    setError('');
    try {
      if (!account) await connectWallet();
      if (!isRightNetwork) await switchNetwork();
      const tx = await fn();
      setTxState('submitted');
      setTxHash(tx.hash);
      await tx.wait();
      setTxState('confirmed');
      await loadMarkets();
    } catch (e: any) {
      setTxState('failed');
      setError(e?.shortMessage || e?.reason || e?.message || 'Transaction failed.');
    }
  };

  const bet = async (marketId: number, side: 'yes' | 'no') => {
    await runTx(async () => {
      const contract = await getBrowserContract();
      const value = ethers.parseEther(betAmount || '0');
      if (value <= 0n) throw new Error('Enter a valid QIE amount.');
      return side === 'yes' ? contract.betYes(marketId, { value }) : contract.betNo(marketId, { value });
    });
  };

  const claim = async (marketId: number) => {
    await runTx(async () => {
      const contract = await getBrowserContract();
      return contract.claimWinnings(marketId);
    });
  };

  const resolve = async (marketId: number, outcome: boolean) => {
    await runTx(async () => {
      const contract = await getBrowserContract();
      return contract.resolveMarket(marketId, outcome);
    });
  };

  const createMarket = async (e: React.FormEvent) => {
    e.preventDefault();
    await runTx(async () => {
      const contract = await getBrowserContract();
      const minutes = Math.max(1, Number(createForm.minutes || '60'));
      const endTime = Math.floor(Date.now() / 1000) + minutes * 60;
      return contract.createMarket(createForm.question.trim(), createForm.category, endTime);
    });
  };

  const filteredMarkets = markets.filter((m) => {
    const matchesSearch = m.question.toLowerCase().includes(search.toLowerCase()) || m.category.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === 'All' || m.category === category;
    return matchesSearch && matchesCategory;
  });

  return (
    <main className="shell">
      <div className="ambient ambient-1" />
      <div className="ambient ambient-2" />
      <header className="hero">
        <nav className="topbar">
          <div className="brand-wrap">
            <div className="brand-mark"><img src={logo} alt="Qast logo" /></div>
            <div className="brand-copy">
              <div className="brand">Qast</div>
              <span>Prediction markets on QIE mainnet</span>
            </div>
          </div>
          <div className="actions">
            <a className="ghost" href={ENV.faucetUrl} target="_blank" rel="noreferrer">Claim faucet <ArrowUpRight size={16} /></a>
            {account ? <button className="wallet">{short(account)}</button> : <button onClick={connectWallet} className="wallet"><Wallet size={16} /> Connect wallet</button>}
          </div>
        </nav>

        <section className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow"><Sparkles size={16} /> Built for crisp, real-money price discovery on QIE</p>
            <h1>Beautiful prediction markets. Native QIE liquidity. Zero fluff.</h1>
            <p className="subtitle">A premium, admin-curated market layer for the QIE ecosystem. Create markets, trade yes or no with {ENV.symbol}, and settle outcomes fully on-chain.</p>
            <div className="hero-actions">
              {!account && <button onClick={connectWallet}>Connect wallet</button>}
              {account && !isRightNetwork && <button onClick={switchNetwork}>Switch to QIE Mainnet</button>}
              <button className="secondary" onClick={loadMarkets}>Refresh markets</button>
            </div>
            <div className="hero-metrics">
              <div>
                <span>Total volume</span>
                <strong>{formatQie(totalVolume)} {ENV.symbol}</strong>
              </div>
              <div>
                <span>Live markets</span>
                <strong>{liveMarkets}</strong>
              </div>
              <div>
                <span>Contract</span>
                <strong>{short(ENV.contractAddress)}</strong>
              </div>
            </div>
          </div>

          <div className="hero-rail panel premium-panel">
            <div className="rail-head">
              <span className="badge badge-live"><Activity size={14} /> QIE mainnet live</span>
              <a href={`${ENV.explorerUrl}/address/${ENV.contractAddress}`} target="_blank" rel="noreferrer">View contract <ExternalLink size={14} /></a>
            </div>
            <div className="rail-stack">
              <div className="rail-card">
                <span>Contract address</span>
                <strong>{short(ENV.contractAddress)}</strong>
              </div>
              <div className="rail-grid">
                <div className="rail-card small"><span>Markets</span><strong>{markets.length}</strong></div>
                <div className="rail-card small"><span>Token</span><strong>{ENV.symbol}</strong></div>
                <div className="rail-card small"><span>Admin</span><strong>{short(owner || ENV.adminAddress)}</strong></div>
                <div className="rail-card small"><span>Treasury</span><strong>{short(ENV.treasuryAddress)}</strong></div>
              </div>
              <div className="quote-block">
                <TrendingUp size={16} /> Sharper design. Clearer markets. A product that looks like it belongs in the top tier.
              </div>
            </div>
          </div>
        </section>
      </header>

      <StatusBanner state={txState} txHash={txHash} error={error} />
      {error && txState === 'idle' && <div className="tx tx-failed"><XCircle /> {error}</div>}

      <section className="notice premium-panel">
        <Coins /> Need QIE for testing? Claim 0.01 QIE every 24 hours from the QIE Faucet.
        <a href={ENV.faucetUrl} target="_blank" rel="noreferrer">Open faucet <ChevronRight size={14} /></a>
      </section>

      <section className="panel admin-panel premium-panel">
        <div className="panel-title">
          <div><ShieldCheck /> Admin market creation</div>
          <small>{isAdmin ? 'Connected as admin' : `Admin: ${short(owner || ENV.adminAddress)}`}</small>
        </div>
        {isAdmin ? (
          <form onSubmit={createMarket} className="create-form">
            <input placeholder="Ask a sharp market question" value={createForm.question} onChange={(e) => setCreateForm({ ...createForm, question: e.target.value })} required />
            <select value={createForm.category} onChange={(e) => setCreateForm({ ...createForm, category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
            <input type="number" min="1" placeholder="Duration (mins)" value={createForm.minutes} onChange={(e) => setCreateForm({ ...createForm, minutes: e.target.value })} />
            <button type="submit">Create market</button>
          </form>
        ) : (
          <p className="muted">Only the Qast admin wallet can create or resolve markets. Traders can buy Yes, buy No, and claim winnings after resolution.</p>
        )}
      </section>

      <section className="market-layout">
        <div className="panel market-list premium-panel">
          <div className="list-head">
            <div>
              <span className="section-kicker">Market board</span>
              <h2>Live and resolved markets</h2>
            </div>
            <div className="subtle-chip">{filteredMarkets.length} visible</div>
          </div>
          <div className="toolbar">
            <input placeholder="Search markets…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option>All</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          {loading ? <div className="empty"><Loader2 className="spin" /> Loading on-chain markets…</div> : null}
          {!loading && filteredMarkets.length === 0 ? <div className="empty">No live on-chain markets yet. Admin must create a market first. If you just created one, click Refresh Markets.</div> : null}
          <div className="cards">
            {filteredMarkets.map((m) => <MarketCard key={m.id} market={m} selected={selectedId === m.id} onSelect={() => setSelectedId(m.id)} />)}
          </div>
        </div>

        <aside className="panel detail premium-panel">
          {selectedMarket ? (
            <MarketDetail
              market={selectedMarket}
              betAmount={betAmount}
              setBetAmount={setBetAmount}
              onBet={bet}
              onClaim={claim}
              onResolve={resolve}
              isAdmin={isAdmin}
            />
          ) : (
            <div className="empty tall">Select a market to start trading real {ENV.symbol}.</div>
          )}
        </aside>
      </section>
    </main>
  );
}

function MarketCard({ market, selected, onSelect }: { market: Market; selected: boolean; onSelect: () => void }) {
  const total = market.totalYesAmount + market.totalNoAmount;
  const yes = pct(market.totalYesAmount, total);
  const no = 100 - yes;
  return (
    <button className={`market-card ${selected ? 'selected' : ''}`} onClick={onSelect}>
      <div className="card-top">
        <span className="pill">{market.category}</span>
        <b>{market.resolved ? (market.outcome ? 'YES WON' : 'NO WON') : 'LIVE'}</b>
      </div>
      <h3>{market.question}</h3>
      <div className="odds-split">
        <div><label>Yes</label><strong>{yes}%</strong></div>
        <div><label>No</label><strong>{no}%</strong></div>
      </div>
      <div className="bars"><div style={{ width: `${yes}%` }} /></div>
      <div className="card-bottom">
        <span><Coins size={14} /> {formatQie(total)} {ENV.symbol}</span>
        <span><Clock size={14} /> {timeLeft(market.endTime)}</span>
      </div>
    </button>
  );
}

function MarketDetail({ market, betAmount, setBetAmount, onBet, onClaim, onResolve, isAdmin }: {
  market: Market;
  betAmount: string;
  setBetAmount: (value: string) => void;
  onBet: (id: number, side: 'yes' | 'no') => void;
  onClaim: (id: number) => void;
  onResolve: (id: number, outcome: boolean) => void;
  isAdmin: boolean;
}) {
  const total = market.totalYesAmount + market.totalNoAmount;
  const yes = pct(market.totalYesAmount, total);
  const no = 100 - yes;
  const hasPosition = (market.userYes || 0n) > 0n || (market.userNo || 0n) > 0n;
  const hasWinningPosition = market.resolved && ((market.outcome && (market.userYes || 0n) > 0n) || (!market.outcome && (market.userNo || 0n) > 0n));
  const impliedYes = yes === 0 ? '—' : `${(100 / yes).toFixed(2)}x`;
  const impliedNo = no === 0 ? '—' : `${(100 / no).toFixed(2)}x`;

  return (
    <div>
      <div className="detail-head">
        <p className="eyebrow">Market #{market.id} · {market.category}</p>
        <span className={`badge ${market.resolved ? 'badge-muted' : 'badge-live'}`}>{market.resolved ? 'Resolved' : 'Open market'}</span>
      </div>
      <h2>{market.question}</h2>
      <div className="odds-board">
        <div className="odds-stat">
          <span>Yes odds</span>
          <strong>{yes}%</strong>
          <small>{impliedYes} implied</small>
        </div>
        <div className="odds-stat negative">
          <span>No odds</span>
          <strong>{no}%</strong>
          <small>{impliedNo} implied</small>
        </div>
      </div>
      <div className="odds-row"><span>Yes</span><b>{yes}%</b></div>
      <div className="odds yes"><div style={{ width: `${yes}%` }} /></div>
      <div className="odds-row"><span>No</span><b>{no}%</b></div>
      <div className="odds no"><div style={{ width: `${no}%` }} /></div>

      <div className="trade-box premium-box">
        <div className="trade-head">
          <div>
            <label>Trade amount</label>
            <small>Enter how much {ENV.symbol} you want to use</small>
          </div>
          <span className="subtle-chip">Live settlement</span>
        </div>
        <input value={betAmount} onChange={(e) => setBetAmount(e.target.value)} placeholder="0.001" />
        <div className="trade-buttons">
          <button disabled={market.resolved || Date.now() / 1000 >= market.endTime} onClick={() => onBet(market.id, 'yes')}>Buy Yes</button>
          <button disabled={market.resolved || Date.now() / 1000 >= market.endTime} className="no-btn" onClick={() => onBet(market.id, 'no')}>Buy No</button>
        </div>
      </div>

      <div className="info-grid">
        <div><span>Total volume</span><b>{formatQie(total)} {ENV.symbol}</b></div>
        <div><span>Ends</span><b>{timeLeft(market.endTime)}</b></div>
        <div><span>Your Yes</span><b>{formatQie(market.userYes)} {ENV.symbol}</b></div>
        <div><span>Your No</span><b>{formatQie(market.userNo)} {ENV.symbol}</b></div>
      </div>

      {market.resolved ? (
        <div className="resolved">
          <CheckCircle2 /> Resolved outcome: <b>{market.outcome ? 'YES' : 'NO'}</b>
          {hasWinningPosition && !market.claimed ? <button onClick={() => onClaim(market.id)}>Claim winnings</button> : null}
          {market.claimed ? <span>Already claimed</span> : null}
          {!hasWinningPosition && hasPosition ? <span>No winning position</span> : null}
        </div>
      ) : null}

      {isAdmin && !market.resolved && Date.now() / 1000 >= market.endTime ? (
        <div className="admin-resolve">
          <span>Admin resolve</span>
          <button onClick={() => onResolve(market.id, true)}>Resolve Yes</button>
          <button className="no-btn" onClick={() => onResolve(market.id, false)}>Resolve No</button>
        </div>
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
