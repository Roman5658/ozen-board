import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PayPalScriptProvider } from "@paypal/react-paypal-js"

import './index.css'
import './styles/global.css'
import App from './app/App'

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PayPalScriptProvider
            options={{
                clientId: import.meta.env.VITE_PAYPAL_CLIENT_ID,

                components: "buttons,marks",
                currency: "PLN",
                intent: "capture",
                commit: true,
                vault: false,

                locale: "pl_PL",

                disableFunding: "blik,p24",
            }}
        >

        <BrowserRouter>
                <App />
            </BrowserRouter>
        </PayPalScriptProvider>
    </StrictMode>
)

