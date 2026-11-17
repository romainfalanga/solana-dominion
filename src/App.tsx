import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight, Compass, Crown, ExternalLink, Globe2, Layers3, Maximize2, Plus, RefreshCw, Search,  Wallet, X } from 'lucide-react';
import { usePlatform } from './lib/usePlatform';
import WalletPage from './WalletPage';
import GovernancePage from './GovernancePage';
import { useWorldCatalog, WorldSelector, PendingWorld } from './WorldNavigation';
import { layoutTerritories } from './lib/territories';
import type { Token, PlatformConfig, TradeInput } from './types';
import { parseUnits } from './lib/math';

const compact = (n: number) => new Intl.NumberFormat('fr-FR', { notation: n >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(n);
const percent = (n: number) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(n) + ' %';
const shortAddress = (a: string) => a.length > 15 ? `${a.slice(0, 5)}…${a.slice(-5)}` : a;

export default function App() {
  const [page, setPage] = useState<'map' | 'wallet' | 'governance' | 'rules'>('map');
  const [worldId, setWorldId] = useState('origin');
  const worlds = useWorldCatalog();
  const catalogInitialized = useRef(false);
  useEffect(() => { if (!worlds.catalog || catalogInitialized.current) return; catalogInitialized.current = true; if (worlds.catalog.worlds.some(w => w.id === worlds.catalog!.activeWorldId)) setWorldId(worlds.catalog.activeWorldId); }, [worlds.catalog]);
  const currentWorld = worlds.catalog?.worlds.find(w => w.id === worldId);
  const pendingWorld = currentWorld?.status === 'pending';
  const worldPage = page === 'map' || page === 'rules';
  const platform = usePlatform(worldPage, worldId, !pendingWorld);
  const { config, snapshot, loading, error, wallet, busy, notice } = platform;
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [platformCopied, setPlatformCopied] = useState(false);
  const [showAllTokens, setShowAllTokens] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const [mapSize, setMapSize] = useState({ width: 960, height: 570 });
  const demo = config.mode === 'demo';
  const currency = snapshot.currency ?? (demo ? config.quoteSymbol : 'USD');
  const explorerSuffix = config.mode === 'devnet' ? '?cluster=devnet' : '';
  const awaitingCount = snapshot.tokens.filter(t => t.marketCap <= 0).length;
  const tokens = [...snapshot.tokens].sort((a, b) => b.marketCap - a.marketCap || a.mint.localeCompare(b.mint));
  const total = tokens.reduce((sum, token) => sum + token.marketCap, 0);
  const selected = tokens.find(t => t.mint === selectedMint) ?? tokens[0];
  const filtered = tokens.filter(t => `${t.name} ${t.symbol} ${t.mint}`.toLowerCase().includes(query.toLowerCase()));
  const territories = layoutTerritories(tokens, mapSize.width, mapSize.height);
  const activeCount = tokens.filter(t => t.marketCap > 0).length;
  const isPlatformToken = (token: Token) => token.isPlatform === true || token.mint === config.quoteMint;

  useEffect(() => {
    setNoticeVisible(Boolean(notice));
    if (!notice) return;
    const timeout = window.setTimeout(() => setNoticeVisible(false), 7000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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

  function select(token: Token) { setSelectedMint(token.mint); }

  const selectedShare = selected && total > 0 ? selected.marketCap / total * 100 : 0;

  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setPage('map'); }} aria-label="Dominion, carte des territoires"><img className="brand-mark brand-logo" src="/brand/dominion-token.png" alt="" /><span>dominion<span className="brand-dot">.</span></span></a>
      <nav className="main-nav" aria-label="Navigation principale">{([{id:"map",label:"Le territoire"},{id:"wallet",label:"Wallet"},{id:"governance",label:"Gouvernance"},{id:"rules",label:"Les règles"}] as const).map(item=><button key={item.id} className={page===item.id?"active":""} onClick={()=>{setPage(item.id);setLocalError(null);}}>{item.label}</button>)}</nav><div className="topbar-middle"><span className="network-dot" />Solana<span className="network-name">{demo ? 'Démo' : config.mode === 'devnet' ? 'Devnet' : 'Mainnet'}</span></div>
      <div className="header-actions"><button className="button button-quiet header-create" disabled={!worldPage || pendingWorld || loading} onClick={() => setCreateOpen(true)}><Plus size={16} />Créer un token</button><button className="button wallet-button" disabled={busy} onClick={() => void action(wallet ? platform.disconnect : platform.connect)}><Wallet size={17} /><span>{wallet ? shortAddress(wallet) : 'Connecter Phantom'}</span>{wallet && <span className="connected-dot" />}</button></div>
    </header>

    <div className="workspace">
      <main className="main-content">
        {demo && worldPage && <div className="demo-banner"><span><span className="demo-tag">Démo</span>Explorez le jeu avec des tokens fictifs. Aucun fonds réel n’est utilisé.</span><button onClick={() => { platform.resetDemo(); setSelectedMint(null); }}>Réinitialiser</button></div>}
        {(localError || (worldPage && error)) && <div className="message message-error" role="alert"><span>{localError || error}</span>{localError && <button aria-label="Fermer le message" onClick={() => setLocalError(null)}><X size={16} /></button>}</div>}
        {notice && noticeVisible && worldPage && <div className="message message-success" role="status"><Check size={17} /><span>{notice}</span><button type="button" aria-label="Fermer la notification" onClick={() => setNoticeVisible(false)}><X size={16} /></button></div>}

        <div className="map-heading"><div><h1>{page === 'map' ? 'Le territoire.' : page === 'wallet' ? 'Wallet.' : page === 'governance' ? 'Gouvernance.' : 'Les règles.'}</h1><p>{page === 'map' ? 'Une carte, tous les tokens. La capitalisation fixe les frontières.' : page === 'wallet' ? 'Vos positions, réparties selon leur valeur en dollars.' : page === 'governance' ? 'Le token mère décide des prochains thèmes.' : 'Les paramètres du launchpad et du calcul des territoires.'}</p></div>{worldPage && !pendingWorld && <button className="button button-primary" onClick={() => setCreateOpen(true)}><Plus size={18} />Créer un token</button>}</div>

        {worldPage && worlds.catalog && <WorldSelector worlds={worlds.catalog.worlds} selected={worldId} busy={busy} onSelect={id => { setWorldId(id); setCreateOpen(false); setSelectedMint(null); setQuery(''); setLocalError(null); setExpanded(false); }} />}
        {worldPage && worlds.error && <div className="message message-error" role="alert">{worlds.error}<button onClick={worlds.retry}>Réessayer le catalogue</button></div>}
        {worldPage && pendingWorld && currentWorld && <PendingWorld world={currentWorld} />}
        {page === 'governance' && <GovernancePage owner={wallet} onConnect={() => action(platform.connect)} busy={busy} />}
        {page === 'wallet' && <WalletPage owner={wallet} onConnect={() => action(platform.connect)} busy={busy} quoteMint={config.quoteMint} />}

        {page === 'map' && !pendingWorld && <section className="world-stats" aria-label="Statistiques du monde"><div><span>Capitalisation du monde</span><strong>{compact(total)} <small>{currency}</small></strong></div><div><span>Tokens créés</span><strong>{tokens.length.toString().padStart(2, '0')} <small>dont {activeCount} sur la carte</small></strong></div><div><span>Territoire occupé</span><strong>{total > 0 ? '100' : '0'}<small> % du monde</small></strong></div><div className="world-status"><span className={demo ? 'status-dot demo' : 'status-dot'} /><div><strong>{demo ? 'Simulation locale' : 'Données Solana'}</strong><span>{demo ? 'À vous de jouer' : snapshot.updatedAt ? `Actualisé à ${new Date(snapshot.updatedAt).toLocaleTimeString('fr-FR')}` : 'En attente du réseau'}</span></div></div></section>}

        {page === 'map' && !pendingWorld && <div className="game-grid" id="arena">
          <section className={expanded ? 'map-panel map-expanded' : 'map-panel'} aria-label="Carte des territoires">
            <div className="panel-toolbar"><div className="map-title"><span className="map-cross">⌖</span><strong>La carte</strong><span>{activeCount} territoires</span></div><div className="toolbar-actions"><button title="Actualiser les données" aria-label="Actualiser les données" disabled={loading || busy} onClick={() => void action(platform.refresh)}><RefreshCw size={16} className={loading ? 'spinning' : ''} /></button><button title={expanded ? 'Réduire la carte' : 'Agrandir la carte'} aria-label={expanded ? 'Réduire la carte' : 'Agrandir la carte'} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={18} /> : <Maximize2 size={16} />}</button></div></div>
            <div className="territory-map" ref={mapRef} aria-busy={loading}>
              {territories.map(({ token, x, y, width, height }) => <button key={token.mint} className={`territory ${selected?.mint === token.mint ? 'territory-selected' : ''} ${query && !filtered.some(t => t.mint === token.mint) ? 'territory-muted' : ''}`} onClick={() => select(token)} style={{ left: x, top: y, width, height, backgroundColor: token.color }} aria-label={`${token.name}, ${percent(total > 0 ? token.marketCap / total * 100 : 0)} du territoire, ${compact(token.marketCap)} ${currency}`} title={`${token.name} · ${percent(total > 0 ? token.marketCap / total * 100 : 0)}`}>
                {width > 72 && height > 54 && <span className="territory-content">{isPlatformToken(token) && width > 100 && height > 140 && <img className="territory-platform-logo" src="/brand/dominion-token.png" alt="" />}<span className="territory-symbol" style={{ fontSize: Math.min(36, Math.max(13, width / 7)) }}>{token.symbol}</span>{width > 105 && height > 90 && <span className="territory-name">{token.name}</span>}<span className="territory-share">{percent(total > 0 ? token.marketCap / total * 100 : 0)}</span>{width > 160 && height > 155 && <span className="territory-cap">{compact(token.marketCap)} {currency}</span>}</span>}
                {selected?.mint === token.mint && width > 55 && height > 45 && <span className="territory-selected-mark"><Check size={13} /></span>}
              </button>)}
              {territories.length === 0 && <div className="empty-map"><div className="empty-beacon" aria-hidden="true"><img src="/brand/dominion-token.png" alt="" /></div><h2>{loading ? 'Le monde se dessine…' : 'Un monde à conquérir.'}</h2><p>{tokens.length ? `${awaitingCount} token${awaitingCount > 1 ? 's' : ''} sans valorisation disponible. Les territoires apparaîtront dès que les prix en dollars pourront être vérifiés.` : 'Créez un token et choisissez votre achat initial. La carte se remplit dès que sa capitalisation peut être vérifiée.'}</p><button className="button button-primary" onClick={() => setCreateOpen(true)}>Créer le premier token</button></div>}
            </div>
            <div className="map-footer"><span><span className="tiny-square" />Surface = part de capitalisation</span><span>{demo ? 'Données fictives' : snapshot.slot ? `Slot ${snapshot.slot.toLocaleString('fr-FR')}` : 'En attente'}<span className="footer-separator">/</span>{total > 0 ? '100 % répartis' : 'Aucun territoire actif'}</span></div>
          </section>

          <div className="market-sidebar">
            {config.quoteMint && <section className="platform-token-card" aria-label="Token de la plateforme"><div className="platform-token-heading"><img src="/brand/dominion-token.png" alt="Dominion" /><div><strong>{config.quoteSymbol}</strong><span>Token de la plateforme</span></div><a href={`https://explorer.solana.com/address/${config.quoteMint}${explorerSuffix}`} target="_blank" rel="noreferrer" aria-label="Voir le token de la plateforme sur Solana Explorer"><ExternalLink size={14} /></a></div><button className="platform-contract" title={platformCopied ? 'Adresse copiée' : 'Copier l’adresse du token de la plateforme'} aria-label={platformCopied ? 'Adresse copiée' : `Copier l’adresse ${config.quoteMint}`} onClick={() => { void navigator.clipboard.writeText(config.quoteMint!).then(() => { setPlatformCopied(true); setTimeout(() => setPlatformCopied(false), 2000); }).catch(() => setLocalError('Impossible de copier l’adresse.')); }}><span>CA</span><code>{config.quoteMint}</code>{platformCopied ? <Check size={13} /> : <Layers3 size={13} />}</button></section>}
          <aside className="token-panel" aria-label="Token sélectionné">
            {selected ? <><div className="token-heading"><div className="token-avatar" style={{ background: selected.color }}>{isPlatformToken(selected) ? <img src="/brand/dominion-token.png" alt="" /> : selected.symbol.slice(0, 2)}</div><div><h2>{selected.name}</h2><span>${selected.symbol}</span></div><span className="rank-pill"><Crown size={12} />#{tokens.findIndex(t => t.mint === selected.mint) + 1}</span></div>
              <div className="token-territory"><span>Part du territoire</span><strong>{percent(selectedShare)}</strong><div className="territory-progress"><span style={{ width: `${selectedShare}%`, background: selected.color }} /></div></div>
              <dl className="token-facts"><div><dt>Capitalisation</dt><dd>{compact(selected.marketCap)} <span>{currency}</span></dd></div><div><dt>Prix du token</dt><dd>{selected.price > 0 ? new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 5 }).format(selected.price) : 'Indisponible'} {selected.price > 0 && <span>{currency}</span>}</dd></div><div><dt>Offre actuelle</dt><dd>{compact(Number(selected.supply) / 10 ** selected.decimals)}</dd></div></dl>
              {selected.launchModel === 'dbc' && !selected.migrated ? selected.migrationReady ? <MigrationPanel token={selected} busy={busy} onMigrate={() => action(() => platform.migrate(selected))} /> : <TradePanel key={selected.mint} config={selected.marketConfig ?? config} token={selected} busy={busy} onTrade={platform.trade} /> : <div className="external-market"><span className={selected.marketCap > 0 ? 'listing-status listed' : 'listing-status'}><span />{selected.marketCap > 0 ? 'Prix de marché disponible' : 'Valorisation indisponible'}</span><h3>{selected.migrated ? 'Courbe migrée.' : 'Marché externe.'}</h3><p>{selected.migrated ? 'La courbe a atteint son seuil de migration. Retrouvez le marché externe de ce token pour poursuivre les échanges.' : selected.marketCap > 0 ? 'Le prix et la liquidité de ce token proviennent d’un marché externe.' : 'Sans valorisation vérifiable, ce token conserve une surface nulle. Consultez son marché pour vérifier sa liquidité.'}</p>{!demo && <><a className="button button-primary" href={selected.marketUrl || `https://dexscreener.com/solana/${selected.mint}`} target="_blank" rel="noreferrer">Voir le marché externe<ExternalLink size={14} /></a><a className="button button-quiet" href={`https://explorer.solana.com/address/${selected.mint}${explorerSuffix}`} target="_blank" rel="noreferrer">Voir sur Solana Explorer<ExternalLink size={13} /></a><small>Le marché externe peut demander un délai avant de référencer ce token.</small></>}{demo && <small>Données fictives : aucun marché réel pour ce token de démonstration.</small>}</div>}
              <div className="token-address"><span>Adresse du token</span><button title="Copier l’adresse du token" onClick={() => { void navigator.clipboard.writeText(selected.mint).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => setLocalError('Impossible de copier l’adresse.')); }}>{copied ? 'Copié !' : shortAddress(selected.mint)}{copied ? <Check size={13} /> : <Layers3 size={13} />}</button>{!demo && <a href={`https://explorer.solana.com/address/${selected.mint}${config.mode === 'devnet' ? '?cluster=devnet' : ''}`} target="_blank" rel="noreferrer" aria-label="Voir le token sur Solana Explorer"><ExternalLink size={14} /></a>}</div>
            </> : <div className="empty-token"><div className="empty-token-top"><Crown size={18} /><span>Votre prochain empire</span></div><div className="empire-emblem"><img src="/brand/dominion-token.png" alt="Dominion" /></div><h2>La première place<br />est à prendre.</h2><p>Lancez votre token avec un achat initial. Sa capitalisation détermine ensuite sa part de la carte.</p><button className="button button-primary" onClick={()=>setCreateOpen(true)}><Plus size={16} />Lancer mon token</button><div className="empty-token-cost"><span>Achat initial en</span><strong>{config.quoteSymbol}</strong><small>+ frais Solana</small></div></div>}
          </aside>
          </div>
        </div>}

        {page === 'map' && !pendingWorld && <section className="ranking-panel"><div className="ranking-heading"><div><h2>Les tokens du territoire</h2><span>{tokens.length} tokens dans ce monde</span></div><label className="search-field"><Search size={16} /><input aria-label="Rechercher un token" placeholder="Rechercher un token…" value={query} onChange={e => setQuery(e.target.value)} /></label></div><div className="table-scroll"><table><thead><tr><th>Rang</th><th>Token</th><th>Capitalisation</th><th>Territoire</th><th>Prix</th><th><span className="sr-only">Consulter</span></th></tr></thead><tbody>{filtered.slice(0, showAllTokens || query ? undefined : 5).map(token => <tr key={token.mint} className={selected?.mint === token.mint ? 'selected-row' : ''}><td><span className="table-rank">{tokens.findIndex(t => t.mint === token.mint) + 1}</span></td><td><button className="token-table-button" onClick={() => { select(token); setPage('map'); }}><span className="table-avatar" style={{ background: token.color }}>{isPlatformToken(token) ? <img src="/brand/dominion-token.png" alt="" /> : token.symbol.slice(0, 1)}</span><span><strong>{token.name}</strong><small>${token.symbol}{token.marketCap <= 0 ? ' · Valorisation indisponible' : ''}</small></span></button></td><td>{compact(token.marketCap)} <small>{currency}</small></td><td><div className="table-share"><span>{percent(total > 0 ? token.marketCap / total * 100 : 0)}</span><div><span style={{ width: `${total > 0 ? token.marketCap / total * 100 : 0}%`, background: token.color }} /></div></div></td><td>{new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 4 }).format(token.price)} <small>{currency}</small></td><td><button className="row-open" aria-label={`Consulter ${token.name}`} onClick={() => { select(token); setPage('map'); }}><ChevronRight size={16} /></button></td></tr>)}</tbody></table>{filtered.length === 0 && <p className="empty-search">{tokens.length ? 'Aucun token ne correspond à votre recherche.' : 'Le premier token de ce monde sera peut-être le vôtre.'}</p>}</div>{tokens.length > 5 && !query && <button className="all-tokens" onClick={() => setShowAllTokens(!showAllTokens)}>{showAllTokens ? 'Afficher moins de tokens' : `Voir les ${tokens.length} tokens`}<ChevronRight size={15} /></button>}</section>}

        {page === 'rules' && !pendingWorld && <section className="rules-panel"><div className="rules-intro"><h2>Du launch à la carte.</h2><p>Chaque semaine, un nouveau monde permanent possède sa propre monnaie de cotation. Le token mère permet de voter sur les thèmes dans Gouvernance. Les cartes sont indépendantes ; les anciens mondes restent ouverts.</p><p>Chaque nouveau token est lancé sur une bonding curve Meteora DBC, cotée en {config.quoteSymbol}. Les achats et les ventes font évoluer son prix et sa part du territoire.</p><div className="formula">Surface = market cap du token / market cap totale</div></div><div className="rules-steps"><article><span>1</span><div><h3>Launch + achat initial</h3><p>Créez le token et choisissez votre achat initial en {config.quoteSymbol}. La supply non achetée reste dans le protocole. Au premier lancement, la configuration puis le pool et l’achat initial nécessitent deux signatures Phantom.</p></div></article><article><span>2</span><div><h3>Une courbe, pas une parité</h3><p>Les achats consomment la liquidité de la courbe ; le prix augmente. Acheter davantage augmente votre allocation, mais le nombre de tokens reçus n’est pas proportionnel au montant. Les ventes suivent la courbe en sens inverse.</p></div></article><article><span>3</span><div><h3>Une surface recalculée</h3><p>Market cap = prix du token sur la courbe × prix USD de sa monnaie de cotation × supply actuelle. La somme des parts remplit la carte. Sans valorisation vérifiable, le token reste dans la liste avec une surface nulle.</p></div></article></div><div className="rules-details"><h3>À vérifier dans Phantom</h3><p>Au seuil de la courbe, tout wallet peut déclencher la migration de la liquidité vers Meteora DAMM V2. Une signature et des frais en SOL sont nécessaires ; les échanges reprennent ensuite sur le marché migré.</p><p>Si le token de la plateforme change, les courbes existantes conservent leur monnaie de cotation et leurs paramètres. Leur devis et leur valorisation utilisent ces paramètres historiques.</p><p>Montant initial, minimum reçu, frais en {config.quoteSymbol} et coûts des comptes en SOL sont distincts. Les frais du protocole et le slippage influent sur l’exécution ; seule la transaction signée fait foi.</p><p>Le territoire n’est ni une liquidité disponible ni un droit de propriété. Une capitalisation élevée peut reposer sur peu de liquidité. Aucun prix, rendement ou échange à parité n’est garanti.</p><p>Le mint identifie le token. Les noms et tickers ne sont pas uniques. La recherche filtre la liste, jamais les poids de la carte.</p></div><button className="button button-primary" onClick={() => setPage('map')}><Compass size={17} />Retour à la carte</button></section>}
        <footer className="page-footer"><span className="footer-brand"><img src="/brand/dominion-token.png" alt="" />DOMINION</span><span>La carte des tokens Solana.</span><button onClick={() => setPage('rules')}>Comprendre les règles</button></footer>
      </main>
    </div>
    {createOpen && worldPage && !pendingWorld && <CreateModal demo={demo} config={config} busy={busy} enabled={demo || config.creationEnabled} onClose={() => setCreateOpen(false)} onSubmit={async input => { await platform.createToken(input); setCreateOpen(false); setPage('map'); }} />}
  </div>;
}

interface LaunchPreview { tokensOut: string; minTokensOut: string; sharePercent: number; configNeeded: boolean; }
const readableAmount = (value: string) => { const [integer, fraction] = value.split('.'); return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fraction ? ',' + fraction : ''); };

function CreateModal({ demo, config, busy, enabled, onClose, onSubmit }: { demo: boolean; config: PlatformConfig; busy: boolean; enabled: boolean; onClose: () => void; onSubmit: (input: { name: string; symbol: string; seedAmount: string }) => Promise<void> }) {
  const ref = useRef<HTMLDivElement>(null);
  const [name, setName] = useState('');
  const [ticker, setTicker] = useState('');
  const [seedAmount, setSeedAmount] = useState('');
  const [preview, setPreview] = useState<LaunchPreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const swapFeePercent = (config.curve?.tradingFeeBps ?? 100) / 100;
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    let current = true;
    setPreview(null); setPreviewError(null); setPreviewBusy(false); setAccepted(false);
    if (!seedAmount) return;
    try { if (parseUnits(seedAmount, config.quoteDecimals) <= 0n) { setPreviewError('L’achat initial doit être supérieur à zéro.'); return; } }
    catch (err) { setPreviewError(err instanceof Error ? err.message : 'Montant invalide.'); return; }
    setPreviewBusy(true);
    const timer = window.setTimeout(() => {
      void import('./lib/dbc').then(({ previewLaunch }) => previewLaunch(config, seedAmount)).then(result => {
        if (current) { setPreview(result); setPreviewBusy(false); }
      }).catch(err => {
        if (current) { setPreviewError(err instanceof Error ? err.message : 'Impossible de calculer l’achat initial. Réessayez.'); setPreviewBusy(false); }
      });
    }, 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [seedAmount, config.mode, config.quoteDecimals, config.quoteMint, config.configVersion, config.curveVersion, config.dbcConfig, config.curve?.initialMarketCapQuote, config.curve?.migrationMarketCapQuote, config.curve?.tradingFeeBps]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLInputElement>('input')?.focus();
    const listener = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busyRef.current) closeRef.current();
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
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(null);
    if (!name.trim() || new TextEncoder().encode(name.trim()).length > 32) { setError('Le nom doit contenir entre 1 et 32 octets.'); return; }
    if (!/^[A-Z0-9]{1,10}$/.test(ticker)) { setError('Utilisez 1 à 10 lettres ou chiffres pour le symbole.'); return; }
    if (!preview || previewBusy || !accepted) { setError('Attendez le devis puis confirmez le montant de l’achat initial.'); return; }
    try { await onSubmit({ name: name.trim(), symbol: ticker, seedAmount }); } catch (err) { setError(err instanceof Error ? err.message : 'Le lancement a échoué. Réessayez.'); }
  }

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div className="create-modal launch-modal" ref={ref} role="dialog" aria-modal="true" aria-labelledby="create-title">
      <button className="modal-close" aria-label="Fermer la création" disabled={busy} onClick={onClose}><X size={20} /></button>
      <span className="modal-symbol"><img src="/brand/dominion-token.png" alt="Dominion" /></span>
      <h2 id="create-title">Lancer votre token.</h2>
      <p>Créez sa courbe en {config.quoteSymbol} et choisissez votre premier achat.</p>
      <form onSubmit={e => void submit(e)}>
        <div className="launch-identity"><div><label htmlFor="token-name">Nom du token</label><input id="token-name" value={name} disabled={busy} onChange={e => setName(e.target.value)} placeholder="Ex. Moon Garden" maxLength={32} required /></div><div><label htmlFor="token-symbol">Symbole</label><input id="token-symbol" value={ticker} disabled={busy} onChange={e => setTicker(e.target.value.toUpperCase())} placeholder="GARDEN" maxLength={10} pattern="[A-Z0-9]{1,10}" required /></div></div>
        <label htmlFor="token-seed">Achat initial ({config.quoteSymbol})</label><div className="launch-amount"><input id="token-seed" value={seedAmount} onChange={e => { setPreview(null); setAccepted(false); setSeedAmount(e.target.value.replace(',', '.')); }} inputMode="decimal" placeholder="0,00" disabled={busy} required /><span>{config.quoteSymbol}</span></div>
        <p className="launch-amount-note">Plus vous achetez, plus votre allocation augmente. Le prix évolue sur la courbe.</p>
        <div className="launch-preview" aria-busy={previewBusy} aria-live="polite">
          <div className="launch-receive"><span>Vous recevez</span><strong>{preview ? readableAmount(preview.tokensOut) : '—'} <small>{ticker || 'tokens'}</small></strong></div>
          <dl><div><dt>Part de la supply initiale</dt><dd>{preview ? percent(preview.sharePercent) : '—'}</dd></div><div><dt>Minimum reçu</dt><dd>{preview ? readableAmount(preview.minTokensOut) : '—'} {preview && (ticker || 'tokens')}</dd></div><div><dt>Supply totale</dt><dd>1 milliard</dd></div><div><dt>Frais de swap inclus</dt><dd>{percent(swapFeePercent)}</dd></div></dl>
          {previewBusy && <p className="preview-pending"><RefreshCw size={12} className="spinning" />Calcul de votre allocation…</p>}
          {!preview && !previewBusy && !previewError && <p className="preview-pending">Saisissez un montant pour calculer votre allocation.</p>}
        </div>
        {previewError && <div className="message message-error" role="alert">{previewError}</div>}
        <div className="launch-costs"><p><strong>Le reste de la supply reste dans le protocole.</strong> Votre wallet reçoit uniquement les tokens de cet achat. Les frais de swap de {percent(swapFeePercent)} sont inclus dans le devis.</p><p><strong>Des SOL sont nécessaires en plus.</strong> Les frais réseau et les comptes sont présentés dans Phantom avant signature.</p>{preview && <p className="launch-signatures">{preview.configNeeded ? 'Première utilisation : 2 signatures, pour la configuration puis le lancement et l’achat. Cette configuration sera réutilisable.' : 'Configuration déjà disponible : 1 signature pour lancer le token et réaliser l’achat initial.'}</p>}</div>
        <label className="check-label"><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} disabled={busy || !preview || previewBusy} required /><span>{demo ? 'Je confirme cet achat initial en simulation, sans fonds réels.' : `Je confirme l’achat initial de ${seedAmount || '—'} ${config.quoteSymbol}, avec les frais de swap inclus et les coûts en SOL présentés dans Phantom.`}</span></label>
        {!enabled && <p className="modal-network-note">Le lancement est momentanément indisponible. Réessayez après actualisation.</p>}
        {error && <div className="message message-error" role="alert">{error}</div>}
        <button className="button button-primary" type="submit" disabled={busy || !accepted || !enabled || !preview || previewBusy}>{busy ? 'Signature et confirmation…' : demo ? 'Simuler le lancement' : 'Lancer et acheter'}<Plus size={17} /></button>
      </form>
    </div>
  </div>;
}

function TradePanel({ config, token, busy, onTrade }: { config: PlatformConfig; token: Token; busy: boolean; onTrade: (input: TradeInput) => Promise<void> }) {
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [amount, setAmount] = useState('');
  const [preview, setPreview] = useState<{ tokensOut: string; minTokensOut: string; minimumOutAtomic: string; amountInUsed?: string } | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [refreshQuote, setRefreshQuote] = useState(0);
  const outputSymbol = side === 'buy' ? token.symbol : config.quoteSymbol;
  const inputSymbol = side === 'buy' ? config.quoteSymbol : token.symbol;

  useEffect(() => {
    let current = true;
    setPreview(null); setPreviewError(null); setPreviewBusy(false);
    if (!amount) return;
    try { if (parseUnits(amount, side === 'buy' ? config.quoteDecimals : token.decimals) <= 0n) { setPreviewError('Saisissez un montant supérieur à zéro.'); return; } }
    catch (err) { setPreviewError(err instanceof Error ? err.message : 'Montant invalide.'); return; }
    setPreviewBusy(true);
    const timer = window.setTimeout(() => {
      void import('./lib/dbc').then(({ previewTrade }) => previewTrade(config, { token, side, amount, slippageBps: 100 })).then(result => {
        if (current) { setPreview(result); setPreviewBusy(false); }
      }).catch(err => {
        if (current) { setPreviewError(err instanceof Error ? err.message : 'Devis indisponible. Réessayez.'); setPreviewBusy(false); }
      });
    }, 300);
    return () => { current = false; window.clearTimeout(timer); };
  }, [side, amount, token.mint, token.pool, token.price, token.baseReserve, token.quoteReserve, token.decimals, token.migrated, config.quoteDecimals, config.quoteMint, config.configVersion, refreshQuote]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null);
    if (!preview || previewBusy || busy) return;
    try { await onTrade({ token, side, amount, slippageBps: 100, minimumOutAtomic: preview.minimumOutAtomic }); setAmount(''); setPreview(null); }
    catch (err) { setError(err instanceof Error ? err.message : 'Échange interrompu.'); setRefreshQuote(value => value + 1); }
  }

  return <section className="curve-trade" aria-label="Échanger sur la courbe"><div className="curve-trade-heading"><span>Courbe en {config.quoteSymbol}</span><button type="button" title="Actualiser le devis" aria-label="Actualiser le devis" disabled={busy || previewBusy || !amount} onClick={() => setRefreshQuote(value => value + 1)}><RefreshCw size={13} className={previewBusy ? 'spinning' : ''} /></button></div><div className="curve-trade-tabs" role="group" aria-label="Sens de l’échange"><button type="button" className={side === 'buy' ? 'selected' : ''} disabled={busy} onClick={() => { setSide('buy'); setAmount(''); setPreview(null); setError(null); }}><ArrowDownLeft size={14} />Acheter</button><button type="button" className={side === 'sell' ? 'selected' : ''} disabled={busy} onClick={() => { setSide('sell'); setAmount(''); setPreview(null); setError(null); }}><ArrowUpRight size={14} />Vendre</button></div><form onSubmit={event => void submit(event)}><label htmlFor="curve-trade-amount">{side === 'buy' ? 'Montant maximum' : 'Vous vendez'} ({inputSymbol})</label><div className="curve-trade-amount"><input id="curve-trade-amount" value={amount} onChange={event => { setPreview(null); setAmount(event.target.value.replace(',', '.')); }} disabled={busy} placeholder="0,00" inputMode="decimal" required /><span>{inputSymbol}</span></div><dl className="curve-trade-quote" aria-live="polite">{side === 'buy' && preview?.amountInUsed && <div><dt>Dépense estimée</dt><dd>{readableAmount(preview.amountInUsed)} {inputSymbol}</dd></div>}<div><dt>Réception estimée</dt><dd>{preview ? readableAmount(preview.tokensOut) : '—'} {preview && outputSymbol}</dd></div><div><dt>Minimum reçu</dt><dd>{preview ? readableAmount(preview.minTokensOut) : '—'} {preview && outputSymbol}</dd></div><div><dt>Slippage maximal</dt><dd>1 %</dd></div><div><dt>Frais de swap inclus</dt><dd>{percent((config.curve?.tradingFeeBps ?? 100) / 100)}</dd></div></dl>{previewBusy && <p className="preview-pending"><RefreshCw size={12} className="spinning" />Actualisation du devis…</p>}{(error || previewError) && <p className="trade-error" role="alert">{error || previewError}</p>}<button className="button button-primary" type="submit" disabled={busy || !config.tradingEnabled || !preview || previewBusy}>{busy ? 'Signature et confirmation…' : `${side === 'buy' ? 'Acheter' : 'Vendre'} ${token.symbol}`}</button><p className="curve-trade-note">{config.tradingEnabled ? 'Frais réseau en SOL en plus. Vérifiez les montants dans Phantom avant de signer.' : 'Les échanges sont momentanément indisponibles sur cette courbe.'}</p></form></section>;
}

function MigrationPanel({ token, busy, onMigrate }: { token: Token; busy: boolean; onMigrate: () => Promise<void> }) {
  return <section className="migration-panel" aria-label={`Migration de ${token.symbol}`}><span className="migration-marker"><Check size={13} />Seuil atteint</span><h3>Courbe terminée.</h3><p>La liquidité est prête à rejoindre Meteora DAMM V2. Tout wallet peut déclencher cette migration.</p><div className="migration-details"><p>Une signature Phantom déclenche la migration. Les frais réseau et de création des comptes sont payés en SOL par le wallet qui signe.</p><p>Après la migration, les échanges se poursuivent sur Meteora. La liquidité migrée reste verrouillée dans le protocole.</p></div><button className="button button-primary" type="button" disabled={busy} onClick={() => void onMigrate()}>{busy ? 'Migration et confirmation…' : 'Migrer la liquidité'}<ArrowUpRight size={15} /></button></section>;
}
