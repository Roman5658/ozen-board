import { Link } from 'react-router-dom'

type Props = {
    t: {
        privacy: string
        terms: string
        cookies: string
        contact: string
    }
}

function Footer({ t }: Props) {

    return (
        <footer style={{
            padding: '16px',
            borderTop: '1px solid #e5e7eb',
            fontSize: 13,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 12,
            justifyContent: 'center',

        }}>
            <Link to="/privacy">{t.privacy}</Link>
            <Link to="/terms">{t.terms}</Link>
            <Link to="/cookies">{t.cookies}</Link>
            <Link to="/contact">{t.contact}</Link>

        </footer>
    )
}

export default Footer
