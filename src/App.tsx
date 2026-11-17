import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, Compass, Crown, ExternalLink, Globe2, HelpCircle, Layers3, Maximize2, Plus, RefreshCw, Search, ShieldCheck, Trophy, Wallet, X } from 'lucide-react';
import { usePlatform } from './lib/usePlatform';
import { layoutTerritories } from './lib/territories';
import type { Token } from './types';

const compact = (n: number) => new Intl.NumberFormat('fr-FR', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(n);
const percent = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n) + ' %';
const shortAddress = (a: string) => a.length > 15 ? `${a.slice(0, 5)}…${a.slice(-5)}` : a;

export default function App() {
  const platform = usePlatform();
  const { config, snapshot, loading, error, wallet, busy, notice } = platform;
  const [page, setPage] = useState<'map' | 'ranking' | 'rules'>('map');
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [slippage, setSlippage] = useState('1');
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState({ width: 960, height: 570 });
  const demo = config.mode === 'demo';
  const tokens = [...snapshot.tokens].sort((a, b) => b.marketCap - a.marketCap || a.mint.localeCompare(b.mint));
  const total = tokens.reduce((sum, token) => sum + token.marketCap, 0);
  const selected = tokens.find(t => t.mint === selectedMint) ?? tokens[0];
  const filtered = tokens.filter(t => `${t.name} ${t.symbol} ${t.mint}`.toLowerCase().includes(query.toLowerCase()));
  const territories = layoutTerritories(tokens, mapSize.width, mapSize.height);
  const activeCount = tokens.filter(t => t.marketCap > 0).length;

  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setMapSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element);
    return () => observer.disconnect();
  }, [page, expanded, loading]);

  useEffect(() => {
    if (!expanded) return;
    const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [expanded]);

  async function action(fn: () => Promise<void>) {
    setLocalError(null);
    try { await fn(); } catch (err) { setLocalError(err instanceof Error ? err.message : 'Action impossible. Réessayez.'); }
  }

  function select(token: Token) { setSelectedMint(token.mint); setAmount(''); }

  async function submitTrade(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) { setLocalError('Saisissez un montant supérieur à zéro.'); return; }
    const bps = Math.round(Number(slippage) * 100);
    if (!Number.isFinite(bps) || bps < 1 || bps > 500) { setLocalError('Le glissement doit être compris entre 0,01 % et 5 %.'); return; }
    await action(async () => { await platform.trade({ token: selected, side, amount, slippageBps: bps }); setAmount(''); });
  }

  const inputReserve = selected ? Number(side === 'buy' ? selected.quoteReserve : selected.baseReserve) / 10 ** (side === 'buy' ? selected.quoteDecimals : selected.decimals) : 0;
  const outputReserve = selected ? Number(side === 'buy' ? selected.baseReserve : selected.quoteReserve) / 10 ** (side === 'buy' ? selected.decimals : selected.quoteDecimals) : 0;
  const estimate = Number(amount) > 0 ? outputReserve * Number(amount) / (inputReserve + Number(amount)) : 0;
  const outputSymbol = side === 'buy' ? selected?.symbol : config.quoteSymbol;
  const selectedShare = selected && total > 0 ? selected.marketCap / total * 100 : 0;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setPage('map'); }} aria-label="Dominion, carte des territoires"><span className="brand-mark"><Layers3 size={24} strokeWidth={2.3} /></span><span>dominion<span className="brand-dot">.</span></span></a>
      <div className="topbar-middle"><span className="network-dot" />Solana<span className="network-name">{demo ? 'Démo' : config.mode === 'devnet' ? 'Devnet' : 'Mainnet'}</span></div>
      <div className="header-actions"><button className="button button-quiet header-create" onClick={() => setCreateOpen(true)}><Plus size={16} />Créer un token</button><button className="button wallet-button" disabled={busy} onClick={() => void action(wallet ? platform.disconnect : platform.connect)}><Wallet size={17} /><span>{wallet ? shortAddress(wallet) : 'Connecter Phantom'}</span>{wallet && <span className="connected-dot" />}</button></div>
    </header>

    <div className="workspace">
      <aside className="sidebar">
        <div className="sidebar-world"><span className="world-icon"><Globe2 size={21} /></span><div><strong>{config.worldName || 'Monde originel'}</strong><span>{demo ? 'Terrain d’essai' : 'Territoires Solana'}</span></div></div>
        <nav aria-label="Navigation principale"><button className={page === 'map' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('map')}><Compass size={19} />La carte<span className="nav-count">{activeCount}</span></button><button className={page === 'ranking' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('ranking')}><Trophy size={19} />Classement</button><button className={page === 'rules' ? 'nav-item active' : 'nav-item'} onClick={() => setPage('rules')}><HelpCircle size={19} />Comment jouer</button></nav>
        <div className="sidebar-note"><div className="orbit-symbol"><Globe2 size={48} strokeWidth={0.8} /><span /><span /></div><h3>Un monde.<br />À vous de le dessiner.</h3><p>Créez un token. Faites grandir sa communauté. Gagnez du terrain.</p><button className="button button-light" onClick={() => setCreateOpen(true)}><Plus size={16} />Lancer mon token</button></div>
        <div className="sidebar-bottom"><ShieldCheck size={16} /><span>Votre wallet, vos signatures.</span></div>
      </aside>

      <main className="main-content">
        {demo && <div className="demo-banner"><span><span className="demo-tag">Démo</span>Explorez le jeu avec des tokens fictifs. Aucun fonds réel n’est utilisé.</span><button onClick={() => { platform.resetDemo(); setSelectedMint(null); }}>Réinitialiser</button></div>}
        {!demo && !config.tradingEnabled && <div className="demo-banner"><span>Les échanges sont désactivés pour ce monde. La carte reste consultable.</span></div>}
        {(error || localError) && <div className="message message-error" role="alert"><span>{localError || error}</span>{localError && <button aria-label="Fermer le message" onClick={() => setLocalError(null)}><X size={16} /></button>}</div>}
        {notice && <div className="message message-success" role="status"><Check size={17} /><span>{notice}</span></div>}

        <div className="page-heading"><div><h1>{page === 'map' ? 'La conquête commence ici.' : page === 'ranking' ? 'Qui mène la conquête ?' : 'Chaque token a sa place.'}</h1><p>{page === 'map' ? 'Un territoire qui grandit avec la capitalisation de votre token.' : page === 'ranking' ? 'Tous les tokens du monde, classés par capitalisation en circulation.' : 'Les règles d’un monde où chaque surface a un sens.'}</p></div><button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={18} />Créer un token</button></div>

        <section className="world-stats" aria-label="Statistiques du monde"><div><span>Capitalisation du monde</span><strong>{compact(total)} <small>{config.quoteSymbol}</small></strong></div><div><span>Tokens créés</span><strong>{tokens.length.toString().padStart(2, '0')} <small>dont {activeCount} sur la carte</small></strong></div><div><span>Territoire occupé</span><strong>{total > 0 ? '100' : '0'}<small> % du monde</small></strong></div><div className="world-status"><span className={demo ? 'status-dot demo' : 'status-dot'} /><div><strong>{demo ? 'Simulation locale' : 'Données Solana'}</strong><span>{demo ? 'À vous de jouer' : snapshot.updatedAt ? `Actualisé à ${new Date(snapshot.updatedAt).toLocaleTimeString('fr-FR')}` : 'En attente du réseau'}</span></div></div></section>

        {page === 'map' && <div className="game-grid">
          <section className={expanded ? 'map-panel map-expanded' : 'map-panel'} aria-label="Carte des territoires">
            <div className="panel-toolbar"><div className="map-title"><span className="map-cross">⌖</span><strong>Le monde</strong><span>{activeCount} territoires</span></div><div className="toolbar-actions"><button title="Actualiser les données" aria-label="Actualiser les données" disabled={loading || busy} onClick={() => void action(platform.refresh)}><RefreshCw size={16} className={loading ? 'spinning' : ''} /></button><button title={expanded ? 'Réduire la carte' : 'Agrandir la carte'} aria-label={expanded ? 'Réduire la carte' : 'Agrandir la carte'} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={18} /> : <Maximize2 size={16} />}</button></div></div>
            <div className="territory-map" ref={mapRef} aria-busy={loading}>
              {territories.map(({ token, x, y, width, height }) => <button key={token.mint} className={`territory ${selected?.mint === token.mint ? 'territory-selected' : ''} ${query && !filtered.some(t => t.mint === token.mint) ? 'territory-muted' : ''}`} onClick={() => select(token)} style={{ left: x, top: y, width, height, backgroundColor: token.color }} aria-label={`${token.name}, ${percent(total > 0 ? token.marketCap / total * 100 : 0)} du territoire, ${compact(token.marketCap)} ${config.quoteSymbol}`} title={`${token.name} · ${percent(total > 0 ? token.marketCap / total * 100 : 0)}`}>
                {width > 72 && height > 54 && <span className="territory-content"><span className="territory-symbol" style={{ fontSize: Math.min(36, Math.max(13, width / 7)) }}>{token.symbol}</span>{width > 105 && height > 90 && <span className="territory-name">{token.name}</span>}<span className="territory-share">{percent(total > 0 ? token.marketCap / total * 100 : 0)}</span>{width > 160 && height > 155 && <span className="territory-cap">{compact(token.marketCap)} {config.quoteSymbol}</span>}</span>}
                {selected?.mint === token.mint && width > 55 && height > 45 && <span className="territory-selected-mark"><Check size={13} /></span>}
              </button>)}
              {territories.length === 0 && <div className="empty-map"><Globe2 size={48} strokeWidth={1} /><h2>{loading ? 'Le monde se dessine…' : 'Un monde à conquérir.'}</h2><p>Créez un token puis réalisez un premier achat pour lui donner un territoire.</p><button className="button button-primary" onClick={() => setCreateOpen(true)}>Créer le premier token</button></div>}
            </div>
            <div className="map-footer"><span><span className="tiny-square" />Surface = part de capitalisation</span><span>{demo ? 'Données fictives' : snapshot.slot ? `Slot ${snapshot.slot.toLocaleString('fr-FR')}` : 'En attente'}<span className="footer-separator">/</span>{total > 0 ? '100 % répartis' : 'Aucun territoire actif'}</span></div>
          </section>

          <aside className="token-panel" aria-label="Token sélectionné">
            {selected ? <><div className="token-heading"><div className="token-avatar" style={{ background: selected.color }}>{selected.symbol.slice(0, 2)}</div><div><h2>{selected.name}</h2><span>${selected.symbol}</span></div><span className="rank-pill"><Crown size={12} />#{tokens.findIndex(t => t.mint === selected.mint) + 1}</span></div>
              <div className="token-territory"><span>Part du territoire</span><strong>{percent(selectedShare)}</strong><div className="territory-progress"><span style={{ width: `${selectedShare}%`, background: selected.color }} /></div></div>
              <dl className="token-facts"><div><dt>Capitalisation</dt><dd>{compact(selected.marketCap)} <span>{config.quoteSymbol}</span></dd></div><div><dt>Réserve du marché</dt><dd>{compact(Number(selected.quoteReserve) / 10 ** selected.quoteDecimals)} <span>{config.quoteSymbol}</span></dd></div><div><dt>Prix du token</dt><dd>{selected.price === 0 ? '0' : new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 5 }).format(selected.price)} <span>{config.quoteSymbol}</span></dd></div><div><dt>Tokens en circulation</dt><dd>{compact(Math.max(0, Number(BigInt(selected.supply) - BigInt(selected.baseReserve))) / 10 ** selected.decimals)}</dd></div></dl>
              <div className="trade-tabs" role="group" aria-label="Sens de l’échange"><button className={side === 'buy' ? 'selected' : ''} onClick={() => { setSide('buy'); setAmount(''); }}><ArrowDownLeft size={16} />Acheter</button><button className={side === 'sell' ? 'selected' : ''} onClick={() => { setSide('sell'); setAmount(''); }}><ArrowUpRight size={16} />Vendre</button></div>
              <form className="trade-form" onSubmit={e => void submitTrade(e)}><label htmlFor="trade-amount">Vous payez</label><div className="amount-field"><input id="trade-amount" inputMode="decimal" placeholder="0,00" value={amount} onChange={e => setAmount(e.target.value.replace(',', '.'))} required autoComplete="off" /><span>{side === 'buy' ? config.quoteSymbol : selected.symbol}</span></div><div className="slippage-line"><label htmlFor="slippage">Glissement maximal</label><div><input id="slippage" aria-label="Glissement maximal en pourcentage" type="number" step="0.01" min="0.01" max="5" value={slippage} onChange={e => setSlippage(e.target.value)} /><span>%</span></div></div><div className="receive-line"><span>Réception estimée</span><strong>≈ {compact(estimate || 0)} {outputSymbol}</strong></div><button className="button button-primary trade-submit" type="submit" disabled={busy || (!demo && !config.tradingEnabled)}>{busy ? 'Opération en cours…' : demo ? `Simuler ${side === 'buy' ? 'l’achat' : 'la vente'}` : `${side === 'buy' ? 'Acheter' : 'Vendre'} ${selected.symbol}`}</button><p className="trade-note">{demo ? 'Simulation uniquement. Aucune transaction envoyée.' : 'Le montant final est protégé par votre limite de glissement. Les frais réseau sont payés en SOL.'}</p></form>
              <div className="token-address"><span>Adresse du token</span><button title="Copier l’adresse du token" onClick={() => { void navigator.clipboard.writeText(selected.mint).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => setLocalError('Impossible de copier l’adresse.')); }}>{copied ? 'Copié !' : shortAddress(selected.mint)}{copied ? <Check size={13} /> : <Layers3 size={13} />}</button>{!demo && <a href={`https://explorer.solana.com/address/${selected.mint}${config.mode === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer" aria-label="Voir le token sur Solana Explorer"><ExternalLink size={14} /></a>}</div>
            </> : <div className="empty-token"><Compass size={32} /><h2>Choisissez votre territoire.</h2><p>Les détails et les échanges d’un token apparaîtront ici.</p></div>}
          </aside>
        </div>}

        {(page === 'map' || page === 'ranking') && <section className="ranking-panel"><div className="ranking-heading"><div><h2>{page === 'map' ? 'Les forces en présence' : 'Le classement du monde'}</h2><span>{tokens.length} tokens dans ce monde</span></div><label className="search-field"><Search size={16} /><input aria-label="Rechercher un token" placeholder="Rechercher un token…" value={query} onChange={e => setQuery(e.target.value)} /></label></div><div className="table-scroll"><table><thead><tr><th>Rang</th><th>Token</th><th>Capitalisation</th><th>Territoire</th><th>Prix</th><th><span className="sr-only">Consulter</span></th></tr></thead><tbody>{filtered.slice(0, page === 'map' ? 5 : undefined).map(token => <tr key={token.mint} className={selected?.mint === token.mint ? 'selected-row' : ''}><td><span className="table-rank">{tokens.findIndex(t => t.mint === token.mint) + 1}</span></td><td><button className="token-table-button" onClick={() => { select(token); setPage('map'); }}><span className="table-avatar" style={{ background: token.color }}>{token.symbol.slice(0, 1)}</span><span><strong>{token.name}</strong><small>${token.symbol}</small></span></button></td><td>{compact(token.marketCap)} <small>{config.quoteSymbol}</small></td><td><div className="table-share"><span>{percent(total > 0 ? token.marketCap / total * 100 : 0)}</span><div><span style={{ width: `${total > 0 ? token.marketCap / total * 100 : 0}%`, background: token.color }} /></div></div></td><td>{new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 4 }).format(token.price)} <small>{config.quoteSymbol}</small></td><td><button className="row-open" aria-label={`Consulter ${token.name}`} onClick={() => { select(token); setPage('map'); }}><ChevronRight size={16} /></button></td></tr>)}</tbody></table>{filtered.length === 0 && <p className="empty-search">{tokens.length ? 'Aucun token ne correspond à votre recherche.' : 'Le premier token de ce monde sera peut-être le vôtre.'}</p>}</div>{page === 'map' && tokens.length > 5 && <button className="all-tokens" onClick={() => setPage('ranking')}>Voir les {tokens.length} tokens<ChevronRight size={15} /></button>}</section>}

        {page === 'rules' && <section className="rules-panel"><div className="rules-intro"><Globe2 size={54} strokeWidth={1} /><h2>La carte est le marché.</h2><p>Chaque rectangle représente un token. Sa surface correspond à sa capitalisation en circulation divisée par la capitalisation totale des tokens de ce monde.</p><div className="formula">Territoire = capitalisation du token ÷ capitalisation du monde</div></div><div className="rules-steps"><article><span>1</span><div><h3>Fondez votre token</h3><p>Choisissez un nom et un symbole. Vous apportez une réserve initiale en {config.quoteSymbol}, définitivement immobilisée dans le marché. Un milliard de tokens est créé, sans allocation gratuite au créateur.</p></div></article><article><span>2</span><div><h3>Donnez-lui un territoire</h3><p>Un premier achat fait sortir des tokens de la réserve. Ils entrent en circulation et créent une capitalisation positive. Le token apparaît alors sur la carte.</p></div></article><article><span>3</span><div><h3>Faites évoluer le monde</h3><p>Achats et ventes modifient les réserves et le prix. Toutes les surfaces s’ajustent proportionnellement. Une recherche ne change jamais les proportions du monde.</p></div></article></div><div className="rules-details"><h3>Des règles lisibles</h3><p>Le prix vient du rapport entre les réserves du marché. La capitalisation affichée utilise les tokens hors réserve, et non l’offre totale. Une faible liquidité peut gonfler la capitalisation ; le territoire ne mesure ni la solidité ni la valeur réalisable d’un token. Ce n’est ni le montant disponible au retrait ni une garantie de liquidité.</p><p>La surface ne constitue pas un titre de propriété. Les noms et symboles ne sont pas uniques : l’adresse du mint identifie le token. Aucun rendement n’est promis. Les fonds de la réserve initiale ne peuvent pas être récupérés par le créateur.</p><p>Chaque monde utilise une seule monnaie de réserve. Changer le token de plateforme ouvre un autre monde ; les marchés existants conservent leurs réserves et leur unité de compte.</p></div><button className="button button-primary" onClick={() => setPage('map')}><Compass size={17} />Explorer la carte</button></section>}
        <footer className="page-footer"><span>dominion.</span><span>Un monde partagé. Des proportions transparentes.</span><button onClick={() => setPage('rules')}>Comprendre les règles</button></footer>
      </main>
    </div>
    {createOpen && <CreateModal demo={demo} symbol={config.quoteSymbol} busy={busy} enabled={demo || config.tradingEnabled} onClose={() => setCreateOpen(false)} onSubmit={async input => { await platform.createToken(input); setCreateOpen(false); setPage('map'); }} />}
  </div>;
}

function CreateModal({ demo, symbol, busy, enabled, onClose, onSubmit }: { demo: boolean; symbol: string; busy: boolean; enabled: boolean; onClose: () => void; onSubmit: (input: { name: string; symbol: string; seedAmount: string }) => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [seed, setSeed] = useState('100');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
      if (e.key === 'Tab') {
        const nodes = [...(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),a[href]') ?? [])];
        const first = nodes[0]; const last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', listener);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', listener); document.body.style.overflow = previousOverflow; previous?.focus(); };
  }, [busy, onClose]);
  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!name.trim() || new TextEncoder().encode(name.trim()).length > 32) { setError('Le nom doit contenir entre 1 et 32 octets (les accents peuvent compter double).'); return; }
    if (!/^[A-Z0-9]{1,10}$/.test(ticker)) { setError('Utilisez 1 à 10 lettres ou chiffres pour le symbole.'); return; }
    if (!Number.isFinite(Number(seed)) || Number(seed) <= 0) { setError('La réserve initiale doit être supérieure à zéro.'); return; }
    try { await onSubmit({ name: name.trim(), symbol: ticker, seedAmount: seed }); } catch (err) { setError(err instanceof Error ? err.message : 'La création a échoué. Réessayez.'); }
  }
  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}><div className="create-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="create-title"><button className="modal-close" aria-label="Fermer la création" disabled={busy} onClick={onClose}><X size={20} /></button><span className="modal-symbol"><Layers3 size={26} /></span><h2 id="create-title">Un nouveau territoire<br />commence par un token.</h2><p>{demo ? 'Essayez la création avec des fonds fictifs.' : 'Créez votre marché sur Solana avec votre wallet.'}</p><form onSubmit={e => void submit(e)}><label htmlFor="token-name">Nom du token</label><input id="token-name" value={name} onChange={e => setName(e.target.value)} placeholder="Ex. Moon Garden" maxLength={32} required /><div className="modal-fields"><div><label htmlFor="token-symbol">Symbole</label><input id="token-symbol" value={ticker} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="GARDEN" maxLength={10} pattern="[A-Z0-9]{1,10}" required /></div><div><label htmlFor="token-seed">Réserve initiale ({symbol})</label><input id="token-seed" value={seed} onChange={e => setSeed(e.target.value.replace(',', '.'))} inputMode="decimal" required /></div></div><div className="creation-facts"><span>Offre totale<strong>1 milliard de tokens</strong></span><span>Allocation du créateur<strong>0 token</strong></span><span>Première surface<strong>Après un premier achat</strong></span></div><label className="check-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} required /><span>Je comprends que la réserve initiale est immobilisée définitivement et que créer le token ne m’attribue aucun token.</span></label>{!demo && <p className="modal-network-note">Des SOL sont également nécessaires pour les frais réseau et la création des comptes.</p>}{error && <div className="message message-error" role="alert">{error}</div>}<button className="button button-primary" type="submit" disabled={busy || !accepted || !enabled}>{busy ? 'Création en cours…' : demo ? 'Créer mon token fictif' : 'Créer et signer avec Phantom'}<Plus size={17} /></button></form></div></div>;
}
