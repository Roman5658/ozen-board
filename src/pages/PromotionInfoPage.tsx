import { useNavigate } from "react-router-dom"
import { PRICES } from "../config/prices"
import type { translations } from "../app/i18n"

type Props = {
    t: (typeof translations)[keyof typeof translations]
}

type PromotionRow = {
    name: string
    description: string
    price: string
}

function PromotionTable({
    title,
    labels,
    rows,
}: {
    title: string
    labels: { type: string; price: string; description: string }
    rows: PromotionRow[]
}) {
    return (
        <section>
            <h3>{title}</h3>
            <div style={{overflowX: "auto"}}>
                <table style={{width: "100%", borderCollapse: "collapse"}}>
                    <thead>
                        <tr>
                            <th style={thStyle}>{labels.type}</th>
                            <th style={thStyle}>{labels.price}</th>
                            <th style={thStyle}>{labels.description}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row) => (
                            <tr key={row.name}>
                                <td style={tdStyle}><strong>{row.name}</strong></td>
                                <td style={tdStyle}>{row.price} PLN</td>
                                <td style={tdStyle}>{row.description}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    )
}

const thStyle = {
    padding: "10px 8px",
    textAlign: "left",
    borderBottom: "1px solid #e5e7eb",
    fontSize: 13,
    color: "#374151",
} as const

const tdStyle = {
    padding: "10px 8px",
    borderBottom: "1px solid #f3f4f6",
    verticalAlign: "top",
    fontSize: 14,
} as const

function PromotionInfoPage({ t }: Props) {
    const navigate = useNavigate()
    const p = t.promotionInfo

    const adRows: PromotionRow[] = [
        {name: "TOP 3", description: p.ads.top3, price: PRICES.ad.top3},
        {name: "TOP 6", description: p.ads.top6, price: PRICES.ad.top6},
        {name: p.ads.bumpName, description: p.ads.bump, price: PRICES.ad.bump},
        {name: p.ads.goldName, description: p.ads.gold, price: PRICES.ad.gold},
    ]

    const auctionRows: PromotionRow[] = [
        {name: "Top auction", description: p.auctions.top, price: PRICES.auction["top-auction"]},
        {name: "Featured", description: p.auctions.featured, price: PRICES.auction.featured},
        {name: p.auctions.goldName, description: p.auctions.gold, price: PRICES.auction["highlight-gold"]},
    ]

    return (
        <div className="card stack12">
            <button
                type="button"
                onClick={() => navigate(-1)}
                style={{
                    alignSelf: "flex-start",
                    background: "none",
                    border: "none",
                    color: "#2563eb",
                    cursor: "pointer",
                    fontSize: 14,
                    padding: 0,
                }}
            >
                {p.back}
            </button>

            <h1 style={{fontSize: 24, margin: 0}}>{p.title}</h1>
            <p style={{margin: 0, color: "#4b5563"}}>{p.intro}</p>

            <PromotionTable title={p.adsTitle} labels={p.table} rows={adRows}/>
            <PromotionTable title={p.auctionsTitle} labels={p.table} rows={auctionRows}/>

            <section>
                <h3>{p.rulesTitle}</h3>
                <ul style={{paddingLeft: 20, marginBottom: 0}}>
                    {p.rules.map((rule) => (
                        <li key={rule} style={{marginBottom: 8}}>{rule}</li>
                    ))}
                </ul>
            </section>
        </div>
    )
}

export default PromotionInfoPage
