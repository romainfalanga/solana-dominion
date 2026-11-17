import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronRight, ExternalLink, Layers3, Maximize2, RefreshCw, Search, Wallet, X } from 'lucide-react';
import { useWalletPortfolio } from './lib/useWalletPortfolio';
import { layoutTerritories } from './lib/territories';
import type { Token } from './types';
import type { WalletAsset } from './walletTypes';

const usd = (value: number) => value > 0 && value < 0.01 ? '< 0,01 $' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const mapUsd = (value: number) => value > 0 && value < 0.01 ? '< 0,01 $' : new Intl.NumberFormat('fr-FR', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 2 }).format(value) + ' $';
const percentage = (value: number) => value > 0 && value < 0.01 ? '< 0,01 %' : new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(value) + ' %';
const quantity = (amount: string) => { const [integer, fraction] = amount.split('.'); return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + (fraction ? ',' + fraction : ''); };
const price = (value: number) => new Intl.NumberFormat('fr-FR', { maximumSignificantDigits: 6 }).format(value) + ' $';

/** Adapter only for the shared geometry; displayed values always use WalletAsset. */
function asTerritory(asset: WalletAsset): Token {
  return { mint: asset.mint, pool: '', name: asset.name, symbol: asset.symbol, color: asset.color, creator: '', supply: '0', baseReserve: '0', quoteReserve: '0', decimals: asset.decimals, quoteDecimals: 0, marketCap: asset.valueUsd ?? 0, price: asset.priceUsd ?? 0, change24h: null, createdAt: 0 };
}

export default function WalletPage({ owner, onConnect, busy, quoteMint }: { owner: string | null; onConnect: () => Promise<void>; busy: boolean; quoteMint?: string | null }) {
  const portfolio = useWalletPortfolio(owner);
  // Never display one account's positions under a different connected account.
  const snapshot = owner && portfolio.snapshot?.owner === owner ? portfolio.snapshot : null;
  const { loading, error } = portfolio;
  const [query, setQuery] = useState('');
  const [selectedMint, setSelectedMint] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 900, height: 480 });
  const assets = useMemo(() => [...(snapshot?.assets ?? [])].sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1) || a.mint.localeCompare(b.mint)), [snapshot]);
  const total = snapshot?.totalUsd ?? 0;
  const pricedCount = assets.filter(asset => asset.valueUsd !== null).length;
  const unpricedCount = snapshot?.unpricedCount ?? 0;
  const selected = assets.find(asset => asset.mint === selectedMint) ?? assets[0];
  const filtered = assets.filter(asset => `${asset.name} ${asset.symbol} ${asset.mint}`.toLowerCase().includes(query.toLowerCase()));
  const territories = layoutTerritories(assets.map(asTerritory), size.width, size.height);
  const valueLabel = unpricedCount > 0 ? 'Valeur connue' : 'Valeur du wallet';
  const selectedShare = selected?.valueUsd !== null && selected?.valueUsd !== undefined && total > 0 ? selected.valueUsd / total * 100 : null;

  useEffect(() => { setSelectedMint(null); setQuery(''); setExpanded(false); setCopied(null); setLocalError(null); }, [owner]);
  useEffect(() => {
    const element = mapRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(element); return () => observer.disconnect();
  }, [owner, Boolean(snapshot), expanded, loading]);
  useEffect(() => {
    if (!expanded) return;
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [expanded]);
  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(null), 2000); return () => window.clearTimeout(timer); }, [copied]);

  async function refresh() { setLocalError(null); try { await portfolio.refresh(); } catch (err) { setLocalError(err instanceof Error ? err.message : 'Impossible d’actualiser ce wallet.'); } }
  async function connect() { setLocalError(null); try { await onConnect(); } catch (err) { setLocalError(err instanceof Error ? err.message : 'Connexion Phantom interrompue.'); } }
  async function copy(value: string) { try { await navigator.clipboard.writeText(value); setCopied(value); } catch { setLocalError('Impossible de copier l’adresse.'); } }
  const icon = (asset: WalletAsset, className = '') => <span className={`wallet-asset-icon ${className}`} style={{ backgroundColor: asset.color }}>{quoteMint && asset.mint === quoteMint ? <img src="/brand/dominion-token.png" alt="" /> : asset.isNative ? <span className="wallet-sol-icon" aria-hidden="true"><i /><i /><i /></span> : asset.symbol.slice(0, 2)}</span>;

  if (!owner) return <section className="wallet-connect-state" aria-label="Connecter votre wallet"><div className="wallet-connect-symbol"><Wallet size={34} strokeWidth={1.5} /></div><h2>Votre wallet, en territoires.</h2><p>Connectez Phantom pour répartir vos positions SOL et tokens selon leur valeur en dollars.</p><button className="button button-primary" type="button" disabled={busy} onClick={() => void connect()}><Wallet size={17} />Connecter Phantom</button><small>Lecture des soldes uniquement. Aucune transaction ni signature de message n’est demandée.</small>{localError && <p className="trade-error" role="alert">{localError}</p>}</section>;

  return <div className="wallet-page">
    <div className="wallet-owner-row"><span>Wallet connecté</span><button className="wallet-owner-copy" type="button" onClick={() => void copy(owner)} title="Copier l’adresse du wallet"><code>{owner}</code>{copied === owner ? <Check size={13} /> : <Layers3 size={13} />}</button><a href={`https://explorer.solana.com/address/${owner}`} target="_blank" rel="noreferrer" aria-label="Voir votre wallet sur Solana Explorer"><ExternalLink size={14} /></a><button className="button button-quiet wallet-refresh" type="button" disabled={loading} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'spinning' : ''} />Actualiser</button></div>
    {(error || localError) && <div className="message message-error wallet-error" role="alert"><span>{localError || error}{snapshot && <small> Les dernières données affichées peuvent être anciennes.</small>}</span><button type="button" onClick={() => void refresh()} disabled={loading}>Réessayer</button></div>}
    {!snapshot ? <section className="wallet-load-state" aria-live="polite" aria-busy={loading}>{loading ? <RefreshCw size={28} className="spinning" /> : <Wallet size={30} />}<h2>{loading ? 'Lecture de vos positions…' : 'Positions indisponibles.'}</h2><p>{loading ? 'Les soldes Solana et leurs cours sont en cours de vérification.' : 'Actualisez pour charger les positions de ce wallet.'}</p>{!loading && <button className="button button-primary" type="button" onClick={() => void refresh()}>Réessayer le chargement</button>}</section> : <>
      <section className="world-stats wallet-stats" aria-label="Valeur des positions du wallet"><div><span>{valueLabel}</span><strong>{assets.length > 0 && pricedCount === 0 ? '—' : usd(total)}</strong></div><div><span>Actifs détenus</span><strong>{assets.length}<small> SOL et tokens</small></strong></div><div><span>Actifs valorisés</span><strong>{pricedCount}<small> sur {assets.length}</small></strong></div><div className="world-status"><div><strong>{error ? 'Données précédentes' : 'Soldes Solana'}</strong><span>{new Date(snapshot.updatedAt).toLocaleTimeString('fr-FR')} · slot {snapshot.slot.toLocaleString('fr-FR')}</span></div></div></section>
      {unpricedCount > 0 && <p className="wallet-unpriced-note"><span>{unpricedCount} actif{unpricedCount > 1 ? 's' : ''} sans prix disponible.</span> {pricedCount > 0 ? 'La carte et les pourcentages couvrent uniquement la valeur connue. Les autres positions restent dans la liste.' : 'Vos quantités sont affichées, mais aucune valeur totale en dollars ne peut être établie.'}</p>}
      <div className="game-grid wallet-game-grid">
        <section className={expanded ? 'map-panel map-expanded' : 'map-panel'} aria-label="Répartition de votre wallet"><div className="panel-toolbar"><div className="map-title"><span className="map-cross">⌖</span><strong>Vos positions</strong><span>{territories.length} territoires</span></div><div className="toolbar-actions"><button type="button" title="Actualiser les positions" aria-label="Actualiser les positions" disabled={loading} onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'spinning' : ''} /></button><button type="button" title={expanded ? 'Réduire la carte du wallet' : 'Agrandir la carte du wallet'} aria-label={expanded ? 'Réduire la carte du wallet' : 'Agrandir la carte du wallet'} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={17} /> : <Maximize2 size={16} />}</button></div></div><div className="territory-map wallet-map" ref={mapRef} aria-busy={loading}>
          {territories.map(({ token, x, y, width, height }) => <button key={token.mint} type="button" className={`territory ${selected?.mint === token.mint ? 'territory-selected' : ''} ${query && !filtered.some(asset => asset.mint === token.mint) ? 'territory-muted' : ''}`} onClick={() => setSelectedMint(token.mint)} style={{ left: x, top: y, width, height, backgroundColor: token.color }} aria-label={`${token.name}, ${usd(token.marketCap)}, ${percentage(total > 0 ? token.marketCap / total * 100 : 0)} de la valeur connue`} title={`${token.name} · ${usd(token.marketCap)}`}>
            {width > 65 && height > 52 && <span className="territory-content">{quoteMint && token.mint === quoteMint && width > 100 && height > 140 && <img className="territory-platform-logo" src="/brand/dominion-token.png" alt="" />}<span className="territory-symbol" style={{ fontSize: Math.min(36, Math.max(13, width / 7)) }}>{token.symbol}</span><span className="territory-share">{percentage(total > 0 ? token.marketCap / total * 100 : 0)}</span>{width > 115 && height > 100 && <span className="territory-cap">{mapUsd(token.marketCap)}</span>}</span>}{selected?.mint === token.mint && width > 45 && height > 40 && <span className="territory-selected-mark"><Check size={13} /></span>}
          </button>)}
          {territories.length === 0 && <div className="empty-map wallet-empty-map"><Wallet size={38} strokeWidth={1.2} /><h2>{assets.length === 0 ? 'Ce wallet est vide.' : 'Aucun territoire valorisé.'}</h2><p>{assets.length === 0 ? 'Aucun solde SOL ni token positif n’a été trouvé à cette actualisation.' : 'Les actifs sans valeur en dollars vérifiable restent dans la liste. Aucun territoire fictif ne leur est attribué.'}</p></div>}
        </div><div className="map-footer"><span><span className="tiny-square" />Surface = valeur de la position / {unpricedCount > 0 ? 'valeur connue' : 'valeur du wallet'}</span><span>{total > 0 ? '100 % de la valeur connue' : 'Aucune valeur répartie'}</span></div></section>
        <aside className="token-panel wallet-position-panel" aria-label="Position sélectionnée">{selected ? <><div className="token-heading">{icon(selected, 'wallet-position-icon')}<div><h2>{selected.name}</h2><span>{selected.symbol}{selected.isNative ? ' · SOL natif' : ''}</span></div></div><div className="wallet-position-value"><span>Valeur de votre position</span><strong>{selected.valueUsd === null ? 'Non valorisée' : usd(selected.valueUsd)}</strong></div><dl className="token-facts wallet-position-facts"><div><dt>Quantité détenue</dt><dd>{quantity(selected.amount)} <span>{selected.symbol}</span></dd></div><div><dt>Prix unitaire</dt><dd>{selected.priceUsd === null ? 'Indisponible' : price(selected.priceUsd)}</dd></div><div><dt>Part de la valeur connue</dt><dd>{selectedShare === null ? 'Non calculable' : percentage(selectedShare)}</dd></div></dl>{selected.valueUsd !== null && total > 0 && <div className="territory-progress"><span style={{ width: `${selectedShare ?? 0}%`, background: selected.color }} /></div>}<p className="wallet-position-note">{selected.valueUsd === null ? 'Cette position est détenue dans le wallet. L’absence de cours empêche de calculer sa valeur en dollars et sa surface.' : 'La surface représente uniquement la valeur de votre position, sans tenir compte de la capitalisation totale de ce token.'}</p><div className="wallet-asset-address"><span>{selected.isNative ? 'Compte Solana' : 'Adresse du mint'}</span><button type="button" title="Copier l’adresse" onClick={() => void copy(selected.isNative ? owner : selected.mint)}><code>{selected.isNative ? owner : selected.mint}</code>{copied === (selected.isNative ? owner : selected.mint) ? <Check size={13} /> : <Layers3 size={13} />}</button></div><a className="button button-quiet wallet-explorer-link" href={`https://explorer.solana.com/address/${selected.isNative ? owner : selected.mint}`} target="_blank" rel="noreferrer">Voir sur Solana Explorer<ExternalLink size={13} /></a></> : <div className="wallet-no-selection"><Wallet size={32} strokeWidth={1.2} /><h2>Vos positions apparaîtront ici.</h2><p>Les quantités et valeurs seront disponibles dès qu’un solde sera détecté.</p></div>}</aside>
      </div>
      <section className="ranking-panel wallet-assets-panel"><div className="ranking-heading"><div><h2>Tous vos actifs</h2><span>SOL natif et tokens SPL du wallet connecté</span></div><label className="search-field"><Search size={16} /><input aria-label="Rechercher un actif du wallet" placeholder="Nom, symbole ou mint…" value={query} onChange={event => setQuery(event.target.value)} /></label></div><div className="table-scroll"><table className="wallet-assets-table"><thead><tr><th>Actif</th><th>Quantité</th><th>Prix USD</th><th>Valeur USD</th><th>Part connue</th><th><span className="sr-only">Détails</span></th></tr></thead><tbody>{filtered.map(asset => <tr key={asset.mint} className={asset.mint === selected?.mint ? 'selected-row' : ''}><td><button type="button" className="token-table-button" onClick={() => setSelectedMint(asset.mint)}>{icon(asset, 'wallet-table-icon')}<span><strong>{asset.name}</strong><small>{asset.symbol}{asset.isNative ? ' · natif' : ''}</small></span></button></td><td className="wallet-quantity-cell">{quantity(asset.amount)}</td><td>{asset.priceUsd === null ? <span className="unpriced-value">Indisponible</span> : price(asset.priceUsd)}</td><td>{asset.valueUsd === null ? <span className="unpriced-value">Non valorisé</span> : usd(asset.valueUsd)}</td><td>{asset.valueUsd === null || total <= 0 ? '—' : percentage(asset.valueUsd / total * 100)}</td><td><button type="button" className="row-open" aria-label={`Voir la position ${asset.symbol}`} onClick={() => setSelectedMint(asset.mint)}><ChevronRight size={16} /></button></td></tr>)}</tbody></table>{filtered.length === 0 && <p className="empty-search">{assets.length ? 'Aucun actif ne correspond à votre recherche.' : 'Aucun actif détenu à cette actualisation.'}</p>}</div></section>
      <p className="wallet-footnote">Prix indicatifs en dollars, susceptibles de varier. Les actifs sans cours ne sont pas inclus dans la valeur connue.</p>
    </>}
  </div>;
}
