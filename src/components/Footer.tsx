import { Link } from 'react-router-dom'

function Footer() {
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
            <Link to="/privacy">Privacy</Link>
            <Link to="/terms">Terms</Link>
            <Link to="/cookies">Cookies</Link>
            <Link to="/contact">Contact</Link>
        </footer>
    )
}

export default Footer
